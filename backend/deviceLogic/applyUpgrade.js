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
const deviceStatus = require('../periodic/deviceStatus')();
const DevSwUpdater = require('./DevSwVersionUpdateManager');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

/**
 * Queues upgrade jobs to a list of devices.
 * @param  {Array}   devices       array of devices to which an upgrade job should be queued
 * @param  {string}  user          user name of the user the queued the job
 * @param  {string}  org           id of the organization to which the user belongs
 * @param  {string}  targetVersion the version to which the device will be upgraded
 * @return {Promise}               a promise for queuing an upgrade job
 */
const queueUpgradeJobs = (devices, user, org, targetVersion) => {
  const tasks = [{
    entity: 'agent',
    message: 'upgrade-device-sw',
    params: { version: targetVersion }
  }];
  const jobs = [];
  devices.forEach(dev => {
    deviceStatus.setDeviceState(dev.machineId, 'pending');
    jobs.push(
      deviceQueues.addJob(dev.machineId, user, org,
        // Data
        { title: `Upgrade device ${dev.hostname}`, tasks: tasks },
        // Response data
        { method: 'upgrade', data: { device: dev._id, org: org } },
        // Metadata
        { priority: 'medium', attempts: 1, removeOnComplete: false },
        // Complete callback
        null)
    );
  });

  return Promise.all(jobs);
};

/**
 * Applies the upgrade request on all requested devices
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const apply = async (opDevices, user, data) => {
  // opDevices is a filtered array of selected devices (mongoose objects)
  // upgrade job will be sent for every device even if it is scheduled already
  const swUpdater = DevSwUpdater.getSwVerUpdaterInstance();
  const version = await swUpdater.getLatestDevSwVersion();
  const userName = user.username;
  const org = data.org;
  const jobResults = await queueUpgradeJobs(opDevices, userName, org, version);
  jobResults.forEach(job => {
    logger.info('Upgrade device job queued', {
      params: { jobId: job.id, version: version },
      job: job
    });
  });

  return { ids: jobResults.map(job => job.id), status: 'completed', message: '' };
};

/**
 * Called if upgrade device job fails.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const error = async (jobId, res) => {
  logger.warn('Device Upgrade failed', { params: { result: res, jobId: jobId } });
};

/**
 * Called if upgrade device job was removed.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const remove = async (job) => {
  if (['inactive', 'delayed', 'active'].includes(job._state)) {
    logger.info('Device Upgrade job removed', { params: { job: job } });
  }
};

module.exports = {
  apply: apply,
  queueUpgradeJobs: queueUpgradeJobs,
  error: error,
  remove: remove
};
