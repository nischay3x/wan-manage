// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2020  flexiWAN Ltd.

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

const mongoose = require('mongoose');
const configs = require('../configs')();
const deviceStatus = require('../periodic/deviceStatus')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const tunnelsModel = require('../models/tunnels');
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

/**
 * This function queues IKEv2 jobs to all devices (ver.4+)
 * where expiration time not set or where certificates are about to expire.
 * Called for periodic update of IKEv2 parameters on the devices.
 */
const updateDevicesIKEv2 = async () => {
  // Get all devices (ver.4+) where expiration time is null
  // or where certificates are about to expire (1 month before)
  const expireTime = new Date();
  expireTime.setMonth(expireTime.getMonth() + 1);
  const query = {
    $and: [
      {
        $or: [
          { 'IKEv2.expireTime': null },
          { 'IKEv2.expireTime': { $lte: expireTime } }
        ]
      },
      { 'IKEv2.jobQueued': { $ne: true } },
      { 'versions.device': { $regex: /[4-9]\d?\.\d+\.\d+/ } }
    ]
  };

  // Group the the devices that require certificate regeneration
  // under the users that own them
  const organizationDevicesList = await devices.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$org',
        devices: { $push: '$$ROOT' }
      }
    }
  ]);

  for (const orgDevice of organizationDevicesList) {
    const jobResults = await queueCreateIKEv2Jobs(
      orgDevice.devices,
      'system',
      orgDevice._id
    );
    jobResults.forEach(job => {
      logger.info('Generate IKEv2 certificate job queued', {
        params: { jobId: job.id },
        job: job,
        periodic: { task: this.taskInfo }
      });
    });
    // Mark the jobs has been queued to the devices
    const deviceIDs = orgDevice.devices.map(device => { return device._id; });
    await setIKEv2QueuedFlag(deviceIDs, true);
  }
};

/**
 * Queues IKEv2 jobs to a list of devices.
 * @param  {Array}   devices       array of devices to which a job should be queued
 * @param  {string}  user          user name of the user the queued the job
 * @param  {string}  org           id of the organization to which the user belongs
 * @return {Promise}               a promise for queuing a job
 */
const queueCreateIKEv2Jobs = (devices, user, org) => {
  // @param  {Date}    expireTime    date/time of the certificate expiration
  const expireTime = Date.now() + configs.get('ikev2ExpirePeriod', 'number');
  const tasks = [{
    entity: 'agent',
    message: 'create-ikev2',
    params: { expireTime }
  }];
  const jobs = [];
  devices.forEach(dev => {
    deviceStatus.setDeviceStatsField(dev.machineId, 'state', 'pending');
    jobs.push(
      deviceQueues.addJob(dev.machineId, user, org,
        // Data
        { title: `Create IKEv2 on the device ${dev.hostname}`, tasks },
        // Response data
        { method: 'ikev2', data: { device: dev._id, org, action: 'create-ikev2', expireTime } },
        // Metadata
        { priority: 'normal', attempts: 1, removeOnComplete: false },
        // Complete callback
        null)
    );
  });

  return Promise.all(jobs);
};

/**
 * Sets the value of the pending IKEv2 jobs flag in the database.
 * The pending flag indicates if a pending IKEv2 job
 * already exists in the device's queue.
 * @param  {string}  deviceIDs the list of ids of the devices
 * @param  {boolean} flag      the value to be set in the database
 * @return {Promise}
 */
const setIKEv2QueuedFlag = (deviceIDs, flag) => {
  return devices.updateMany(
    { _id: { $in: deviceIDs } },
    { $set: { 'IKEv2.jobQueued': flag } },
    { upsert: false }
  );
};

