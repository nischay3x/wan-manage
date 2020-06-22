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
const ObjectId = require('mongoose').Types.ObjectId;
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

  // filter out subnets that already in used on devices
  const subnets = [...application.configuration.subnets.filter(s => s.device == null)];

  for (let i = 0; i < deviceList.length; i++) {
    const dev = deviceList[i];

    const { _id, machineId, interfaces } = dev;

    const appName = application.app.name;
    const wanIp = interfaces.find(ifc => ifc.type === 'WAN' && ifc.isAssigned).IPv4;

    let message = '';

    if (appName === 'Open VPN') {
      if (op === 'deploy') message = 'install-vpn-application';
      // if (op === 'deploy') message = 'install-application';
      else if (op === 'upgrade') message = 'upgrade-vpn-server';
      else if (op === 'config') message = 'modify-vpn-server';
      // else message = 'remove-vpn-server';
      else message = 'uninstall-vpn-application';
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
      // get new subnet only if there is no subnet connect with current device
      let deviceSubnet = '';
      const exists = application.configuration.subnets.find(
        s => s.device && (s.device.toString() === dev._id.toString())
      );
      if (exists) deviceSubnet = exists;
      else deviceSubnet = subnets.shift();

      // deviceSubnet equal to null means
      // that vpn installed on more devices then assigned subnets
      if (!deviceSubnet) {
        const msg = 'You don\'t have enoughs subnets to all devices';
        throw createError(500, msg);
      }

      // set subnet to device to prevent same subnet on multiple devices
      await applications.updateOne(
        {
          _id: application._id,
          'configuration.subnets.subnet': deviceSubnet.subnet
        },
        { $set: { 'configuration.subnets.$.device': _id } }
      );

      tasks[0][0].params.id = application._id;
      tasks[0][0].params.name = application.app.name;
      tasks[0][0].params.version = application.installedVersion;
      tasks[0][0].params.routeAllOverVpn = routeAllOverVpn;
      tasks[0][0].params.remoteClientIp = deviceSubnet.subnet;
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
  }

  return Promise.allSettled(jobs);
};

// const getOpDevices = async (devicesObj, org, purchasedApp) => {
//   // If the list of devices is provided in the request
//   // return their IDs, otherwise, extract device IDs
//   // of all devices that are currently running the application
//   const devicesList = Object.keys(devicesObj);
//   if (devicesList.length > 0) return devicesList;

//   // TODO: understand this flow
//   // Select only devices on which the application is already
//   // installed or in the process of installation, to make
//   // sure the application is not reinstalled on devices that
//   // are in the process of uninstalling the application.
//   const { _id } = purchasedApp;
//   const result = await devices.find(
//     {
//       org: org,
//       'applications.app': _id,
//       'applications.status': { $nin: ['installing', 'installed'] }
//     },
//     { _id: 1 }
//   );

//   return result.map((device) => device._id);
// };

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

      // if the user select multiple devices, then the request is sent to devicesApplyPOST
      // and the deviceList variable include all the devices event they are not selected.
      // here we check the data.devices to take only those selected by the user
      // if the user select only one device, then data.devices should equals to null
      if (data.devices) {
        deviceList = deviceList.filter(d => data.devices.hasOwnProperty(d._id));
      }
      deviceIds = deviceList.map(d => d._id);

      // Prevent install removed app
      if (op === 'deploy') {
        if (!app) {
          throw createError(500, `application ${id} does not purchased`);
        }

        if (app.removed) {
          throw createError(500, `cannot deploy removed application ${id}`);
        }

        // prevent to install if all the subnets is already taken by other devices
        // or if the user selected multiple devices to install
        // but there is not enoughs subnets
        const freeSubnets = app.configuration.subnets.filter(s => {
          if (s.device === null) return true;
          const isCurrentDevice = deviceIds.map(d => d.toString()).includes(s.device.toString());
          return isCurrentDevice;
        });

        if (freeSubnets.length === 0 || freeSubnets.length < deviceIds.length) {
          throw createError(500,
            'There is no subnets remaining, please check again the configuration'
          );
        }
      }

      // Save status in the devices
      const query = {
        _id: { $in: deviceIds },
        org: org
      };

      let update;

      if (op === 'deploy') {
        // Filter out if app already installed to prevent duplication.
        for (let i = 0; i < deviceList.length; i++) {
          const device = deviceList[i];

          const appExists = (device.applications || []).find(
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

          await devices
            .updateOne(query, update, { upsert: false })
            .session(session);
        }

        // set update to null because we are already update the db
        update = null;
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
    } else if (op === 'uninstall') {
      // release subnet
      await releaseSubnetForDevice(org, app._id, ObjectId(_id));
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

      // release the subnet if deploy job removed before he start
      if (op === 'deploy') {
        await releaseSubnetForDevice(org, app._id, ObjectId(_id));
      }
    } catch (err) {
      logger.error('Device application status update failed', {
        params: { job: job, status: status, err: err.message }
      });
    }
  }
};

/**
 * Release subnet assigned to device
 * @async
 * @param  {ObjectId} org org id to filter by
 * @param  {ObjectId} appId app id to filter by
 * @param  {ObjectId} deviceId device to release
 * @return {void}
 */
const releaseSubnetForDevice = async (org, appId, deviceId) => {
  await applications.updateOne(
    {
      org: org,
      _id: appId,
      'configuration.subnets.device': ObjectId(deviceId)
    },
    { $set: { 'configuration.subnets.$.device': null } }
  );
};

module.exports = {
  apply: apply,
  complete: complete,
  error: error,
  remove: remove
};
