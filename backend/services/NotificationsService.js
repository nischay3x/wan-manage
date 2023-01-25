/* eslint-disable max-len */
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

const notificationsDb = require('../models/notifications');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const { getUserOrganizations } = require('../utils/membershipUtils');
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getMatchFilters } = require('../utils/filterUtils');
const notificationsConf = require('../models/notificationsConf');
const { ObjectId } = require('mongodb');

class NotificationsService {
  /**
   * Get all Notifications
   *
   * offset Integer The number of items to skip before starting to collect the result set
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async notificationsGET (requestParams, { user }, response) {
    const { org, op, status, offset, limit, sortField, sortOrder, filters } = requestParams;
    let orgList;
    try {
      orgList = await getAccessTokenOrgList(user, org, false);
      const query = { org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) } };
      if (status) {
        query.status = status;
      }
      const pipeline = op !== 'count' ? [
        {
          $match: query
        },
        {
          $project: {
            _id: { $toString: '$_id' },
            time: 1,
            device: 1,
            title: 1,
            details: 1,
            status: 1,
            machineId: 1
          }
        }
      ] : [];
      let devicesArray;
      if (filters) {
        const parsedFilters = JSON.parse(filters);
        const matchFilters = getMatchFilters(parsedFilters);
        if (matchFilters.length > 0) {
          // if there is a 'device.*' filter we need another query, $lookup will not work
          // because 'devices' and 'notifications' are in different databases
          const [deviceFilters, notificationFilters] = matchFilters.reduce((res, filter) => {
            for (const key in filter) {
              if (key.startsWith('device.')) {
                res[0].push({ [key.replace('device.', '')]: filter[key] });
              } else {
                res[1].push(filter);
              }
            }
            return res;
          }, [[], []]);
          if (deviceFilters.length > 0) {
            devicesArray = await devices.find({
              $and: [...deviceFilters, {
                org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) }
              }]
            }, { name: 1 });
            notificationFilters.push({ device: { $in: devicesArray.map(d => d._id) } });
          };
          if (notificationFilters.length > 0) {
            pipeline.push({
              $match: { $and: notificationFilters }
            });
          }
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

      // If operation is 'count', return the amount
      // of notifications for each device
      const notifications = (op === 'count')
        ? await notificationsDb.aggregate([{ $match: query },
          {
            $group: {
              _id: '$device',
              count: { $sum: 1 }
            }
          }
        ])
        : await notificationsDb.aggregate(pipeline).allowDiskUse(true);

      let devicesNames = {};
      if (op !== 'count' && notifications[0].meta.length > 0) {
        response.setHeader('records-total', notifications[0].meta[0].total);
        if (!devicesArray) {
          // there was no 'device.*' filter
          devicesArray = await devices.find({
            _id: { $in: notifications[0].records.map(n => n.device) }
          }, { name: 1 });
        }
        devicesNames = devicesArray.reduce((r, d) => ({ ...r, [d._id]: d.name }), {});
      };
      const result = (op === 'count')
        ? notifications.map(element => {
          return {
            _id: element._id.toString(),
            count: element.count
          };
        })
        : notifications[0].records.map(element => {
          return {
            ...element,
            _id: element._id.toString(),
            deviceId: element.device.toString() || null,
            device: element.device ? devicesNames[element.device] : null || null,
            time: element.time.toISOString()
          };
        });

      return Service.successResponse(result);
    } catch (e) {
      logger.warn('Failed to retrieve notifications', {
        params: {
          org: orgList,
          err: e.message
        }
      });
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify notification
   *
   * id String Numeric ID of the notification to modify
   * org String Organization to be filtered by (optional)
   * notificationsIDPutRequest NotificationsIDPutRequest
   * returns Notification
   **/
  static async notificationsIdPUT ({ id, org, notificationsIDPutRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const query = { org: { $in: orgList }, _id: id };
      const res = await notificationsDb.updateOne(
        query,
        { $set: { status: notificationsIDPutRequest.status } },
        { upsert: false }
      );
      if (res.n === 0) throw new Error('Failed to update notifications');

      const notifications = await notificationsDb.find(
        query,
        'time device title details status machineId'
      ).populate('device', 'name -_id', devices);

      const result = {
        _id: notifications[0]._id.toString(),
        status: notifications[0].status,
        details: notifications[0].details,
        title: notifications[0].title,
        device: (notifications[0].device) ? notifications[0].device.name : null,
        machineId: notifications[0].machineId,
        time: notifications[0].time.toISOString()
      };

      return Service.successResponse(result, 200);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify notifications
   *
   * org String Organization to be filtered by (optional)
   * notificationsPutRequest NotificationsPutRequest
   * no response value expected for this operation
   **/
  static async notificationsPUT ({ org, notificationsPutRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const query = { org: { $in: orgList } };
      if (notificationsPutRequest.ids) query._id = { $in: notificationsPutRequest.ids };

      const res = await notificationsDb.updateMany(
        query,
        { $set: { status: notificationsPutRequest.status } },
        { upsert: false }
      );
      if (notificationsPutRequest.ids && res.n !== notificationsPutRequest.ids.length) {
        throw new Error('Some notification IDs were not found');
      }
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete all notifications matching the filters
   *
   * no response value expected for this operation
   **/
  static async notificationsDELETE ({ org, notificationsDeleteRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const query = { org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) } };
      const { filters } = notificationsDeleteRequest;
      if (filters) {
        const matchFilters = getMatchFilters(filters);
        if (matchFilters.length > 0) {
          query.$and = matchFilters;
        }
      }
      const { deletedCount } = await notificationsDb.deleteMany(query);
      if (deletedCount === 0) {
        return Service.rejectResponse('Not found', 404);
      }
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async validateParams (org, account, group, user) {
    // Validate parameters
    if (!org && !account && !group) {
      return Service.rejectResponse('Missing parameter: org, account or group', 400);
    }
    if (org && (account || group)) {
      return Service.rejectResponse('Invalid parameter: org should be used alone', 400);
    }
    if (group && !account) {
      return Service.rejectResponse('Invalid parameter: group should be used with account', 400);
    }
    if (account && org) {
      return Service.rejectResponse('Invalid parameter: account should be used alone or with group(for modifying the group)', 400);
    }

    const orgList = await getUserOrganizations(user);
    let orgIds = [];
    if (org) {
      if (!Object.values(orgList).find(o => o.id === org)) {
        return Service.rejectResponse('You do not have permission to access this organization', 403);
      }
      orgIds = [org];
    } else {
      orgIds = Object.values(orgList)
        .filter(org => org.account.toString() === account && (!group || org.group === group))
        .map(org => org.id);
    }
    if (!orgIds.length) {
      return Service.rejectResponse('No organizations found', 404);
    }
    return orgIds;
  }

  /**
   * Get notifications settings of a given organization/account/group
   **/
  static async notificationsConfGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }
      const response = await notificationsConf.aggregate([
        { $match: { org: { $in: orgIds.map(orgId => new ObjectId(orgId)) } } },
        { $unwind: '$rules' },
        {
          $group: {
            _id: '$rules._id',
            warningThreshold: { $addToSet: '$rules.warningThreshold' },
            criticalThreshold: { $addToSet: '$rules.criticalThreshold' },
            thresholdUnit: { $addToSet: '$rules.thresholdUnit' },
            severity: { $addToSet: '$rules.severity' },
            immediateEmail: { $addToSet: '$rules.immediateEmail' },
            resolvedAlert: { $addToSet: '$rules.resolvedAlert' },
            event: { $addToSet: '$rules.event' }
          }
        },
        { $sort: { event: 1 } },
        {
          $project: {
            warningThreshold: {
              $cond: [{ $gt: [{ $size: '$warningThreshold' }, 1] }, 'not the same', { $arrayElemAt: ['$warningThreshold', 0] }]
            },
            criticalThreshold: {
              $cond: [{ $gt: [{ $size: '$criticalThreshold' }, 1] }, 'not the same', { $arrayElemAt: ['$criticalThreshold', 0] }]
            },
            thresholdUnit: {
              $cond: [{ $gt: [{ $size: '$thresholdUnit' }, 1] }, 'not the same', { $arrayElemAt: ['$thresholdUnit', 0] }]
            },
            severity: {
              $cond: [{ $gt: [{ $size: '$severity' }, 1] }, 'not the same', { $arrayElemAt: ['$severity', 0] }]
            },
            immediateEmail: {
              $cond: [{ $gt: [{ $size: '$immediateEmail' }, 1] }, 'not the same', { $arrayElemAt: ['$immediateEmail', 0] }]
            },
            resolvedAlert: {
              $cond: [{ $gt: [{ $size: '$resolvedAlert' }, 1] }, 'not the same', { $arrayElemAt: ['$resolvedAlert', 0] }]
            },
            event: {
              $cond: [{ $gt: [{ $size: '$event' }, 1] }, 'not the same', { $arrayElemAt: ['$event', 0] }]
            }
          }
        }
      ]);
      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify the notifications settings of a given organization/account/group
   **/

  static async notificationsConfPUT ({ notificationsConfPut }, { user }) {
    try {
      const { org, account, group, rules } = notificationsConfPut;
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }
      for (const org of orgIds) {
        for (let i = 0; i < rules.length; i++) {
          const updateData = { $set: {} };
          if (rules[i].warningThreshold !== 'not the same') {
            updateData.$set['rules.$[el].warningThreshold'] = rules[i].warningThreshold;
          }
          if (rules[i].criticalThreshold !== 'not the same') {
            updateData.$set['rules.$[el].criticalThreshold'] = rules[i].criticalThreshold;
          }
          if (rules[i].thresholdUnit !== 'not the same') {
            updateData.$set['rules.$[el].thresholdUnit'] = rules[i].thresholdUnit;
          }
          if (rules[i].severity !== 'not the same') {
            updateData.$set['rules.$[el].severity'] = rules[i].severity;
          }
          if (rules[i].immediateEmail !== 'not the same') {
            updateData.$set['rules.$[el].immediateEmail'] = rules[i].immediateEmail;
          }
          if (rules[i].resolvedAlert !== 'not the same') {
            updateData.$set['rules.$[el].resolvedAlert'] = rules[i].resolvedAlert;
          }

          await notificationsConf.updateOne({ org: org, 'rules.event': rules[i].event }, updateData, { arrayFilters: [{ 'el.event': rules[i].event }] });
        }
      }
      return Service.successResponse({
        code: 200,
        message: 'Success',
        data: 'updated successfully'
      });
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }
}

module.exports = NotificationsService;
