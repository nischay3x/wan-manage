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
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const tunnelsModel = require('../models/tunnels');
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });
const { getMajorVersion } = require('../versioning');

/**
 * Creates and queues the stop-router job.
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const apply = async (device, user, data) => {
  logger.info('Stopping device:', {
    params: { machineId: device[0].machineId, user: user, data: data }
  });
  deviceStatus.setDeviceStatsField(device[0].machineId, 'state', 'pending');

  const userName = user.username;
  const org = user.defaultOrg._id.toString();
  const machineID = device[0].machineId;
  const majorAgentVersion = getMajorVersion(device[0].versions.agent);

  // Stop router command might change IP address of the
  // interface connected to the MGMT. Tell the agent to
  // reconnect to the MGMT after processing this command.
  const stopParams = { reconnect: true };
  const tasks = [{ entity: 'agent', message: 'stop-router', params: stopParams }];

  try {
    const job = await deviceQueues.addJob(
      machineID,
      userName,
      org,
      // Data
      { title: 'Stop device ' + device[0].hostname, tasks: tasks },
      // Response data
      {
        method: 'stop',
        data: {
          device: device[0]._id,
          org: org,
          shouldUpdateTunnel: majorAgentVersion === 0
        }
      },
      // Metadata
      { priority: 'medium', attempts: 1, removeOnComplete: false },
      // Complete callback
      null
    );

    logger.info('Stop device job queued', { params: { job } });
    return { ids: [job.id], status: 'completed', message: '' };
  } catch (err) {
    logger.error('Stop device job failed', { params: { machineID, error: err.message } });
    throw (new Error(err.message || 'Internal server error'));
  }
};

/**
 * Called when stop device job completed and
 * marks tunnels for this device as not connected
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const complete = (jobId, res) => {
  logger.info('Stop Machine complete', { params: { result: res, jobId: jobId } });
  if (!res || !res.device || !res.org) {
    logger.warn('Got an invalid job result', { params: { result: res, jobId: jobId } });
    return;
  }
  // Get all device tunnels and mark them as not connected.
  // shouldUpdateTunnel is set for agent v0.X.X where tunnel
  // status is not checked, therefore updating according to
  // the DB status
  if (res.shouldUpdateTunnel) {
    tunnelsModel
      .updateMany(
        // Query
        {
          isActive: true,
          $or: [{ deviceAconf: true }, { deviceBconf: true }],
          // eslint-disable-next-line no-dupe-keys
          $or: [{ deviceA: mongoose.Types.ObjectId(res.device) },
            { deviceB: mongoose.Types.ObjectId(res.device) }],
          org: res.org
        },
        // Update
        { deviceAconf: false, deviceBconf: false },
        // Options
        { upsert: false })
      .then((resp) => {
        logger.debug('Updated tunnels info in db', { params: { jobId: jobId, response: resp } });
        if (resp != null) {
          logger.info('Updated device tunnels status to not-connected', {
            params: { jobId: jobId, device: res.device }
          });
        } else {
          throw new Error('Update tunnel connected status failure');
        }
      }, (err) => {
        logger.error('Stop device callback failed', { params: { jobId: jobId, err: err.message } });
      })
      .catch((err) => {
        logger.error('Stop device callback failed', { params: { jobId: jobId, err: err.message } });
      });
  }
};

module.exports = {
  apply: apply,
  complete: complete
};
