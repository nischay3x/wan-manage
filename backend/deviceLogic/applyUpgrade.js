// flexiWAN SD-WAN software - flexiEdge, flexiManage. For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

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
const deviceQueues = require('../utils/deviceQueue')(configs.get('kuePrefix'),configs.get('redisUrl'));
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({module: module.filename, type: 'req'});

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
        entity: "agent",
        message: "upgrade-device-sw",
        params: { version: targetVersion }
    }];
    const jobs = [];
    devices.forEach(dev => {
        deviceStatus.setDeviceStatsField(dev.machineId, 'state', 'pending');
        jobs.push(
            deviceQueues.addJob(dev.machineId, user, org,
                // Data
                {'title': `Upgrade device ${dev.hostname}`, 'tasks': tasks},
                // Response data
                {method: 'upgrade', data: {'device': dev._id, 'org': org}},
                // Metadata
                {priority: 'high', attempts: 1, removeOnComplete: false},
                // Complete callback
                null)
        );
    });
    return new Promise(async(resolve, reject) => {
        try {
            const jobResults = await Promise.all(jobs);
            resolve(jobResults);
        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Applies the upgrade request on all requested devices
 * @async
 * @param  {Array}    deviceList an array of devices to upgrade
 * @param  {Object}   req        express request object
 * @param  {Object}   res        express response object
 * @param  {Callback} next       express next() callback
 * @return {void}
 */
const apply = async(deviceList, req, res, next) => {
    // If the apply method was called for multiple devices, extract
    // only the devices that appear in the body. If it was called for
    // a single device, simply used the first device in the devices array.
    let op_devices;
    if(req.body.devices) {
        selected_devices = req.body.devices;
        op_devices = (deviceList && selected_devices) ?
            deviceList.filter((device) => {
                const in_selected = selected_devices.hasOwnProperty(device._id);
                return in_selected ? true : false;
            }) : [];
    } else {
        op_devices = deviceList;
    }

    try {
        // Filter out devices that already have
        // a pending upgrade job in the queue.
        op_devices = await devices.find({
            $and: [
                { _id: { $in: op_devices } },
                { "upgradeSchedule.jobQueued": { $ne: true } }
            ]},
            '_id machineId hostname'
        );

        const swUpdater = await DevSwUpdater.createSwVerUpdater();
        const version = swUpdater.getLatestDevSwVersion();
        const user = req.user.username;
        const org = req.user.defaultOrg._id.toString();
        const jobResults = await queueUpgradeJobs(op_devices, user, org, version);
        jobResults.forEach(job => {
            logger.info("Upgrade device job queued", {
                params: { jobId: job.id, version: version },
                job: job,
                req: req
            });
        });

        // Set the upgrade job pending flag for all devices.
        // This prevents queuing additional upgrade tasks as long
        // as there's a pending upgrade task in a device's queue.
        const deviceIDs = op_devices.map(dev => { return dev._id; });
        await setQueuedUpgradeFlag(deviceIDs, org, true);

        return res.status(200).send({});
    } catch (err) {
        return next(err);
    }
};
/**
 * Sets the value of the pending upgrade flag in the database.
 * The pending upgrade flag indicates if a pending upgrade job
 * already exists in the device's queue.
 * @param  {string}  deviceID the id of the device
 * @param  {string}  org      the id of the organization the device belongs to
 * @param  {boolean} flag     the value to be set in the database
 * @return {Promise}
 */
const setQueuedUpgradeFlag = (deviceID, org, flag) => {
    return new Promise(async(resolve, reject) => {
        try {
            await devices.update(
                { _id: { $in: deviceID }, org: org },
                { $set: { "upgradeSchedule.jobQueued": flag } },
                { upsert: false }
            );
        } catch (err) {
            return reject(err);
        }
        return resolve();
    });
};

/**
 * Called when upgrade device job completes to unset
 * the pending upgrade job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {string} res   device object ID and username
 * @return {void}
 */
const complete = async(jobId, res) => {
    logger.info("Device Upgrade complete", {params: {result: res, jobId: jobId}});
    try {
        await setQueuedUpgradeFlag([res.device], res.org, false);
    } catch (err) {
        logger.warn("Failed to update jobQueued field in database", {params: {result: res, jobId: jobId}});
    }
};

/**
 * Called if upgrade device job fails to unset
 * the pending upgrade job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const error = async(jobId, res) => {
    logger.warn("Device Upgrade failed", {params: {result: res, jobId: jobId}});
    try {
        await setQueuedUpgradeFlag([res.device], res.org, false);
    } catch (err) {
        logger.warn("Failed to update jobQueued field in database", {params: {result: res, jobId: jobId}});
    }
};

/**
 * Called if upgrade device job was removed to unset
 * the pending upgrade job flag in the database.
 * @async
 * @param  {number} jobId Kue job ID
 * @param  {Object} res
 * @return {void}
 */
const remove = async(job) => {
    if(['inactive', 'delayed', 'active'].includes(job._state)) {
        logger.info('Device Upgrade job removed', {params: {job: job}});
        try {
            const { org, device } = job.data.response.data;
            await setQueuedUpgradeFlag([device], org, false);
        } catch (err) {
            logger.error("Failed to update jobQueued field in database", {
                params: { job: job, err: err.message }
            });
        }
    }
};

module.exports = {
    apply: apply,
    complete: complete,
    queueUpgradeJobs: queueUpgradeJobs,
    error: error,
    remove: remove
};
