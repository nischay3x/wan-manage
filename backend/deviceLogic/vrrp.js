// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2023  flexiWAN Ltd.

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
const deviceStatus = require('../periodic/deviceStatus')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });
const { differenceWith, isEqual } = require('lodash');
const { transformVrrp } = require('./jobParameters');

/**
 * Creates and queues the add/remove job.
 * @async
 * @param  {object} origVrrpGroup   object with VRRP group before the modification
 * @param  {object} newVrrpGroup    object with VRRP group after the modification
 * @param  {string} org             organization ID
 * @param  {object} user            user object
 * @return {None}
 */
const queue = async (origVrrpGroup, newVrrpGroup, orgId, user) => {
  const { username } = user;
  const applyPromises = [];

  const devicesTasks = {};
  for (const vrrpGroupDevice of origVrrpGroup?.devices ?? []) {
    const deviceId = vrrpGroupDevice.device._id.toString();

    if (!(deviceId in devicesTasks)) {
      devicesTasks[deviceId] = {
        orig: [], updated: [], tasks: [], deviceObj: vrrpGroupDevice.device
      };
    }

    devicesTasks[deviceId].orig.push(transformVrrp(vrrpGroupDevice, origVrrpGroup));
  }

  for (const vrrpGroupDevice of newVrrpGroup?.devices ?? []) {
    const deviceId = vrrpGroupDevice.device._id.toString();

    if (!(deviceId in devicesTasks)) {
      devicesTasks[deviceId] = {
        orig: [], updated: [], tasks: [], deviceObj: vrrpGroupDevice.device
      };
    }

    devicesTasks[deviceId].updated.push(transformVrrp(vrrpGroupDevice, newVrrpGroup));
  }

  for (const deviceId in devicesTasks) {
    const [addDevice, removeDevice] = [
      differenceWith(
        devicesTasks[deviceId].updated,
        devicesTasks[deviceId].orig,
        (updated, orig) => {
          return isEqual(updated, orig);
        }),
      differenceWith(
        devicesTasks[deviceId].orig,
        devicesTasks[deviceId].updated,
        (orig, updated) => {
          return isEqual(orig, updated);
        })
    ];

    if (removeDevice.length > 0) {
      devicesTasks[deviceId].tasks.push(...removeDevice.map(r => ({
        entity: 'agent',
        message: 'remove-vrrp',
        params: r
      })));
    }

    if (addDevice.length > 0) {
      devicesTasks[deviceId].tasks.push(...addDevice.map(r => ({
        entity: 'agent',
        message: 'add-vrrp',
        params: r
      })));
    }
  }

  for (const deviceId in devicesTasks) {
    if (devicesTasks[deviceId].tasks.length === 0) {
      continue;
    }

    const device = devicesTasks[deviceId].deviceObj;
    const { machineId, name, _id } = device;

    // Set the device state to "pending". Device state will
    // be updated again when the device sends periodic message
    await deviceStatus.setDeviceState(machineId, 'pending');

    applyPromises.push(deviceQueues.addJob(
      machineId,
      username,
      orgId,
      // Data
      {
        title: 'Modify VRRP for device ' + name,
        tasks: devicesTasks[deviceId].tasks
      },
      // Response data
      {
        method: 'vrrp',
        data: {
          device: _id,
          org: orgId
        }
      },
      // Metadata
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      // Complete callback
      null
    ));
  }

  const promisesStatus = await Promise.allSettled(applyPromises);
  const { fulfilled, reasons } = promisesStatus.reduce(({ fulfilled, reasons }, elem) => {
    if (elem.status === 'fulfilled') {
      const job = elem.value;
      logger.info('VRRP device job queued', {
        params: {
          jobId: job.id,
          machineId: job.type
        }
      });
      fulfilled.push(job.id);
    } else {
      if (!reasons.includes(elem.reason.message)) {
        reasons.push(elem.reason.message);
      }
    };
    return { fulfilled, reasons };
  }, { fulfilled: [], reasons: [] });
  // const status = fulfilled.length < devices.length
  //   ? 'partially completed' : 'completed';
  // const message = fulfilled.length < devices.length
  //   ? `Warning: ${fulfilled.length} of ${devices.length} VRRP jobs added.` +
  //     `Some devices have following errors: ${reasons.join('. ')}`
  //   : `VRRP job${devices.length > 1 ? 's' : ''} added successfully`;
  // return { ids: fulfilled, status, message };
  return { ids: fulfilled, reasons };
};

// /**
//  * Called when reset device job completed
//  * @param  {number} jobId Kue job ID number
//  * @param  {Object} res   device object ID and organization
//  * @return {void}
//  */
// const complete = (jobId, res) => {
//   logger.info('Reset device job complete', {
//     params: { result: res, jobId: jobId }
//   });
// };

// /**
//  * Called when reset device job failed
//  * @param  {number} jobId Kue job ID number
//  * @param  {Object} res   device object ID and organization
//  * @return {void}
//  */
// const error = (jobId, res) => {
//   logger.error('Reset device job failed', {
//     params: { result: res, jobId: jobId }
//   });
// };

module.exports = {
  queue: queue
  // apply: apply
  // complete: complete,
  // error: error
};
