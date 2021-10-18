// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const Service = require('./Service');
const Tunnels = require('../models/tunnels');
const mongoose = require('mongoose');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const deviceStatus = require('../periodic/deviceStatus')();
const statusesInDb = require('../periodic/statusesInDb')();
const { getFilterExpression } = require('../utils/filterUtils');

class TunnelsService {
  /**
   * Extends mongo results with tunnel status info
   *
   * @param {mongo Tunnel Object} item
   */
  static selectTunnelParams (retTunnel) {
    const tunnelId = retTunnel.num;
    // Add tunnel status
    retTunnel.tunnelStatusA =
      deviceStatus.getTunnelStatus(retTunnel.deviceA.machineId, tunnelId) || {};

    // Add tunnel status
    retTunnel.tunnelStatusB = retTunnel.peer
      ? {}
      : deviceStatus.getTunnelStatus(retTunnel.deviceB.machineId, tunnelId) || {};

    // if no filter or ordering by status then db can be not updated,
    // we get the status directly from memory
    retTunnel.tunnelStatus = (retTunnel.peer || retTunnel.tunnelStatusB.status === 'up') &&
      retTunnel.tunnelStatusA.status === 'up' ? 'Connected' : 'Not Connected';

    retTunnel._id = retTunnel._id.toString();

    return retTunnel;
  }

  /**
   * Retrieve device tunnels information
   *
   * id String Numeric ID of the Device to fetch tunnel information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async tunnelsIdDELETE ({ id, org, offset, limit }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const resp = await Tunnels.findOneAndUpdate(
        // Query
        { _id: mongoose.Types.ObjectId(id), org: { $in: orgList } },
        // Update
        { isActive: false },
        // Options
        { upsert: false, new: true });

      if (resp != null) {
        return Service.successResponse(null, 204);
      } else {
        return Service.rejectResponse(404);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Retrieve device tunnels information
   *
   * @param {Integer} offset The number of items to skip before collecting the result (optional)
   * @param {Integer} limit The numbers of items to return (optional)
   * @param {String} sortField The field by which the data will be ordered (optional)
   * @param {String} sortOrder Sorting order [asc|desc] (optional)
   * @param {Array} filters Array of filter strings in format 'key|operation|value' (optional)
   **/
  static async tunnelsGET (requestParams, { user }, response) {
    const { org, offset, limit, sortField, sortOrder, filters } = requestParams;
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const updateStatusInDb = (filters && filters.includes('tunnelStatus')) ||
        sortField === 'tunnelStatus';
      if (updateStatusInDb) {
        // need to update changed statuses from memory to DB
        await statusesInDb.updateDevicesStatuses(orgList);
        await statusesInDb.updateTunnelsStatuses(orgList);
      }
      const pipeline = [
        {
          $match: {
            org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) },
            isActive: true
          }
        },
        {
          $lookup: {
            from: 'devices',
            localField: 'deviceA',
            foreignField: '_id',
            as: 'deviceA'
          }
        },
        { $unwind: '$deviceA' },
        {
          $lookup: {
            from: 'devices',
            localField: 'deviceB',
            foreignField: '_id',
            as: 'deviceB'
          }
        },
        {
          $unwind: {
            path: '$deviceB',
            preserveNullAndEmptyArrays: true // for peers we don't use deviceB
          }
        },
        {
          $lookup: {
            from: 'pathlabels',
            localField: 'pathlabel',
            foreignField: '_id',
            as: 'pathlabel'
          }
        },
        {
          $unwind: {
            path: '$pathlabel',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            interfaceADetails: {
              $filter: {
                input: '$deviceA.interfaces',
                as: 'f',
                cond: {
                  $eq: ['$$f._id', '$interfaceA']
                }
              }
            },
            interfaceBDetails: {
              $filter: {
                input: '$deviceB.interfaces',
                as: 'f',
                cond: {
                  $eq: ['$$f._id', '$interfaceB']
                }
              }
            }
          }
        },
        { $unwind: '$interfaceADetails' },
        {
          $unwind: {
            path: '$interfaceBDetails',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: 'peers',
            localField: 'peer',
            foreignField: '_id',
            as: 'peer'
          }
        },
        {
          $unwind: {
            path: '$peer',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            num: 1,
            isActive: 1,
            'interfaceADetails.name': 1,
            'interfaceBDetails.name': 1,
            peer: 1,
            'interfaceADetails.PublicPort': 1,
            'interfaceBDetails.PublicPort': 1,
            'interfaceADetails.PublicIP': 1,
            'interfaceBDetails.PublicIP': 1,
            'deviceA.name': 1,
            'deviceA.machineId': 1,
            'deviceA._id': 1,
            'deviceA.isConnected': 1,
            'deviceA.status': 1,
            'deviceB.name': 1,
            'deviceB.machineId': 1,
            'deviceB._id': 1,
            'deviceB.isConnected': 1,
            'deviceB.status': 1,
            deviceAconf: 1,
            deviceBconf: 1,
            encryptionMethod: 1,
            'pathlabel.name': 1,
            'pathlabel.color': 1,
            isPending: 1,
            pendingReason: 1,
            tunnelStatus: {
              $switch: {
                branches: [
                  { case: { $eq: ['$isPending', true] }, then: 'Pending' },
                  {
                    case: {
                      $and: [
                        { $eq: ['$status', 'up'] },
                        { $eq: ['$deviceA.status', 'running'] },
                        { $eq: ['$deviceA.isConnected', true] },
                        {
                          $or: [
                            // in case of peer, there is no deviceB to check connection for
                            { $ne: ['$peer', null] },
                            {
                              $and: [
                                { $eq: ['$deviceB.status', 'running'] },
                                { $eq: ['$deviceB.isConnected', true] }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    then: 'Connected'
                  }
                ],
                default: 'Not Connected'
              }
            }
          }
        }
      ];
      if (filters) {
        const matchFilters = [];
        const parsedFilters = JSON.parse(filters);
        for (const filter of parsedFilters) {
          const filterExpr = getFilterExpression(filter);
          if (filterExpr !== undefined) {
            matchFilters.push(filterExpr);
          }
        }
        if (matchFilters.length > 0) {
          pipeline.push({
            $match: { $and: matchFilters }
          });
        }
      }
      if (sortField) {
        const order = sortOrder.toLowerCase() === 'desc' ? -1 : 1;
        pipeline.push({
          $sort: { [sortField]: order }
        });
      };
      const paginationParams = [{
        $skip: offset > 0 ? +offset : 0
      }];
      if (limit !== undefined) {
        paginationParams.push({ $limit: +limit });
      };
      pipeline.push({
        $facet: {
          records: paginationParams,
          meta: [{ $count: 'total' }]
        }
      });

      const paginated = await Tunnels.aggregate(pipeline).allowDiskUse(true);
      if (paginated[0].meta.length > 0) {
        response.setHeader('records-total', paginated[0].meta[0].total);
      };

      const tunnelsMap = paginated[0].records.map((d) => {
        const tunnelStatusInDb = d.tunnelStatus;
        const retTunnel = TunnelsService.selectTunnelParams(d);
        // get the status from db if it was updated
        if (updateStatusInDb) {
          retTunnel.tunnelStatus = tunnelStatusInDb;
        }
        return retTunnel;
      });

      return Service.successResponse(tunnelsMap);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    };
  }
}

module.exports = TunnelsService;
