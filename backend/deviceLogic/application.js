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
const PurchasedApplications = require('../models/purchasedApplications');
const mongoConns = require('../mongoConns.js')();
// const configs = require('../configs')();
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});
const { devices } = require('../models/devices');
// const deviceQueues = require('../utils/deviceQueue')(
//   configs.get('kuePrefix'),
//   configs.get('redisUrl')
// );
// const { getDevicesAppIdentificationJobInfo } = require('./appIdentification');
// const appComplete = require('./appIdentification').complete;
// const appError = require('./appIdentification').error;
// const appRemove = require('./appIdentification').remove;

// const queueApplicationJob = async (
//   deviceList,
//   op,
//   requestTime,
//   application,
//   user,
//   org
// ) => {
//   const jobs = [];
//   const jobTitle =
//     op === 'install'
//       ? `Install application ${application.name}`
//       : 'Uninstall application';

//   // Extract applications information
//   const {
//     message,
//     params,
//     installIds,
//     deviceJobResp
//   } = await getDevicesAppIdentificationJobInfo(
//     org,
//     'multilink',
//     deviceList,
//     op === 'install'
//   );

//   deviceList.forEach((dev) => {
//     const { _id, machineId, policies } = dev;
//     const tasks = [
//       [
//         {
//           entity: 'agent',
//           message: `${op === 'install' ? 'add' : 'remove'}-multilink-policy`,
//           params: {}
//         }
//       ]
//     ];

//     if (op === 'install') {
//       tasks[0][0].params.id = policy._id;
//       tasks[0][0].params.rules = policy.rules.map((rule) => {
//         const { _id, priority, action, classification } = rule;
//         return {
//           id: _id,
//           priority: priority,
//           classification: classification,
//           action: action,
//         };
//       });
//     }
//     const data = {
//       policy: {
//         device: { _id: _id, mlpolicy: policies.multilink },
//         requestTime: requestTime,
//         op: op,
//         org: org,
//       },
//     };

//     // If the device's appIdentification database is outdated
//     // we add an "add-application" message as well.
//     if (installIds[_id] === true) {
//       tasks[0].unshift({
//         entity: 'agent',
//         message: message,
//         params: params,
//       });
//       data.appIdentification = {
//         deviceId: _id,
//         ...deviceJobResp,
//       };
//     }

//     jobs.push(
//       deviceQueues.addJob(
//         machineId,
//         user.username,
//         org,
//         // Data
//         {
//           title: jobTitle,
//           tasks: tasks,
//         },
//         // Response data
//         {
//           method: 'mlpolicy',
//           data: data,
//         },
//         // Metadata
//         { priority: 'high', attempts: 1, removeOnComplete: false },
//         // Complete callback
//         null
//       )
//     );
//   });
//   return Promise.allSettled(jobs);
// };

