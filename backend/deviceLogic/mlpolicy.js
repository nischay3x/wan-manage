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

const createError = require('http-errors');
const MultiLinkPolicies = require('../models/mlpolicies');
const mongoConns = require('../mongoConns.js')();
const configs = require('../configs')();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { devices } = require('../models/devices');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);

const queueMlPolicyJob = (deviceList, op, policy, user, org) => {
  // Create policy message
  const tasks = [
    {
      entity: 'agent',
      message: `${op === 'install' ? 'add' : 'remove'}-multilink-policy`,
      params: {}
    }
  ];

  if (op === 'install') {
    tasks[0].params.id = policy._id;
    tasks[0].params.rules = policy.rules.map(rule => {
      const { _id, priority, action, classification } = rule;
      return {
        id: _id,
        priority: priority,
        classification: classification,
        action: action
      };
    });
  }

  const jobs = [];
  const title = op === 'install'
    ? `Install policy ${policy.name}`
    : 'Uninstall policy';

  deviceList.forEach(dev => {
    const { _id, machineId, policies } = dev;
    jobs.push(
      deviceQueues.addJob(
        machineId,
        user.username,
        org,
        // Data
        {
          title: title,
          tasks: tasks
        },
        // Response data
        {
          method: 'mlpolicy',
          data: {
            device: { _id: _id, mlpolicy: policies.multilink },
            op: op,
            org: org
          }
        },
        // Metadata
        { priority: 'high', attempts: 1, removeOnComplete: false },
        // Complete callback
        null
      )
    );
  });
  return Promise.allSettled(jobs);
};

/**
 * Creates and queues add/remove policy jobs.
 * @async
 * @param  {Array}    deviceList    an array of the devices to be modified
 * @param  {Object}   user          User object
 * @param  {Object}   data          Additional data used by caller
 * @return {None}
 */
const apply = async (deviceList, user, data) => {
  const org = user.defaultOrg._id.toString();
  const { op, id } = data.meta;

  let MLPolicy, session;
  try {
    session = await mongoConns.getMainDB().startSession();
    await session.withTransaction(async () => {
      if (op === 'install') {
        // Retrieve policy from database
        MLPolicy = await MultiLinkPolicies.findOne(
          {
            org: org,
            _id: id,
            'rules.enabled': true
          },
          {
            rules: 1,
            name: 1,
            'rules.priority': 1,
            'rules._id': 1,
            'rules.classification': 1,
            'rules.action': 1
          }
        ).session(session);

        if (!MLPolicy) {
          throw createError(404, `policy ${id} does not exist`);
        }
      }

      // Extract the device IDs to operate on
      const deviceIds = data.devices
        ? Object.keys(data.devices)
        : [deviceList[0]._id];

      // Update devices policy in the database
      const update = op === 'install'
        ? { $set: { 'policies.multilink': { policy: MLPolicy._id, status: 'installing' } } }
        : { $set: { 'policies.multilink.status': 'uninstalling' } };

      await devices.updateMany(
        { _id: { $in: deviceIds }, org: org },
        update,
        { upsert: false }
      ).session(session);
    });
  } catch (err) {
    throw err.name === 'MongoError'
      ? new Error() : err;
  } finally {
    session.endSession();
  }

  // Queue add/remove policy jobs
  let opDevices;
  if (data.devices) {
    const selectedDevices = data.devices;
    opDevices =
        deviceList && selectedDevices
          ? deviceList.filter(device => {
            const inSelected = selectedDevices.hasOwnProperty(device._id);
            return !!inSelected;
          })
          : [];
  } else {
    opDevices = deviceList;
  }

  // Queue policy jobs. Fail the request if
  // there are jobs that failed to be queued
  const jobs = await queueMlPolicyJob(opDevices, op, MLPolicy, user, org);
  const failedToQueue = jobs.filter(job => job.status === 'rejected');
  if (failedToQueue.length !== 0) {
    const failedDevices = failedToQueue.map(ent => {
      const { job } = ent.reason;
      const { _id } = job.data.response.data.device;
      return _id;
    });

    // Update devices' policy status in the database
    await devices.updateMany(
      { _id: { $in: failedDevices }, org: org },
      { $set: { 'policies.multilink.status': 'job queue failed' } },
      { upsert: false }
    );
    throw createError(
      500,
      'Operation failed for some devices, please try again'
    );
  }

  return jobs.map(job => job.value);
};

/**
 * Called when add/remove policy is job completed.
 * Updates the status of the policy in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   job result
 * @return {void}
 */
const complete = async (jobId, res) => {
  logger.info('Policy job completed', {
    params: { result: res, jobId: jobId }
  });

  const { op, org } = res;
  const { _id } = res.device;
  try {
    const update = op === 'install'
      ? { $set: { 'policies.multilink.status': 'installed' } }
      : { $set: { 'policies.multilink': {} } };

    await devices.updateOne(
      { _id: _id, org: org },
      update,
      { upsert: false }
    );
  } catch (err) {
    logger.error('Device policy status update failed', {
      params: { jobId: jobId, res: res, err: err.message }
    });
  }
};

/**
 * Called when add/remove policy job fails and
 * Updates the status of the policy in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   job result
 * @return {void}
 */
const error = async (jobId, res) => {
  logger.error('Policy job failed', {
    params: { result: res, jobId: jobId }
  });

  const { op, org } = res;
  const { _id } = res.device;
  const formerStatus = res.device.mlpolicy.status;
  try {
    const status = op === 'install' ? 'installation failed' : formerStatus;
    await devices.updateOne(
      { _id: _id, org: org },
      { $set: { 'policies.multilink.status': status } },
      { upsert: false }
    );
  } catch (err) {
    logger.error('Device policy status update failed', {
      params: { jobId: jobId, res: res, err: err.message }
    });
  }
};

/**
 * Called when add/remove policy job is removed either
 * by user or due to expiration. This method should run
 * only for tasks that were deleted before completion/failure
 * @async
 * @param  {Object} job Kue job
 * @return {void}
 */
const remove = async (job) => {
  const { device, org } = job.data.response.data;
  const { _id, mlpolicy } = device;

  if (['inactive', 'delayed'].includes(job._state)) {
    logger.info('Rolling back policy changes for removed task', {
      params: { job: job }
    });

    try {
      await devices.updateOne(
        { _id: _id, org: org },
        { $set: { 'policies.multilink': mlpolicy } },
        { upsert: false }
      );
    } catch (err) {
      logger.error('Device policy rollback failed', {
        params: { job: job, err: err.message }
      });
    }
  }
};

module.exports = {
  apply: apply,
  complete: complete,
  error: error,
  remove: remove
};
