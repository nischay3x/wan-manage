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
const { getTunnelsPipeline } = require('../utils/tunnelUtils');
const { getUserOrganizations } = require('../utils/membershipUtils');
const notificationsConf = require('../models/notificationsConf');
const configs = require('../configs')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const { getMajorVersion, getMinorVersion } = require('../versioning');
const { validateNotificationsSettings } = require('../models/validators');

class CustomError extends Error {
  constructor ({ message, status, data }) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
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
    const { peer, tunnelStatusA, tunnelStatusB, isPending } = retTunnel;
    if (!tunnelStatusA.status || (!tunnelStatusB.status && !peer)) {
      // one of devices is disconnected
      retTunnel.tunnelStatus = 'N/A';
    } else if (isPending) {
      retTunnel.tunnelStatus = 'Pending';
    } else if ((tunnelStatusA.status === 'up') && (peer || tunnelStatusB.status === 'up')) {
      retTunnel.tunnelStatus = 'Connected';
    } else {
      retTunnel.tunnelStatus = 'Not Connected';
    };

    retTunnel._id = retTunnel._id.toString();

    return retTunnel;
  }

  static getOnlyTunnelsEvents (notifications) {
    const notificationsDict = {};
    for (const [notificationName, notificationSettings] of Object.entries(notifications)) {
      const { type, warningThreshold, criticalThreshold } = notificationSettings;
      if (type === 'tunnel') {
        notificationsDict[notificationName] = {
          warningThreshold: warningThreshold,
          criticalThreshold: criticalThreshold
        };
      }
    }
    return notificationsDict;
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
      const detailed = requestParams?.response !== 'summary';
      const pipeline = getTunnelsPipeline(orgList, filters, detailed);
      if (sortField) {
        const order = sortOrder.toLowerCase() === 'desc' ? -1 : 1;
        pipeline.push({
          $sort: { [sortField]: order }
        });
      };
      const paginationParams = [];
      if (offset !== undefined) {
        paginationParams.push({ $skip: offset > 0 ? +offset : 0 });
      };
      if (limit !== undefined) {
        paginationParams.push({ $limit: +limit });
      };
      let dbRecords;
      if (paginationParams.length > 0) {
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
        dbRecords = paginated[0].records;
      } else {
        dbRecords = await Tunnels.aggregate(pipeline).allowDiskUse(true);
        response.setHeader('records-total', dbRecords.length);
      }
      const tunnelsMap = dbRecords.map((d) => {
        const tunnelStatusInDb = d.tunnelStatus;
        const retTunnel = TunnelsService.selectTunnelParams(d);
        // get the status from db if it was updated
        if (updateStatusInDb) {
          if (retTunnel.tunnelStatus !== tunnelStatusInDb) {
            // mark the tunnel status is changed, it will be updated in DB on the next call
            const status = retTunnel.tunnelStatus === 'Connected' ? 'up' : 'down';
            deviceStatus.setTunnelsStatusByOrg(orgList[0], d.num, d.deviceA.machineId, status);
            retTunnel.tunnelStatus = tunnelStatusInDb;
          }
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

  /**
   * Set tunnel specific notifications configuration
   *
   * @param {Array} tunnelsIdList - List of tunnel ids (Strings)
   * @param {Array} notifications - list of notifications (objects) to update
   **/

  static async tunnelsNotificationsPUT ({ org: orgId, tunnelsIdList, notifications }, { user }) {
    try {
      if (!orgId || !tunnelsIdList || !notifications || tunnelsIdList.length === 0) {
        return Service.rejectResponse(
          'Missing parameter: org, tunnels list or notifications settings',
          400
        );
      }

      const userOrgList = await getUserOrganizations(user);
      if (!Object.values(userOrgList).find((o) => o.id === orgId)) {
        return Service.rejectResponse(
          'You do not have permission to access this organization',
          403
        );
      }

      const tunnels = await Tunnels.find({ _id: { $in: tunnelsIdList }, org: orgId })
        .populate('deviceA', '_id name machineId versions')
        .populate('deviceB', '_id name machineId versions')
        .lean();

      if (tunnels.length !== tunnelsIdList.length) {
        return Service.rejectResponse(
          'Please check again your tunnels id list',
          500
        );
      }

      const results = [];
      const jobs = [];

      const orgNotifications = await notificationsConf.find(
        { org: orgId },
        { rules: 1, _id: 0 }
      );
      const tunnelPromises = tunnels.map(async (tunnel) => {
        try {
          let currentSettingsDict;
          const orgRules = orgNotifications[0].rules;
          if (tunnel.notificationsSettings) {
            currentSettingsDict = tunnel.notificationsSettings;
          } else {
            currentSettingsDict = TunnelsService.getOnlyTunnelsEvents(orgRules);
          }

          const notificationsDict = {};
          for (const [event, { warningThreshold, criticalThreshold }]
            of Object.entries(notifications)) {
            let eventCriticalThreshold = currentSettingsDict[event].criticalThreshold;
            if (criticalThreshold !== 'varies') {
              eventCriticalThreshold = criticalThreshold;
              notificationsDict[event] = notificationsDict[event] || {};
              notificationsDict[event].criticalThreshold = eventCriticalThreshold;
            }

            let eventWarningThreshold = currentSettingsDict[event].warningThreshold;
            if (warningThreshold !== 'varies') {
              eventWarningThreshold = warningThreshold;
              notificationsDict[event] = notificationsDict[event] || {};
              notificationsDict[event].warningThreshold = eventWarningThreshold;
            }
            notificationsDict[event].thresholdUnit = orgRules[event].thresholdUnit;
          }

          const validNotifications = validateNotificationsSettings(notificationsDict);
          if (!validNotifications.valid) {
            throw new CustomError({
              status: 400,
              message: 'Invalid notification settings',
              data: validNotifications.errors
            });
          }

          await Tunnels.updateOne(
            { _id: tunnel._id, org: orgId },
            {
              $set: {
                notificationsSettings: notificationsDict
              }
            }
          );

          const majorVersionA = getMajorVersion(tunnel.deviceA.versions.agent);
          const majorVersionB = getMajorVersion(tunnel.deviceB.versions.agent);
          const minorVersionA = getMinorVersion(tunnel.deviceA.versions.agent);
          const minorVersionB = getMinorVersion(tunnel.deviceB.versions.agent);

          const isDeviceAVersionSupported =
                (majorVersionA > 6 || (majorVersionA === 6 && minorVersionA >= 3));
          const isDeviceBVersionSupported =
                (majorVersionB > 6 || (majorVersionB === 6 && minorVersionB >= 3));

          if (isDeviceAVersionSupported) {
            const jobA = await deviceQueues.addJob(
              tunnel.deviceA.machineId.toString(),
              user.username,
              orgId,
              {
                title: `Modify tunnel notifications settings on device ${tunnel.deviceA.name}`,
                tasks: [{
                  entity: 'agent',
                  message: 'modify-tunnel',
                  params: {
                    notificationsSettings: notificationsDict,
                    'tunnel-id': tunnel.num
                  }
                }]
              },
              {
                method: 'notifications',
                data: {
                  device: tunnel.deviceA._id,
                  org: orgId,
                  action: 'update-tunnel-notifications'
                }
              },
              { priority: 'normal', attempts: 1, removeOnComplete: false },
              null
            );
            jobs.push(jobA);
          }

          if (!tunnel.peer && isDeviceBVersionSupported) {
            const jobB = await deviceQueues.addJob(
              tunnel.deviceB.machineId.toString(),
              user.username,
              orgId,
              {
                title: `Modify tunnel notifications settings on device ${tunnel.deviceB.name}`,
                tasks: [{
                  entity: 'agent',
                  message: 'modify-tunnel',
                  params: {
                    notificationsSettings: notificationsDict,
                    'tunnel-id': tunnel.num
                  }
                }]
              },
              {
                method: 'notifications',
                data: {
                  device: tunnel.deviceB._id,
                  org: orgId,
                  action: 'update-tunnel-notifications'
                }
              },
              { priority: 'normal', attempts: 1, removeOnComplete: false },
              null
            );
            jobs.push(jobB);
          }

          // If processing this tunnel was successful, add success result
          results.push({
            tunnelId: tunnel._id,
            status: 'success',
            message: 'Updated successfully'
          });
        } catch (error) {
          // If processing this tunnel encountered an error, add error result
          results.push({
            tunnelId: tunnel._id,
            status: 'error',
            message: error.message || 'Unknown error',
            data: error.data || {}
          });
        }
      });

      await Promise.all(tunnelPromises);

      const failedUpdates = results.filter(result => result.status === 'error');

      if (failedUpdates.length === 0) {
        return Service.successResponse({
          code: 200,
          message: 'All tunnels updated successfully',
          data: results,
          error: ''
        });
      } else if (failedUpdates.length === tunnels.length) {
        return Service.rejectResponse(
          'Failed to update all tunnels',
          500,
          { tunnels: failedUpdates }
        );
      } else {
        return Service.successResponse({
          code: 200,
          message: 'Some tunnels updated successfully, some failed',
          data: results,
          error: 'Not all tunnels were updated'
        });
      }
    } catch (e) {
      if (e.code === 400) {
        return Service.rejectResponse(
          e.message || 'Invalid notification settings',
          e.code || 500,
          e.errors || {}
        );
      }
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = TunnelsService;