const getOpDevices = async (devicesObj, org, purchasedApp) => {
  console.log(1);
  // If the list of devices is provided in the request
  // return their IDs, otherwise, extract device IDs
  // of all devices that are currently running the policy
  const devicesList = Object.keys(devicesObj);
  if (devicesList.length > 0) return devicesList;

  // TODO: understand this flow

  console.log(2);
  // Select only devices on which the application is already
  // installed or in the process of installation, to make
  // sure the application is not reinstalled on devices that
  // are in the process of uninstalling the application.
  const { _id } = purchasedApp;
  const result = await devices.find(
    {
      org: org,
      'applications.app': _id,
      'applications.status': { $in: ['installing', 'installed'] }
    },
    { _id: 1 }
  );
  console.log(3);

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
  const { op, id } = data.meta;

  let app, session, deviceIds;
  const requestTime = Date.now();

  try {
    session = await mongoConns.getMainDB().startSession();

    await session.withTransaction(async () => {
      if (op === 'deploy') {
        app = await PurchasedApplications.findOne({
          org: org,
          _id: id
        }).session(session);

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

      const update =
        op === 'deploy'
          ? {
            $push: {
              applications: {
                app: app._id,
                status: 'installing',
                requestTime: requestTime
              }
            }
          }
          : {
            // TODO: update uninstall
            $pull: { applications: { app: id } }
            // $pull: {
            //   "applications.status": "uninstalling",
            // },
          };

      const query = {
        _id: { $in: deviceIds },
        org: org
      };

      if (op === 'deploy') {
        query['applications.app'] = { $ne: app._id };
      }

      await devices.updateMany(query, update,
        { upsert: false }
      ).session(session);
    });
  } catch (error) {
    console.log(error.message);
    throw error.name === 'MongoError' ? new Error() : error;
  } finally {
    session.endSession();
  }

  // Queue applications jobs. Fail the request if
  // there are jobs that failed to be queued
  // const deviceIdsSet = new Set(deviceIds.map((id) => id.toString()));
  // const opDevices = deviceList.filter((device) => {
  //  return deviceIdsSet.has(device._id.toString());
  // });

  // const jobs = await queueApplicationJob(
  //   opDevices,
  //   op,
  //   requestTime,
  //   app,
  //   user,
  //   org
  // );

  // const failedToQueue = [];
  // const succeededToQueue = [];
  // jobs.forEach((job) => {
  //   switch (job.status) {
  //     case "rejected": {
  //       failedToQueue.push(job);
  //       break;
  //     }
  //     case "fulfilled": {
  //       const { id } = job.value;
  //       succeededToQueue.push(id);
  //       break;
  //     }
  //     default: {
  //       break;
  //     }
  //   }
  // });

  // let status = 'completed';
  // let message = '';
  // if (failedToQueue.length !== 0) {
  //   const failedDevices = failedToQueue.map(ent => {
  //     const { job } = ent.reason;
  //     const { _id } = job.data.response.data.application.device;
  //     return _id;
  //   });

  //   logger.error('Application jobs queue failed', {
  //     params: { jobId: failedToQueue[0].reason.job.id, devices: failedDevices }
  //   });

  //   // Update devices application status in the database
  //   await devices.updateMany(
  //     { _id: { $in: failedDevices }, org: org },
  //     { $set: { 'applications.status': 'job queue failed' } }, // TODO: update just nested app
  //     { upsert: false }
  //   );

  //   status = 'partially completed';
  //   message = `${succeededToQueue.length} of ${jobs.length} application jobs added`;
  // }

  // return {
  //   ids: succeededToQueue,
  //   status,
  //   message
  // };

  return {
    ids: [1, 2, 3],
    status: 'completed',
    message: ''
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

  const { op, org } = res.application;
  const { _id } = res.application.device;
  try {
    const update = op === 'install'
      ? { $set: { 'applications.status': 'installed' } }
      : { $set: { applications: [] } }; // TODO: fix uninstall

    await devices.updateOne(
      { _id: _id, org: org },
      update,
      { upsert: false }
    );

  //   // Call appIdentification complete callback if needed
  //   if (res.appIdentification) {
  //     res = res.appIdentification;
  //     appComplete(jobId, res);
  //   }
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

  // const { policy } = res;
  // const { op, org } = policy;
  // const { _id } = policy.device;
  // try {
  //   const status = `${op === 'install' ? '' : 'un'}installation failed`;
  //   await devices.updateOne(
  //     { _id: _id, org: org },
  //     { $set: { 'policies.multilink.status': status } },
  //     { upsert: false }
  //   );

  //   // Call appIdentification error callback if needed
  //   if (res.appIdentification) {
  //     res = res.appIdentification;
  //     appError(jobId, res);
  //   }
  // } catch (err) {
  //   logger.error('Device policy status update failed', {
  //     params: { jobId: jobId, res: res, err: err.message }
  //   });
  // }
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
  // const { device, org, requestTime } = job.data.response.data.policy;
  // const { _id } = device;

  // if (['inactive', 'delayed'].includes(job._state)) {
  //   logger.info('Policy job removed', {
  //     params: { job: job }
  //   });

  //   // Set the status to "job deleted" only
  //   // for the last policy related job.
  //   const status = 'job deleted';
  //   try {
  //     await devices.updateOne(
  //       {
  //         _id: _id,
  //         org: org,
  //         'policies.multilink.requestTime': { $eq: requestTime }
  //       },
  //       { $set: { 'policies.multilink.status': status } },
  //       { upsert: false }
  //     );

  //     // Call applications remove callback if needed
  //     const { appIdentification } = job.data.response.data;
  //     if (appIdentification) {
  //       job.data.response.data = appIdentification;
  //       appRemove(job);
  //     }
  //   } catch (err) {
  //     logger.error('Device policy status update failed', {
  //       params: { job: job, status: status, err: err.message }
  //     });
  //   }
  // }
};

module.exports = {
  apply: apply,
  complete: complete,
  error: error,
  remove: remove
};
