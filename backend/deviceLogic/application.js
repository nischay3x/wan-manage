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
const configs = require('../configs')();
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});
const { devices } = require('../models/devices');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
// const appComplete = require('./appIdentification').complete;
// const appError = require('./appIdentification').error;
// const appRemove = require('./appIdentification').remove;

const queueApplicationJob = async (
  deviceList,
  op,
  requestTime,
  application,
  user,
  org
) => {
  const jobs = [];

  let jobTitle = '';

  switch (op) {
    case 'deploy': jobTitle = `Install ${application.app.name} application`; break;
    case 'upgrade': jobTitle = `Upgrade ${application.app.name} application`; break;
    case 'config': jobTitle = `Update ${application.app.name} configuration`; break;
    case 'uninstall': jobTitle = `Uninstall ${application.app.name} application`; break;
    default: jobTitle = `Application ${application.app.name}`;
  }

  const subnets = [...application.configuration.subnets];

  deviceList.forEach((dev) => {
    const { _id, machineId, interfaces } = dev;

    const appName = application.app.name;
    const wanIp = interfaces.find(ifc => ifc.type === 'WAN' && ifc.isAssigned).IPv4;

    let message = '';

    if (appName === 'Open VPN') {
      if (op === 'deploy') message = 'install-vpn-server';
      else if (op === 'upgrade') message = 'upgrade-vpn-server';
      else if (op === 'config') message = 'config-vpn-server';
      else message = 'remove-vpn-server';
    }

    const tasks = [
      [
        {
          entity: 'agent',
          message: message,
          params: {}
        }
      ]
    ];

    const {
      routeAllOverVpn
    } = application.configuration;

    if (op === 'deploy' || op === 'config') {
      tasks[0][0].params.id = application._id;
      tasks[0][0].params.name = application.app.name;
      tasks[0][0].params.version = application.installedVersion;
      tasks[0][0].params.routeAllOverVpn = routeAllOverVpn;
      tasks[0][0].params.remoteClientIp = subnets.shift();
      tasks[0][0].params.deviceWANIp = wanIp;

      if (op === 'deploy') {
        tasks[0].push({
          entity: 'agent',
          message: 'config-vpn-server',
          params: {
            ...tasks[0][0].params
          }
        });
      }
    } else if (op === 'upgrade') {
      tasks[0][0].params.id = application._id;
      tasks[0][0].params.name = application.app.name;
      tasks[0][0].params.version = application.installedVersion;
      tasks[0][0].params.deviceWANIp = wanIp;
    } else {
      tasks[0][0].params.id = application._id;
      tasks[0][0].params.name = application.app.name;
    }

    // response data
    const data = {
      application: {
        device: { _id: _id },
        app: application,
        requestTime: requestTime,
        op: op,
        org: org
      }
    };

    jobs.push(
      deviceQueues.addJob(
        machineId,
        user.username,
        org,
        // Data
        {
          title: jobTitle,
          tasks: tasks[0]
        },
        // Response data
        {
          method: 'application',
          data: data
        },
        // Metadata
        { priority: 'high', attempts: op === 'deploy' ? 2 : 1, removeOnComplete: false },
        // Complete callback
        null
      )
    );
  });
  return Promise.allSettled(jobs);
};

const getOpDevices = async (devicesObj, org, purchasedApp) => {
  // If the list of devices is provided in the request
  // return their IDs, otherwise, extract device IDs
  // of all devices that are currently running the application
  const devicesList = Object.keys(devicesObj);
  if (devicesList.length > 0) return devicesList;

  // TODO: understand this flow
  // Select only devices on which the application is already
  // installed or in the process of installation, to make
  // sure the application is not reinstalled on devices that
  // are in the process of uninstalling the application.
  const { _id } = purchasedApp;
  const result = await devices.find(
    {
      org: org,
      'applications.app': _id,
      'applications.status': { $nin: ['installing', 'installed'] }
    },
    { _id: 1 }
  );

  return result.map((device) => device._id);
};

/**
 * Creates and queues add/remove deploy application jobs.
 * @async
 * @param  {Array}    deviceList    an array of the devices to be modified
 * @param  {Object}   user          User object
 * @param  {Object}   data          Additional data used by caller
 * @return {None}
 */
const apply = async (deviceList, user, data) => {
  const { org } = data;
  const { op, id, newVersion } = data.meta;

  let app, session, deviceIds;
  const requestTime = Date.now();

  try {
    session = await mongoConns.getMainDB().startSession();

    await session.withTransaction(async () => {
      // Get application
      app = await applications.findOne({
        org: org,
        _id: id
      })
        .populate('app')
        .lean()
        .session(session);

      // Prevent install removed app
      if (op === 'deploy') {
        if (!app) {
          throw createError(404, `application ${id} does not purchased`);
        }

        if (app.removed) {
          throw createError(404, `cannot deploy removed application ${id}`);
        }
      }

      // Extract the device IDs to operate on
      deviceIds = data.devices
        ? await getOpDevices(data.devices, org, app)
        : [deviceList[0]._id];

      // Save status in the devices
      const query = {
        _id: { $in: deviceIds },
        org: org
      };

      let update;

      if (op === 'deploy') {
        // Filter out if app already installed to prevent duplication.
        query['applications.app'] = { $ne: app._id };

        update = {
          $push: {
            applications: {
              app: app._id,
              status: 'installing',
              requestTime: requestTime
            }
          }
        };
      } else if (op === 'upgrade') {
        query['applications.app'] = id;

        update = {
          $set: { 'applications.$.status': 'upgrading' }
        };

        app.installedVersion = newVersion; // TODO: need to test it
      } else if (op === 'config') {
        query['applications.app'] = id;

        update = {
          $set: { 'applications.$.status': 'installing' }
        };
      } else if (op === 'uninstall') {
        query['applications.app'] = id;

        update = {
          $set: { 'applications.$.status': 'uninstalling' }
        };
      }

      if (update) {
        await devices
          .updateMany(query, update, { upsert: false })
          .session(session);
      }
    });
  } catch (error) {
    console.log(error.message);
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

  console.log('jobs', jobs);
  console.log('succeededToQueue', succeededToQueue);
  console.log('failedToQueue', failedToQueue);

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
    const update =
      op === 'deploy' || op === 'upgrade' || op === 'config'
        ? { $set: { 'applications.$.status': 'installed' } }
        : { $set: { 'applications.$.status': 'uninstalled' } };

    // update version on db
    if (op === 'upgrade') {
      // TODO: need to improve this part
      const updatedApp = await applications.findOne(
        { org: org, _id: app._id }
      ).populate('app');

      await applications.updateOne(
        { org: org, _id: app._id },
        { $set: { installedVersion: updatedApp.app.latestVersion, pendingToUpgrade: false } }
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
  } catch (err) {
    logger.error('Device application status update failed', {
      params: { jobId: jobId, res: res, err: err.message }
    });
  }
};

/**
 * Called when add/remove application job fails and
 * Updates the status of the policy in the database.
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

  console.log('op', op);
  console.log('org', org);
  console.log('app', app);
  console.log('_id', _id);
  console.log('app._id', app._id);

  try {
    const status = `${op === 'deploy' || op === 'config' ? '' : 'un'}installation failed`;
    await devices.updateOne(
      { _id: _id, org: org, 'applications.app': app._id },
      { $set: { 'applications.$.status': status } },
      { upsert: false }
    );
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
  const { org, app, device } = job.data.response.data.application;
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
