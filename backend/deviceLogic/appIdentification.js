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

const configs = require('../configs')();
const { devices } = require('../models/devices');
const { importedapplications } = require('../models/importedapplications');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });
const { getMajorVersion } = require('../versioning');

/**
 * Queues an add appIdentification or delete appIdentification job to a device.
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const apply = async (devices, user, data) => {
  const userName = user.username;
  const org = data.org;

  const { message, title, params, installIds, deviceJobResp } =
      await getDevicesAppIdentificationJobInfo(
        data.org, null, Object.keys(data.devices), data.action === 'add'
      );

  const opDevices = (devices && installIds)
    ? devices.filter((device) => installIds.hasOwnProperty(device._id)) : [];

  const jobs = [];
  opDevices.forEach(async device => {
    const machineId = device.machineId;
    const majorAgentVersion = getMajorVersion(device.versions.agent);
    if (majorAgentVersion === 0) { // version 0.X.X
      throw new Error('Command is not supported for the current agent version');
    } else if (majorAgentVersion >= 1) { // version 1.X.X+
      const tasks = [];
      tasks.push({ entity: 'agent', message, params });
      const job = await deviceQueues.addJob(machineId, userName, org,
        // Data
        { title: title, tasks: tasks },
        // Response data
        {
          method: 'appIdentification',
          data: {
            deviceId: device.id,
            ...deviceJobResp
          }
        },
        // Metadata
        { priority: 'low', attempts: 1, removeOnComplete: false },
        // Complete callback
        null);

      logger.info(title, { params: { job: job.data.response } });
      jobs.push(job);
    }
  });
  return jobs;
};

/**
 * Called when add/remove appIdentification job completed and
 * updates the status of the operation.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const complete = async (jobId, res) => {
  logger.info('appIdentification job complete', { params: { result: res, jobId: jobId } });
  try {
    await devices.findOneAndUpdate(
      { _id: mongoose.Types.ObjectId(res.deviceId) },
      { $set: { 'appIdentification.lastUpdateTime': res.requestTime } },
      { upsert: false }
    );
  } catch (error) {
    logger.warn('Complete appIdentification job, failed', {
      params: { result: res, jobId: jobId, message: error.message }
    });
  }
};

/**
 * Revert failed or removed job operation
 * @param {String} jobId - Failed job ID
 * @param {Object} res   - response data for job ID
 */
const revertJobOperation = async (jobId, res) => {
  try {
    await devices.findOneAndUpdate(
      { _id: mongoose.Types.ObjectId(res.deviceId) },
      { $set: { 'appIdentification.lastRequestTime': new Date(0) } },
      { upsert: false }
    );
  } catch (error) {
    logger.warn('revert appIdentification job, failed', {
      params: { result: res, jobId: jobId, message: error.message }
    });
  }
};

/**
 * Handle appIentification errors
 * @param {String} jobId - Failed job ID
 * @param {Object} res   - response data for job ID
 */
const error = async (jobId, res) => {
  logger.info('appIdentification job failed', { params: { result: res, jobId: jobId } });
  if (!res || !res.deviceId || !res.message) {
    logger.warn('appIdentification job error got an invalid job result', {
      params: { result: res, jobId: jobId }
    });
    return;
  }
  await revertJobOperation(jobId, res);
};

/**
 * Handle appIentification job removal
 * @param {String} jobId - Failed job ID
 * @param {Object} res   - response data for job ID
 */
const remove = async (job) => {
  const res = job.data.response.data;
  logger.info('appIdentification job removed', { params: { result: res, jobId: job.id } });
  if (!res || !res.deviceId || !res.message) {
    logger.warn('appIdentification job removal got an invalid job result', {
      params: { result: res, jobId: job.id }
    });
    return;
  }
  await revertJobOperation(job.id, res);
};

/**
 * Get final list of applications for organization
 * @param {MongoId} org - Organization Mongo ID
 */
const getOrgApplications = async (org) => {
  // TBD: This needs to be updated once a combined function will be introduced
  const importedApplicationsResult = await importedapplications.findOne({}, {
    'applications.name': 1,
    'applications.id': 1,
    'applications.category': 1,
    'applications.serviceClass': 1,
    'applications.importance': 1,
    'applications.rules.protocol': 1,
    'applications.rules.ip': 1,
    'applications.rules.ports': 1,
    updatedAt: 1
  });
  return importedApplicationsResult;
};

/**
 * This function get the device info needed for creating a job
 * @param   {mongoID} org - organization to apply (make sure it is not the user defaultOrg)
 * @param   {String} client - client name that asks for the application installation
 *                            null client only update jobs, not install/uninstall new
 * @param   {List} deviceIdList - deviceIDList the client askes to install on
 * @param   {Boolean} isInstall
 * @return {Object} with:
 *  message       - The message that should be sent to the add application message
 *                  (add-application/remove-application)
 *  title         - Title (Add/Remove)
 *  params        - list of application rules
 *  installIds    - A list with a subset of the devices to install / uninstall
 *                  should only be included in jobs to these devices
 *  deviceJobResp - Parameters to include in the job response data together with the device Id
 * @throw exception on error
 */
const getDevicesAppIdentificationJobInfo = async (org, client, deviceIdList, isInstall) => {
  // get full application list for this organization
  const appRules = await getOrgApplications(org);

  // find all devices that have an older version, require an update
  // if isInstall, find devices older from appRules time which are not already in progress
  // if not isInstall, find devices with (only client or (no client and time not null))
  // If there are other clients using applications it will be kept installed
  let opDevices;
  let requestTime;
  if (isInstall) {
    requestTime = appRules.updatedAt;
    opDevices = await devices.find(
      {
        _id: { $in: deviceIdList },
        'appIdentification.lastRequestTime': { $ne: requestTime },
        $or: [
          { 'appIdentification.lastUpdateTime': null },
          { 'appIdentification.lastUpdateTime': { $lt: appRules.updatedAt } }
        ]
      }, { _id: 1 });
  } else {
    requestTime = null;
    opDevices = await devices.find(
      {
        _id: { $in: deviceIdList },
        'appIdentification.lastRequestTime': { $ne: requestTime },
        $or: [
          { 'appIdentification.clients': [client] },
          {
            $and: [
              { 'appIdentification.clients': [] },
              { 'appIdentification.lastUpdateTime': { $ne: null } }
            ]
          }
        ]
      }, { _id: 1 });
  }

  // update all devices with client info, it's assumed that a job will be sent
  const update = (isInstall)
    ? { $set: { 'appIdentification.lastRequestTime': appRules.updatedAt } }
    : { $set: { 'appIdentification.lastRequestTime': null } };

  if (client) {
    if (isInstall) {
      update.$addToSet = { 'appIdentification.clients': client };
    } else {
      update.$pull = { 'appIdentification.clients': client };
    }
  }
  await devices.updateMany(
    { _id: { $in: deviceIdList } },
    update
  );

  // return parameters
  const ret = {};
  ret.message = (isInstall) ? 'add-application' : 'remove-application';
  const titlePrefix = (isInstall) ? 'Add' : 'Remove';
  ret.title = `${titlePrefix} appIdentifications to device`;
  ret.installIds = opDevices.reduce((obj, d) => { obj[d._id] = true; return obj; }, {});
  ret.params = (isInstall) ? appRules.applications.toObject() : [];
  ret.deviceJobResp = {
    requestTime: requestTime,
    message: ret.message,
    client: client
  };

  return ret;
};

module.exports = {
  apply: apply,
  complete: complete,
  error: error,
  remove: remove,
  getDevicesAppIdentificationJobInfo: getDevicesAppIdentificationJobInfo
};
