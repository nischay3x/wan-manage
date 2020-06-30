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

const {
  generateKeys,
  generateCA,
  generateTlsKey
  // generateDhKeys
} = require('../utils/certificates');

const getDeviceSubnet = (subnets, deviceId) => {
  // if already assigned device   subnet, return this subnet
  const exists = subnets.find(
    s => s.device && (s.device.toString() === deviceId)
  );

  if (exists) return exists;
  else return subnets.shift();
};

const getDeviceKeys = application => {
  let isNew = false;
  let caPrivateKey;
  let caPublicKey;
  let serverKey;
  let serverCrt;
  let tlsKey;

  if (!application.configuration.keys) {
    isNew = true;
    const ca = generateCA();
    const server = generateKeys(ca.privateKey);
    tlsKey = generateTlsKey();
    caPrivateKey = ca.privateKey;
    caPublicKey = ca.publicKey;
    serverKey = server.privateKey;
    serverCrt = server.publicKey;
  } else {
    caPrivateKey = application.configuration.keys.caKey;
    caPublicKey = application.configuration.keys.caCrt;
    serverKey = application.configuration.keys.serverKey;
    serverCrt = application.configuration.keys.serverCrt;
    tlsKey = application.configuration.keys.tlsKey;
  }

  return {
    isNew: isNew,
    caPrivateKey,
    caPublicKey,
    serverKey,
    serverCrt,
    tlsKey
  };
};

const getOpenVpnParams = async (device, applicationId, op) => {
  const params = {};
  const { _id, interfaces } = device;

  const application = await applications.findOne({ _id: applicationId }).populate('app').lean();

  if (op === 'deploy' || op === 'config' || op === 'upgrade') {
    // get the WanIp to be used by open vpn server to listen
    const wanIp = interfaces.find(ifc => ifc.type === 'WAN' && ifc.isAssigned).IPv4;

    // get new subnet only if there is no subnet connect with current device
    const deviceSubnet = getDeviceSubnet(application.configuration.subnets, _id.toString());

    // deviceSubnet equal to null means
    // that vpn installed on more devices then assigned subnets
    if (!deviceSubnet) {
      const msg = 'You don\'t have enoughs subnets to all devices';
      throw createError(500, msg);
    }

    const update = {
      'configuration.subnets.$.device': _id
    };

    const {
      isNew, caPrivateKey, caPublicKey,
      serverKey, serverCrt, tlsKey
    } = getDeviceKeys(application);

    // if is new keys, save them on db
    if (isNew) {
      update['configuration.keys.caKey'] = caPrivateKey;
      update['configuration.keys.caCrt'] = caPublicKey;
      update['configuration.keys.serverKey'] = serverKey;
      update['configuration.keys.serverCrt'] = serverCrt;
      update['configuration.keys.tlsKey'] = tlsKey;
    }

    // set subnet to device to prevent same subnet on multiple devices
    await applications.updateOne(
      {
        _id: application._id,
        'configuration.subnets.subnet': deviceSubnet.subnet
      },
      { $set: update }
    );

    let version = application.installedVersion;
    if (op === 'upgrade') {
      version = application.app.latestVersion;
    }

    params.version = version;
    params.routeAllOverVpn = application.configuration.routeAllOverVpn;
    params.remoteClientIp = deviceSubnet.subnet;
    params.deviceWANIp = wanIp;
    params.caKey = caPrivateKey;
    params.caCrt = caPublicKey;
    params.serverKey = serverKey;
    params.serverCrt = serverCrt;
    params.tlsKey = tlsKey;
    // params.dhKey = dhKey;
  }
  // else if (op === 'upgrade') {
  //   params.version = application.installedVersion;
  // }

  return params;
};

/**
 * Creates the job parameters based on application name.
 * @async
 * @param  {Object}   device      device to be modified
 * @param  {Object}   application application object
 * @param  {String}   op          operation type
 * @return {Object}               parameters object
 */
const getJobParams = async (device, application, op) => {
  const appName = application.app.name;

  if (appName === 'Open VPN') {
    return {
      type: 'open-vpn',
      name: appName,
      config: await getOpenVpnParams(device, application._id, op)
    };
  }

  return {};
};

const queueApplicationJob = async (
  deviceList,
  op,
  requestTime,
  application,
  user,
  org
) => {
  const jobs = [];

  // set job title to be shown to the user on Jobs screen
  // and job message to be handle by the device
  let jobTitle = '';
  let message = '';
  if (op === 'deploy') {
    jobTitle = `Install ${application.app.name} application`;
    // message = 'install-vpn-application';
    message = 'install-service';
  } else if (op === 'upgrade') {
    jobTitle = `Upgrade ${application.app.name} application`;
    // message = 'upgrade-vpn-server';
    message = 'upgrade-service';
  } else if (op === 'config') {
    jobTitle = `Update ${application.app.name} configuration`;
    // message = 'modify-vpn-server';
    message = 'modify-service';
  } else if (op === 'uninstall') {
    jobTitle = `Uninstall ${application.app.name} application`;
    // message = 'uninstall-vpn-application';
    message = 'uninstall-service';
  } else {
    return jobs;
  }

  // generate job for each selected device
  for (let i = 0; i < deviceList.length; i++) {
    const dev = deviceList[i];

    const params = await getJobParams(dev, application, op);

    const tasks = [
      [
        {
          entity: 'agent',
          message: message,
          params: params
        }
      ]
    ];

    // response data
    const data = {
      application: {
        device: { _id: dev._id },
        app: application,
        requestTime: requestTime,
        op: op,
        org: org
      }
    };

    jobs.push(
      deviceQueues.addJob(
        dev.machineId,
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

        // app.installedVersion = newVersion; // TODO: need to test it
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
      ).populate('app').lean();

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
