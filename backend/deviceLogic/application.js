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
const applications = require('../models/applications');
const mongoConns = require('../mongoConns.js')();
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});
const { devices } = require('../models/devices');
const ObjectId = require('mongoose').Types.ObjectId;

const {
  onJobComplete,
  onJobRemoved,
  onJobFailed,
  validateApplication,
  getAppAdditionsQuery
} = require('../applicationLogic/applications');

const { queueApplicationJob } = require('./modifyDevice');

/**
 * Creates and queues applications jobs.
 * @async
 * @param  {Array}    deviceList    an array of the devices to be modified
 * @param  {Object}   user          User object
 * @param  {Object}   data          Additional data used by caller
 * @return {None}
 */
const apply = async (deviceList, user, data) => {
  const { org } = data;
  const { op, id } = data.meta;

  let app, session, deviceIds;
  const requestTime = Date.now();

  try {
    session = await mongoConns.getMainDB().startSession();

    await session.withTransaction(async () => {
      // Get application
      app = await applications.findOne({
        org: org,
        _id: id
      }).populate('appStoreApp').lean().session(session);

      if (!app) {
        throw createError(500, 'The requested app was not purchased');
      }

      // if the user selected multiple devices, the request goes to devicesApplyPOST function
      // and the deviceList variable here contain *all* the devices even they are not selected.
      // therefore we need to filter this array by devices array that comes from request body.
      // if the user select only one device, the data.devices is equals to null
      // and this device is passed in the url path
      if (data.devices) {
        deviceList = deviceList.filter(d => data.devices.hasOwnProperty(d._id));
      }

      // get the devices id by updated device list
      deviceIds = deviceList.map(d => d._id.toString());

      const { valid, err } = validateApplication(app, op, deviceIds);
      if (!valid) {
        throw createError(500, err);
      }

      // Save status in the devices
      const query = {
        _id: { $in: deviceIds },
        org: org
      };

      let update;

      if (op === 'install' || op === 'uninstall') {
        for (let i = 0; i < deviceList.length; i++) {
          const device = deviceList[i];
          const query = { _id: device._id };

          let additions = {};
          if (op === 'install') {
            const appExists = device.applications && device.applications.find(
              a => a.app && a.app.toString() === app._id.toString());

            if (appExists) {
              query['applications.app'] = id;
              update = {
                $set: { 'applications.$.status': 'installing' }
              };
            } else {
              update = {
                $push: {
                  applications: {
                    app: app._id,
                    status: 'installing',
                    requestTime: requestTime
                  }
                }
              };
            }

            // check if need to install more things for the application
            additions = getAppAdditionsQuery(app, device, op);
          } else {
            query['applications.app'] = id;
            update = {
              $set: { 'applications.$.status': 'uninstalling' }
            };

            // check if need to remove more things related the application
            additions = getAppAdditionsQuery(app, device, op);
          }

          if (!update.$set) {
            update.$set = additions;
          } else {
            update.$set = {
              ...update.$set,
              ...additions
            };
          }

          await devices.updateOne(query, update, { upsert: false }).session(session);
        }

        // set update to null because we are already updated in this case
        update = null;
      } else if (op === 'upgrade') {
        query['applications.app'] = id;

        update = {
          $set: { 'applications.$.status': 'upgrading' }
        };
      }

      if (update) {
        await devices.updateMany(query, update, { upsert: false }).session(session);
      }
    });
  } catch (error) {
    throw error.name === 'MongoError' ? new Error() : error;
  } finally {
    session.endSession();
  }

  // Queue applications jobs. Fail the request if
  // there are jobs that failed to be queued
  const jobs = await queueApplicationJob(
    deviceList,
    op,
    requestTime,
    app,
    user,
    org
  );

  const failedToQueue = [];
  const succeededToQueue = [];
  jobs.forEach((job) => {
    switch (job.status) {
      case 'rejected': {
        failedToQueue.push(job);
        break;
      }
      case 'fulfilled': {
        const { id } = job.value;
        succeededToQueue.push(id);
        break;
      }
      default: {
        break;
      }
    }
  });

  let status = 'completed';
  let message = '';
  if (failedToQueue.length !== 0) {
    const failedDevices = failedToQueue.map((ent) => {
      const { job } = ent.reason;
      const { _id } = job.data.response.data.application.device;
      return _id;
    });

    logger.error('Application jobs queue failed', {
      params: { jobId: failedToQueue[0].reason.job.id, devices: failedDevices }
    });

    // Update devices application status in the database
    await devices.updateMany(
      {
        _id: { $in: failedDevices },
        org: org,
        'applications.app': app._id
      },
      { $set: { 'applications.$.status': 'job queue failed' } },
      { upsert: false }
    );

    status = 'partially completed';
    message = `${succeededToQueue.length} of ${jobs.length} application jobs added`;
  }

  return {
    ids: succeededToQueue,
    status,
    message
  };
};