/**
 * Applies the create IKEv2 request on all requested devices
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const apply = async (devicesIn, user, data) => {
  // If the apply method was called for multiple devices, extract
  // only the devices that appear in the body. If it was called for
  // a single device, simply used the first device in the devices array.
  let opDevices;
  if (data.devices) {
    const selectedDevices = data.devices;
    opDevices = (devicesIn && selectedDevices)
      ? devicesIn.filter((device) => {
        const inSelected = selectedDevices.hasOwnProperty(device._id);
        return !!inSelected;
      }) : [];
  } else {
    opDevices = devicesIn;
  }

  // Filter out devices (ver.4+) that already have
  // a pending IKEv2 job in the queue.
  opDevices = await devices.find({
    $and: [
      { _id: { $in: opDevices } },
      { 'IKEv2.jobQueued': { $ne: true } },
      { 'versions.device': { $regex: /[4-9]\d?\.\d+\.\d+/ } }
    ]
  },
  '_id machineId hostname'
  );

  const userName = user.username;
  const org = data.org;
  const jobResults = await queueCreateIKEv2Jobs(opDevices, userName, org);
  jobResults.forEach(job => {
    logger.info('Create IKEv2 device job queued', {
      params: { jobId: job.id },
      job: job
    });
  });

  // Set the create IKEv2 job pending flag for all devices.
  // This prevents queuing additional IKEv2 tasks on the devices.
  const deviceIDs = opDevices.map(dev => dev._id);
  await setIKEv2QueuedFlag(deviceIDs, true);
  return { ids: jobResults.map(job => job.id), status: 'completed', message: '' };
};

/**
 * Called when IKEv2 device job completes
 * to update IKEv2 data in DB, rebuild tunnels if needed
 * and unset the pending IKEv2 job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {string} res   device object ID and username
 * @return {void}
 */
const complete = async (jobId, res) => {
  if (res.action !== 'create-ikev2') {
    logger.info('Device update IKEv2 job complete', { params: { result: res, jobId: jobId } });
    return;
  };

  logger.info('Device create IKEv2 job complete', { params: { result: res, jobId: jobId } });

  let certificate = res.agentMessage.certificate;
  certificate = Array.isArray(certificate) ? certificate.join('') : certificate;
  const expireTime = certificate ? res.expireTime : null;

  // update the device IKEv2 data
  await devices.updateOne(
    { _id: res.device },
    {
      $set: {
        'IKEv2.certificate': certificate,
        'IKEv2.expireTime': expireTime
      }
    },
    { upsert: false }
  );

  if (certificate) {
    // update public certificate on the devices having IKEv2 tunnel with this one
    const localDevID = mongoose.Types.ObjectId(res.device);
    const remoteDevices = await tunnelsModel
      .aggregate([
        {
          $match: {
            isActive: true,
            // encryptionMode: 'ikev2',
            $or: [{ deviceA: localDevID }, { deviceB: localDevID }]
          }
        },
        {
          $project: {
            dev_id: { $cond: [{ $eq: ['$deviceA', localDevID] }, '$deviceB', '$deviceA'] }
          }
        },
        { $group: { _id: '$dev_id' } },
        { $lookup: { from: 'devices', localField: '_id', foreignField: '_id', as: 'devices' } },
        {
          $addFields: {
            hostname: { $arrayElemAt: ['$devices.hostname', 0] },
            machineId: { $arrayElemAt: ['$devices.machineId', 0] }
          }
        },
        { $project: { hostname: 1, machineId: 1 } }
      ]);

    const tasks = [{
      entity: 'agent',
      message: 'update-ikev2',
      params: { certificate, expireTime }
    }];

    for (const remoteDev of remoteDevices) {
      deviceQueues.addJob(remoteDev.machineId, 'system', res.org,
        // Data
        { title: `Update IKEv2 on the device ${remoteDev.hostname}`, tasks },
        // Response data
        { method: 'ikev2', data: { device: remoteDev._id, org: res.org, action: 'update-ikev2' } },
        // Metadata
        { priority: 'normal', attempts: 1, removeOnComplete: false },
        // Complete callback
        null);
    }
  }
  // unset the pending IKEv2 job flag in the database
  try {
    await setIKEv2QueuedFlag([res.device], false);
  } catch (err) {
    logger.warn('Failed to update jobQueued field in database', {
      params: { result: res, jobId: jobId }
    });
  }
};

/**
 * Called if device IKEv2 job fails to unset
 * the pending job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const error = async (jobId, res) => {
  logger.warn('Device IKEv2 job failed', { params: { result: res, jobId: jobId } });
  try {
    await setIKEv2QueuedFlag([res.device], false);
  } catch (err) {
    logger.warn('Failed to update IKEv2 jobQueued field in database', {
      params: { result: res, jobId: jobId }
    });
  }
};

/**
 * Called if device IKEv2 job was removed to unset
 * the pending IKEv2 job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const remove = async (job) => {
  if (['inactive', 'delayed', 'active'].includes(job._state)) {
    logger.info('Device IKEv2 job removed', { params: { job: job } });
    try {
      const { device } = job.data.response.data;
      await setIKEv2QueuedFlag([device], false);
    } catch (err) {
      logger.error('Failed to update jobQueued field in database', {
        params: { job: job, err: err.message }
      });
    }
  }
};

module.exports = {
  updateDevicesIKEv2,
  apply,
  complete,
  error,
  remove
};
