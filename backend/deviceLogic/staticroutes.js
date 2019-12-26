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
const { devices, staticroutes } = require('../models/devices');
const deviceQueues = require('../utils/deviceQueue')(configs.get('kuePrefix'), configs.get('redisUrl'));
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getMajorVersion } = require('../versioning');

/**
 * Queues an add-route or delete-route job to a device.
 * @async
 * @param  {Array}    device an array of the devices to be modified
 * @param  {Object}   req    express request object
 * @param  {Object}   res    express response object
 * @param  {Callback} next   express next() callback
 * @return {void}
 */
const apply = async (device, req, res, next) => {
    const user = req.user.username;
    const org = req.user.defaultOrg._id.toString();
    const machineId = device.machineId;
    const majorAgentVersion = getMajorVersion(device.versions.agent);

    if (majorAgentVersion === 0) {    // version 0.X.X
        return next(createError(400, "Command is not supported for the current agent version"));
    } else if (majorAgentVersion >= 1) {    // version 1.X.X+
        const tasks = [];
        const routeId = req.body.id;

        let message = 'add-route';
        let titlePrefix = 'Add';
        let params = { addr: req.body.destination_network, via: req.body.gateway_ip };

        if (req.body.ifname) {
            params.pci = req.body.ifname;
        }

        if (req.body.action === 'del') {
            titlePrefix = 'Delete';
            message = 'remove-route';
        }

        tasks.push({ "entity": "agent", message, params });

        try {
            const job = await deviceQueues.addJob(machineId, user, org,
                // Data
                { 'title': `${titlePrefix} Static Route in device ${device.hostname}`, 'tasks': tasks },
                // Response data
                { method: 'staticroutes', data: { deviceId: device.id, 'routeId': routeId, message } },
                // Metadata
                { priority: 'low', attempts: 1, removeOnComplete: false },
                // Complete callback
                null);

                logger.info("Add static route job queued", { job: job, req: req });
            } catch (error) {
                // handle an error here
                next(error);
            }
    }
};

/**
 * Called when add/remove route job completed and
 * updates the status of the operation.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const complete = async (jobId, res) => {
    logger.info("Add static route job complete", { params: { result: res, jobId: jobId } });

    if (!res || !res.deviceId || !res.message || !res.routeId) {
        logger.warn('Got an invalid job result', { params: { result: res, jobId: jobId } });
        return;
    }
    try {
        if (res.message === "remove-route") {
            await devices.findOneAndUpdate(
                { _id: mongoose.Types.ObjectId(res.deviceId) },
                    {
                    $pull: {
                        'staticroutes': {
                        _id: mongoose.Types.ObjectId(res.routeId)
                        }
                    }
                }
            );
        } else {
            await devices.findOneAndUpdate(
                { _id: mongoose.Types.ObjectId(res.deviceId) },
                { $set: { "staticroutes.$[elem].status": "complete" } },
                {
                    arrayFilters: [{ "elem._id": mongoose.Types.ObjectId(res.routeId) }]
                }
            );
        }
    } catch (error) {
        logger.warn('Failed to update database', { params: { result: res, jobId: jobId } });
    }
};

/**
* Called if add/remove route job failed and
 * updates the status of the operation.
 * @async
 * @param  {number} jobId Kue job ID number
 * @param  {Object} res   device object ID and organization
 * @return {void}
 */
const error = async (jobId, res) => {
    logger.info("Static route job failed", { params: { result: res, jobId: jobId } });

    try {
        if (res.message === "remove-route") {
            await devices.findOneAndUpdate(
                { _id: mongoose.Types.ObjectId(res.deviceId) },
                { $set: { "staticroutes.$[elem].status": "remove-failed" } },
                {
                    arrayFilters: [{ "elem._id": mongoose.Types.ObjectId(res.routeId) }]
                }
            );
        } else {
            await devices.findOneAndUpdate(
                { _id: mongoose.Types.ObjectId(res.deviceId) },
                { $set: { "staticroutes.$[elem].status": "add-failed" } },
                {
                    arrayFilters: [{ "elem._id": mongoose.Types.ObjectId(res.routeId) }]
                }
            );
        }
    } catch (error) {
        logger.warn('Failed to update database', { params: { result: res, jobId: jobId } });
    }
};

/**
 * Called when add-route/remove-route job is removed only
 * for tasks that were deleted before completion/failure.
 * @async
 * @param  {Object} job Kue job
 * @return {void}
 */
const remove = async (job) => {
  if (['inactive', 'delayed', 'active'].includes(job._state)) {
        logger.info('Rolling back device changes for removed task', { params: { job: job } });
        const deviceId = job.data.response.data.deviceId;
        const routeId = job.data.response.data.routeId;

        try {
            await devices.findOneAndUpdate(
                { _id: mongoose.Types.ObjectId(deviceId) },
                { $set: { "staticroutes.$[elem].status": "job-deleted" } },
                {
                    arrayFilters: [{ "elem._id": mongoose.Types.ObjectId(routeId) }]
                }
            );
        } catch (error) {
            logger.warn('Failed to update database', { params: { result: res, jobId: jobId } });
        }
    }
};

module.exports = {
  apply: apply,
  complete: complete,
  error: error,
  remove: remove
};