/**
 * Called when add/remove application is job completed.
 * Updates the status of the application in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   job result
 * @return {void}
 */
const complete = async (jobId, res) => {
  logger.info('Application job completed', {
    params: { result: res, jobId: jobId }
  });

  const { op, org, app } = res.application;
  const { _id } = res.application.device;
  try {
    const update = {};
    if (op === 'uninstall') {
      update.$pull = { applications: { app: app._id } };
    } else { // install, configure, upgrade
      update.$set = { 'applications.$.status': 'installed' };
    }

    // on complete, update db with updated data
    if (op === 'upgrade') {
      // update version on db
      await applications.updateOne(
        { org: org, _id: app._id },
        { $set: { installedVersion: app.appStoreApp.latestVersion, pendingToUpgrade: false } }
      );
    }

    await devices.updateOne(
      {
        _id: _id,
        org: org,
        'applications.app': app._id
      },
      update,
      { upsert: false }
    );

    // do actions on job complete
    await onJobComplete(org, app, op, ObjectId(_id));
  } catch (err) {
    logger.error('Device application status update failed', {
      params: { jobId: jobId, res: res, err: err.message }
    });
  }
};

/**
 * Called when add/remove application job fails and
 * Updates the status of the application in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   job result
 * @return {void}
 */
const error = async (jobId, res) => {
  logger.error('Application job failed', {
    params: { result: res, jobId: jobId }
  });

  const { op, org, app } = res.application;
  const { _id } = res.application.device;

  try {
    let status = '';

    switch (op) {
      case 'install':
        status = 'installation failed';
        break;
      case 'config':
        status = 'configuration failed';
        break;
      case 'uninstall':
        status = 'uninstallation failed';
        break;
      default:
        status = 'job failed';
        break;
    }

    await devices.updateOne(
      { _id: _id, org: org, 'applications.app': app._id },
      { $set: { 'applications.$.status': status } },
      { upsert: false }
    );

    // do actions on job failed
    await onJobFailed(org, app, op, _id);
  } catch (err) {
    logger.error('Device policy status update failed', {
      params: { jobId: jobId, res: res, err: err.message }
    });
  }
};

/**
 * Called when add/remove application job is removed either
 * by user or due to expiration. This method should run
 * only for tasks that were deleted before completion/failure
 * @async
 * @param  {Object} job Kue job
 * @return {void}
 */
const remove = async (job) => {
  const { org, app, device, op } = job.data.response.data.application;
  const { _id } = device;

  if (['inactive', 'delayed'].includes(job._state)) {
    logger.info('Application job removed', {
      params: { job: job }
    });
    // Set the status to "job deleted" only
    // for the last policy related job.
    const status = 'job deleted';
    try {
      await devices.updateOne(
        {
          _id: _id,
          org: org,
          'applications.app': app._id
        },
        { $set: { 'applications.$.status': status } },
        { upsert: false }
      );

      // do actions on app removed
      await onJobRemoved(org, app, op, ObjectId(_id));
    } catch (err) {
      logger.error('Device application status update failed', {
        params: { job: job, status: status, err: err.message }
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
