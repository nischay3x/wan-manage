// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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

const periodic = require('./periodic')();
const deviceStatus = require('./deviceStatus')();
const connections = require('../websocket/Connections')();
const mongoose = require('mongoose');
const tunnels = require('../models/tunnels');
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });
const configs = require('../configs')();
const ha = require('../utils/highAvailability')(configs.get('redisUrl'));

/***
 * This class periodically updates devices/tunnels statuses from memory to db
 ***/
class StatusesInDb {
  /**
  * Creates an instance of the class
  */
  constructor () {
    this.start = this.start.bind(this);
    this.runTask = this.runTask.bind(this);
    this.updateConnectionStatuses = this.updateConnectionStatuses.bind(this);
    this.updateTunnelsStatuses = this.updateTunnelsStatuses.bind(this);
    this.updateDevicesStatuses = this.updateDevicesStatuses.bind(this);

    // Task information
    this.taskInfo = {
      name: 'statuses_in_db',
      func: this.runTask,
      handle: null,
      period: 60000
    };
  }

  /**
  * Starts the periodic task.
  * @return {void}
  */
  start () {
    const { name, func, period } = this.taskInfo;
    periodic.registerTask(name, func, period);
    this.clearStatuses();
    ha.registerCallback('elected', 'statusesInDb', this.clearStatuses);
    periodic.startTask(name);
  }

  /**
  * Clears all statuses in DB after service is started
  * @async
  * @return {void}
  */
  async clearStatuses () {
    try {
      await devices.updateMany(
        { },
        { $set: { isConnected: false, status: '' } }
      );
      await tunnels.updateMany(
        { },
        { $set: { status: '' } }
      );
    } catch (err) {
      logger.warn('Failed to clear statuses in database', {
        params: { message: err.message }
      });
    }
  }

  /**
  * Called periodically to update statuses from memory to DB
  * @return {void}
  */
  runTask () {
    this.updateConnectionStatuses(connections.getConnectionStatusOrgs());
    this.updateDevicesStatuses(deviceStatus.getDevicesStatusOrgs());
    this.updateTunnelsStatuses(deviceStatus.getTunnelsStatusOrgs());
  }

  /**
  * Stores modified connection statuses from memory to DB
  * @async
  * @param  {array} orgs organizations ids array
  * @return {void}
  */
  async updateConnectionStatuses (orgs) {
    for (const org of orgs) {
      const connectionStatuses = connections.getConnectionStatusByOrg(org);
      if (connectionStatuses && Object.keys(connectionStatuses).length > 0) {
        const devicesByStatus = {};
        for (const deviceId in connectionStatuses) {
          const status = connectionStatuses[deviceId];
          if (!devicesByStatus[status]) devicesByStatus[status] = [];
          devicesByStatus[status].push(mongoose.Types.ObjectId(deviceId));
        }
        const updateOps = [];
        for (const status in devicesByStatus) {
          updateOps.push({
            updateMany: {
              filter: { _id: { $in: devicesByStatus[status] } },
              update: { $set: { isConnected: (status === 'true') } }
            }
          });
        }
        // Update in db
        if (updateOps.length > 0) {
          try {
            // Clear in memory before updating the db
            connections.clearConnectionStatusByOrg(org);
            await devices.collection.bulkWrite(updateOps);
          } catch (err) {
            logger.warn('Failed to update connection status in database', {
              params: { message: err.message }
            });
          }
        }
      }
    }
  }

  /**
  * Stores modified devices statuses from memory to DB
  * @async
  * @param  {array} orgs organizations ids array
  * @return {void}
  */
  async updateDevicesStatuses (orgs) {
    for (const org of orgs) {
      const devicesStatuses = deviceStatus.getDevicesStatusByOrg(org);
      if (devicesStatuses && Object.keys(devicesStatuses).length > 0) {
        const devicesByStatus = {};
        for (const deviceId in devicesStatuses) {
          const status = devicesStatuses[deviceId];
          if (!devicesByStatus[status]) devicesByStatus[status] = [];
          devicesByStatus[status].push(mongoose.Types.ObjectId(deviceId));
        }
        const updateOps = [];
        for (const status in devicesByStatus) {
          updateOps.push({
            updateMany: {
              filter: { _id: { $in: devicesByStatus[status] } },
              update: { $set: { status: status } }
            }
          });
        }
        // Update in db
        if (updateOps.length) {
          try {
            // Clear in memory before updating the db
            deviceStatus.clearDevicesStatusByOrg(org);
            await devices.collection.bulkWrite(updateOps);
          } catch (err) {
            logger.warn('Failed to update devices status in database', {
              params: { message: err.message }
            });
          }
        }
      }
    }
  }

  /**
  * Stores modified tunnels statuses from memory to DB
  * @async
  * @param  {array} orgs organizations ids array
  * @return {void}
  */
  async updateTunnelsStatuses (orgs) {
    for (const org of orgs) {
      const tunnelsStatuses = deviceStatus.getTunnelsStatusByOrg(org);
      if (tunnelsStatuses && Object.keys(tunnelsStatuses).length > 0) {
        const tunnelsByStatus = {};
        for (const tunnelNum in tunnelsStatuses) {
          const status = tunnelsStatuses[tunnelNum];
          if (!tunnelsByStatus[status]) tunnelsByStatus[status] = [];
          tunnelsByStatus[status].push(+tunnelNum);
        }
        const updateOps = [];
        for (const status in tunnelsByStatus) {
          updateOps.push({
            updateMany: {
              filter: {
                org: mongoose.Types.ObjectId(org),
                num: { $in: tunnelsByStatus[status] }
              },
              update: { $set: { status: status } }
            }
          });
        }
        // Update in db
        if (updateOps.length) {
          try {
            // Clear in memory before updating the db
            deviceStatus.clearTunnelsStatusByOrg(org);
            await tunnels.collection.bulkWrite(updateOps);
          } catch (err) {
            logger.warn('Failed to update tunnels status in database', {
              params: { message: err.message }
            });
          }
        }
      }
    }
  }
}

var statuses = null;
module.exports = function () {
  if (statuses) return statuses;
  else {
    statuses = new StatusesInDb();
    return statuses;
  }
};
