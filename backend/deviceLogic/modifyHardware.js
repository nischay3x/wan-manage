// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2022  flexiWAN Ltd.

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
const { devices } = require('../models/devices');
const isEqual = require('lodash/isEqual');
const { getCpuInfo } = require('../utils/deviceUtils');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

/**
 * Creates and queues the modify hardware job.
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const apply = async (devicesList, user, data) => {
  const { username } = user;
  const { org, meta } = data;
  const applyPromises = [];
  let modified = false;

  for (const device of devicesList) {
    const { machineId, _id, cpuInfo } = device;

    // check if device.cpuInfo is different than data.cpuInfo
    // If so, generate a job
    if (meta?.cpuInfo && !isEqual(cpuInfo.toObject(), meta.cpuInfo)) {
      logger.info('Changing CPU info:', { params: { machineId, user, data } });

      modified = true;

      // Set the device state to "pending". Device state will
      // be updated again when the device sends periodic message
      deviceStatus.setDeviceState(machineId, 'pending');

      // don't allow to change grub and hw cores. Only the vpp and power saving
      meta.cpuInfo = getCpuInfo({
        ...cpuInfo,
        vppCores: meta.cpuInfo.vppCores,
        powerSaving: meta.cpuInfo.powerSaving
      });

      // TODO: VALIDATE data.cpuInfo
      // 1. vppCors must be up to hw cores - 1
      // 2. Cannot reduce vpp cores to less than two if QOS is installed.

      await updateCpuInfo(_id, org, meta.cpuInfo);

      applyPromises.push(deviceQueues.addJob(
        machineId, username, org,
        // Data
        {
          title: 'Modify device CPU',
          tasks: [
            {
              entity: 'agent',
              message: 'set-cpu-info',
              params: meta.cpuInfo
            }
          ]
        },
        // Response data
        {
          method: 'modifyHardware',
          data: {
            device: _id,
            org: org,
            hardwareChange: 'cpuInfo',
            meta: { oldCpuInfo: cpuInfo }
          }
        },
        // Metadata
        { priority: 'normal', attempts: 1, removeOnComplete: false },
        // Complete callback
        null
      ));
    }
  };

  // Queue job only if the device has changed
  // Return empty jobs array if the device did not change
  if (!modified) {
    logger.debug('The device was not modified, nothing to apply');
    return {
      ids: [],
      status: 'completed',
      message: 'No job added. Nothing to apply'
    };
  }

  const promisesStatus = await Promise.allSettled(applyPromises);
  const { fulfilled, reasons } = promisesStatus.reduce(({ fulfilled, reasons }, elem) => {
    if (elem.status === 'fulfilled') {
      const job = elem.value;
      logger.info('Modify device hardware job queued', {
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
  const status = fulfilled.length < devicesList.length
    ? 'partially completed' : 'completed';
  const message = fulfilled.length < devicesList.length
    ? `Warning: ${fulfilled.length} of ${devicesList.length} modify device hardware jobs added.` +
      `Some devices have following errors: ${reasons.join('. ')}`
    : `Modify device hardware job${devicesList.length > 1 ? 's' : ''} added successfully`;
  return { ids: fulfilled, status, message };
};

/**
 * Called when modify device hardware job completed
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const complete = async (jobId, res) => {
  logger.info('Modify device hardware complete', {
    params: { result: res, jobId: jobId }
  });

  const { hardwareChange, agentMessage, device, org } = res;
  if (hardwareChange === 'cpuInfo' && agentMessage?.cpuInfo) {
    await updateCpuInfo(device, org, getCpuInfo(agentMessage.cpuInfo));
  }
};

const updateCpuInfo = async (deviceId, orgId, cpuInfo) => {
  await devices.updateOne(
    { _id: deviceId, org: orgId },
    { $set: { cpuInfo: cpuInfo } },
    { upsert: false }
  );
};

/**
 * Called when modify device hardware job failed
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const error = (jobId, res) => {
  logger.error('Modify device hardware job failed', {
    params: { result: res, jobId: jobId }
  });
};

/**
 * Called when modify device hardware job is removed either
 * by user or due to expiration. This method should run
 * only for tasks that were deleted before completion/failure
 * @async
 * @param  {Object} job Kue job
 * @return {void}
 */
const remove = async (job) => {
  if (['inactive', 'delayed'].includes(job._state)) {
    logger.info('Modify device hardware job removed', {
      params: { jobId: job.id }
    });
  };
};

module.exports = {
  apply: apply,
  complete: complete,
  remove: remove,
  error: error
};
