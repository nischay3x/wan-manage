// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('./cors');
const auth = require('../authenticate');
const connections = require('../websocket/Connections')();
const deviceStatus = require('../periodic/deviceStatus')();
const usersModel = require('../models/users');
const accountsModel = require('../models/accounts');
const { deviceAggregateStats } = require('../models/analytics/deviceStats');

const adminRouter = express.Router();
adminRouter.use(bodyParser.json());

/**
 * This route is allowed only if the organization is marked as admin
 * Return internal information
 */
adminRouter
  .route('/')
// When options message received, reply origin based on whitelist
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyAdmin, async (req, res, next) => {
    // Get users info
    let registeredUsers = 'No info';
    try {
      registeredUsers = await usersModel
        .aggregate([{ $project: { username: 1 } }, { $count: 'num_registered_users' }])
        .allowDiskUse(true);
    } catch (e) {
      registeredUsers = 'Error getting registered users info, error=' + e.message;
    }

    // Get Monthly Stats
    let monthlyStats = 'No info';
    try {
      monthlyStats = await deviceAggregateStats
        .aggregate([{ $project: { month: 1, orgs: { $objectToArray: '$stats.orgs' } } },
          { $unwind: '$orgs' },
          {
            $project: {
              month: 1,
              org: '$orgs.k',
              devices: { $objectToArray: '$orgs.v.devices' }
            }
          },
          { $unwind: '$devices' },
          { $project: { month: 1, org: 1, device: '$devices.k', bytes: '$devices.v.bytes' } },
          {
            $group: {
              _id: { month: '$month' },
              active_orgs: { $addToSet: '$org' },
              active_devices: { $addToSet: '$device' },
              total_bytes: { $sum: '$bytes' }
            }
          },
          {
            $project: {
              _id: 0,
              month: '$_id.month',
              activeOrgs: { $size: '$active_orgs' },
              activeDevices: { $size: '$active_devices' },
              totalBytes: '$total_bytes'
            }
          },
          { $sort: { month: -1 } }])
        .allowDiskUse(true);
      monthlyStats.forEach((result) => {
        result.month = (new Date(result.month)).toLocaleDateString();
        result.totalBytes = result.totalBytes.valueOf();
      });
    } catch (e) {
      monthlyStats = 'Error getting installed tunnels info, error=' + e.message;
    }

    const accountPipeline = [
      {
        $project: {
          _id: 0,
          account_id: '$_id',
          account_name: '$name',
          country: '$country',
          billing_customer_id: '$billingCustomerId',
          organizations: '$organizations'
        }
      },
      {
        $lookup: {
          from: 'organizations',
          localField: 'organizations',
          foreignField: '_id',
          as: 'organizations'
        }
      },
      { $unwind: '$organizations' },
      {
        $lookup: {
          from: 'devices',
          let: { org_id: '$organizations._id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$$org_id', '$org'] } } },
            { $group: { _id: null, count: { $sum: 1 } } }
          ],
          as: 'devices'
        }
      },
      {
        $lookup: {
          from: 'tunnels',
          let: { org_id: '$organizations._id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$$org_id', '$org'] } } },
            { $project: { isActive: 1, _id: 1 } }
          ],
          as: 'tunnels'
        }
      },
      { $addFields: { num_devices: '$devices.count' } },
      {
        $project: {
          account_name: 1,
          account_id: 1,
          country: 1,
          billing_customer_id: 1,
          organization_id: '$organizations._id',
          organization_name: '$organizations.name',
          num_devices: { $arrayElemAt: ['$num_devices', 0] },
          num_tunnels_created: { $size: '$tunnels' },
          num_tunnels_active: {
            $size: {
              $filter: { input: '$tunnels', as: 't', cond: { $eq: ['$$t.isActive', true] } }
            }
          }
        }
      },
      {
        $group: {
          _id: {
            account_id: '$account_id',
            account_name: '$account_name',
            country: '$country',
            billing_customer_id: '$billing_customer_id'
          },
          organizations: {
            $push: {
              organization_id: '$organization_id',
              organization_name: '$organization_name',
              num_devices: '$num_devices',
              num_tunnels_created: '$num_tunnels_created',
              num_tunnels_active: '$num_tunnels_active',
              devices: '$devices'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          account_id: '$_id.account_id',
          account_name: '$_id.account_name',
          country: '$_id.country',
          billing_customer_id: '$_id.billing_customer_id',
          account_num_devices: { $sum: '$organizations.num_devices' },
          account_num_tunnels_created: { $sum: '$organizations.num_tunnels_created' },
          account_num_tunnels_active: { $sum: '$organizations.num_tunnels_active' },
          account_bytes: { $literal: {} },
          organizations: '$organizations'
        }
      }
    ];

    // handle filter pagination
    if (req.query.filters) {
      const parsed = JSON.parse(req.query.filters);

      const mapping = {
        account_name: 'name'
      };

      const filters = {};
      for (const key in parsed) {
        if (key in mapping) {
          filters[mapping[key]] = { $regex: parsed[key] };
        }
      }

      accountPipeline.unshift({ $match: filters });
    }

    // handle sort pagination
    if (req.query.sort) {
      const parsed = JSON.parse(req.query.sort);
      accountPipeline.push({ $sort: { [parsed.key]: parsed.value === 'desc' ? -1 : 1 } });
    } else {
      accountPipeline.push({ $sort: { account_name: -1 } });
    }

    if (+req.query.page > 0) {
      accountPipeline.push({ $skip: req.query.page * req.query.size });
    }
    accountPipeline.push({ $limit: +req.query.size });

    const accounts = await accountsModel.aggregate(accountPipeline).allowDiskUse(true);

    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() - 6);

    const bytesPerOrg = await deviceAggregateStats.aggregate([
      { $match: { month: { $gte: sixMonths.getTime() } } },
      { $project: { month: 1, orgs: { $objectToArray: '$stats.orgs' } } },
      { $unwind: '$orgs' },
      { $project: { month: 1, org: '$orgs.k', devices: { $objectToArray: '$orgs.v.devices' } } },
      { $unwind: '$devices' },
      { $project: { month: 1, org: 1, bytes: '$devices.v.bytes' } },
      { $group: { _id: { org: '$org', month: '$month' }, device_bytes: { $sum: '$bytes' } } },
      {
        $project: {
          _id: 0,
          org: '$_id.org',
          month: { $toDate: '$_id.month' },
          device_bytes: '$device_bytes'
        }
      }
    ]).allowDiskUse(true);

    for (const account of accounts) {
      // account.bytes = {};
      const bytesPerMonth = bytesPerOrg.reduce((result, current) => {
        // check if org is under current account
        const org = account.organizations.find(o => o.organization_id.toString() === current.org);
        if (!org) return result;

        const monthName = current.month.toLocaleDateString();

        // add data per organization
        if (!org.bytes) {
          org.bytes = {};
        }
        org.bytes[monthName] = current.device_bytes;

        if (!result[monthName]) {
          result[monthName] = 0;
        }

        result[monthName] += current.device_bytes;

        return result;
      }, {});

      account.account_bytes = bytesPerMonth;
    }

    // Return  static info from:
    const result = {
      ...registeredUsers[0],
      // installedDevices: installedDevices,
      // installedTunnels: installedTunnels,
      monthlyStats: monthlyStats,
      connectedOrgs: {},
      accounts
    };

    // 1. Open websocket connections and connection info
    const devices = connections.getAllDevices();
    result.numConnectedDevices = devices.length;
    devices.forEach((device) => {
      const deviceInfo = connections.getDeviceInfo(device);
      if (result.connectedOrgs[deviceInfo.org] === undefined) {
        result.connectedOrgs[deviceInfo.org] = [];
      }
      const devStatus = deviceStatus.getDeviceStatus(device);
      result.connectedOrgs[deviceInfo.org].push({
        machineID: device,
        status: devStatus ? devStatus.state : 'unknown',
        version: deviceInfo.version
        // ? deviceStatus.getDeviceStatus(device).state : 'unknown')
        // ip:(deviceInfo.socket._sender._socket._peername.address || 'unknown'),
        // port:(deviceInfo.socket._sender._socket._peername.port || 'unknown')
      });
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.json([result]);
  });

// Default exports
module.exports = adminRouter;
