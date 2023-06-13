/* eslint-disable max-len */
// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2021  flexiWAN Ltd.

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
const { validateDevice } = require('./validators');
const { getAllOrganizationSubnets } = require('../utils/orgUtils');
const notificationsConf = require('../models/notificationsConf');
const { devices } = require('../models/devices');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });
const deviceNotificationTypes = ['Device memory usage', 'Hard drive usage', 'Link/Tunnel round trip time', 'Link/Tunnel default drop rate', 'Temperature'];

/**
 * Creates and queues the set-notifications-config job.
 * @async
 * @param  {Array}    devicesList    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller includes the orgId and the rules
 * @param  {Object}   org       The organization Id
 * @param  {Object}   rules     object in which: keys= notification event name, values = notification settings
 * @return {None}
 */

const apply = async (devicesList, user, data) => {
  const { org: orgId, rules } = data;
  const filteredRules = Object.keys(rules)
    .filter(event => deviceNotificationTypes.includes(event))
    .reduce((obj, key) => {
      obj[key] = rules[key];
      return obj;
    }, {});
  const opDevices = await Promise.all(devicesList.map(d => d.populate('policies.firewall.policy', '_id name rules')
    .populate('interfaces.pathlabels', '_id name description color type')
    .execPopulate()
  ));
  const errors = [];
  let orgSubnets = [];
  if (configs.get('forbidLanSubnetOverlaps', 'boolean')) {
    orgSubnets = await getAllOrganizationSubnets(mongoose.Types.ObjectId(orgId));
  }
  const applyPromises = [];
  const tasks = [{ entity: 'agent', message: 'add-notifications-config', params: { org: orgId, rules: filteredRules } }];
  for (const device of opDevices) {
    const { machineId } = device;
    logger.info('Set device notifications:', { params: { machineId, user, data } });

    const { valid, err } = validateDevice(device.toObject(), true, orgSubnets);
    if (!valid) {
      logger.warn("Set device notifications command's validation failed",
        { params: { device, err } });
      if (!errors.includes(err)) {
        errors.push(err);
      }
      continue;
    }
    applyPromises.push(deviceQueues
      .addJob(
        machineId,
        user,
        orgId,
        // Data
        { title: 'Setting notifications for device: ' + device.hostname, tasks: tasks },
        // Response data
        {
          method: 'notifications',
          data: {
            device: device._id,
            org: orgId
          }
        },
        // Metadata
        { priority: 'normal', attempts: 1, removeOnComplete: false },
        // Complete callback
        null
      )
    );
  }
  const promisesStatus = await Promise.allSettled(applyPromises);
  const { fulfilled, reasons } = promisesStatus.reduce(({ fulfilled, reasons }, elem) => {
    if (elem.status === 'fulfilled') {
      const job = elem.value;
      logger.info('Set notifications for device job queued', {
        params: {
          jobId: job.id,
          machineId: job.type
        }
      });
      fulfilled.push(job.id);
    } else {
      if (!reasons.includes(elem.reason.message)) {
        reasons.push(elem.reason.message);
      }
    };
    return { fulfilled, reasons };
  }, { fulfilled: [], reasons: errors });
  const status = fulfilled.length < opDevices.length
    ? 'partially completed' : 'completed';
  const message = fulfilled.length < opDevices.length
    ? `Warning: ${fulfilled.length} of ${opDevices.length} Set device's notifications job added.` +
        ` Some devices have following errors: ${reasons.join('. ')}`
    : `Set device's notifications${opDevices.length > 1 ? 's' : ''} added successfully`;
  return { ids: fulfilled, status, message };
};

const sync = async (deviceId) => {
  const device = await devices.findOne(
    { _id: deviceId }
  );
  let callComplete = false;
  const completeCbData = [];
  const request = [];
  if (device) {
    const orgId = device.org;
    const getDeviceNotificationsConf = await notificationsConf.findOne({ org: orgId.toString() });
    const deviceNotificationsConf = getDeviceNotificationsConf.rules;
    const filteredRules = Object.keys(deviceNotificationsConf)
      .filter(event => deviceNotificationTypes.includes(event))
      .reduce((obj, key) => {
        obj[key] = deviceNotificationsConf[key];
        return obj;
      }, {});
    request.push({ entity: 'agent', message: 'add-notifications-config', params: { org: orgId, rules: filteredRules } });
    completeCbData.push({ orgId, deviceId, op: 'notifications' });
    callComplete = true;
  }
  return {
    requests: request,
    completeCbData,
    callComplete
  };
};

module.exports = {
  apply: apply,
  sync: sync
};
