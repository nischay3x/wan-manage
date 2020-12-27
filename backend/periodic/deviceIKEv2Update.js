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

const configs = require('../configs')();
const periodic = require('./periodic')();
const { updateDevicesIKEv2 } = require('../deviceLogic/IKEv2');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });
const ha = require('../utils/highAvailability')(configs.get('redisUrl'));

/***
 * This class periodically checks if there are devices (ver.3)
 * with public certificates wich will expire in 1 month
 * and adds certificate creation jobs for these devices.
 *
 ***/
class DeviceIKEv2Update {
  constructor () {
    this.start = this.start.bind(this);
    this.periodicUpdateIKEv2 = this.periodicUpdateIKEv2.bind(this);

    // Runs once every day
    this.taskInfo = {
      name: 'create_device_certificate',
      func: this.periodicUpdateIKEv2,
      handle: null,
      period: (1000 * 60 * 60 * 24) // Runs once in a day
    };
  }

  /**
     * Starts the update_device_certificate periodic task
     * @async
     * @return {void}
     */
  start () {
    const { name, func, period } = this.taskInfo;
    periodic.registerTask(name, func, period);
    periodic.startTask(name);
  }

  /**
   * This function queues generate IKEv2 jobs to all devices (ver.3)
   * where expiration time not set or where certificates are about to expire
   * @async
   * @return {void}
   */
  periodicUpdateIKEv2 () {
    ha.runIfActive(async () => {
      try {
        await updateDevicesIKEv2();
      } catch (err) {
        logger.error('Device periodic task failed', {
          params: { reason: 'Failed to queue generate IKEv2 jobs', err: err.message },
          periodic: { task: this.taskInfo }
        });
      }
    });
  }
}

let deviceIKEv2Update = null;
module.exports = () => {
  if (deviceIKEv2Update) return deviceIKEv2Update;
  deviceIKEv2Update = new DeviceIKEv2Update();
  return deviceIKEv2Update;
};
