// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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
const Service = require('./Service');
const configs = require('../configs')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const pick = require('lodash/pick');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

class JobsService {
  /**
   * Select the API fields from jobs Object
   * @param {Object} item - jobs object
   */
  static selectJobsParams (item) {
    item._id = item.id;
    const madeAttempts = item._attempts ? item._attempts : 0;
    item.attempts = {
      max: item._max_attempts,
      made: madeAttempts,
      remaining: item._max_attempts - madeAttempts
    };
    item.priority = item._priority;
    item.progress = item._progress;
    item.state = item._state;
    const retJob = pick(item, [
      '_id', // type: integer
      'type', // type: string
      'data', // type: object
      'result', // type: object
      'created_at', // type: string
      'attempts', // type: integer
      'state', // type: string
      'priority', // type: integer
      'progress' // type: string
    ]);

    if (!item?._error) {
      return retJob;
    }

    const buildDefaultErrorMessage = (retJob, itemError) => {
      return {
        errors: [{
          command: {
            func: retJob.data.message.title
          },
          error: itemError
        }]
      };
    };

    // old timeout errors appear as 'Error: Send Timeout' string, so this check is
    // to cover for backward compatibility.
    if (item._error === 'Error: Send Timeout') {
      retJob.error = buildDefaultErrorMessage(retJob, item._error);
      return retJob;
    }

    try {
      retJob.error = JSON.parse(item._error);
    } catch (e) {
      retJob.error = buildDefaultErrorMessage(retJob, item._error);
    }

    return retJob;
  }

  /**
   * Get all Jobs
   *
   * @param {Integer} offset The number of items to skip before collecting the result (optional)
   * @param {Integer} limit The numbers of items to return (optional)
   * @param {String} sortField The field by which the data will be ordered (optional)
   * @param {String} sortOrder Sorting order [asc|desc] (optional)
   * @param {String} status Filter on the job status (optional)
   * @param {String} ids Filter on job ids (comma separated) (optional)
   * returns List
   **/
  static async jobsGET (requestParams, { user }) {
    const { org, offset, limit, status, ids, filters } = requestParams;
    try {
      const stateOpts = ['complete', 'failed', 'inactive', 'delayed', 'active'];
      // Check state provided is allowed
      if (!stateOpts.includes(status) && status !== 'all') {
        return Service.rejectResponse('Unsupported query state', 400);
      }
      if (status !== 'all' && ids !== undefined) {
        return Service.rejectResponse('When using Job IDs, status must be "all"', 400);
      }

      // Generate and send the result
      const orgList = await getAccessTokenOrgList(user, org, true);
      const result = [];

      if (ids !== undefined) {
        // Convert Ids to strings
        const intIds = ids.split(',').map(id => +id);
        await deviceQueues.iterateJobsIdsByOrg(orgList[0].toString(),
          intIds, (job) => {
            const parsedJob = JobsService.selectJobsParams(job);
            result.push(parsedJob);
          }
        );
        return Service.successResponse(result);
      }
      const parsedFilters = filters ? JSON.parse(filters) : [];
      await deviceQueues.iterateJobsByOrg(orgList[0].toString(),
        status, (job) => {
          const parsedJob = JobsService.selectJobsParams(job);
          result.push(parsedJob);
          return true; // Mark job as done
        }, 0, -1, 'desc', offset, limit, parsedFilters
      );
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete all jobs matching the filters
   *
   * no response value expected for this operation
   **/
  static async jobsDELETE ({ org, jobsDeleteRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const { ids, filters } = jobsDeleteRequest;
      if (ids && filters) {
        throw createError(400, 'Only ids or filters can be specified as a parameter');
      }
      if (ids) {
        await deviceQueues.removeJobIdsByOrg(orgList[0].toString(), ids);
      } else {
        await deviceQueues.removeJobsByOrgAndFilters(orgList[0].toString(), filters);
      }
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete a job
   *
   * id Integer Numeric ID of the Job to delete
   * no response value expected for this operation
   **/
  static async jobsIdDELETE ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      logger.info('Deleting jobs', {
        params: {
          org: orgList[0].toString(),
          jobs: [id]
        }
      });

      await deviceQueues.removeJobIdsByOrg(orgList[0].toString(), [id]);
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Get Job by ID
   *
   * id Integer Numeric ID of the Job to get
   * org String Organization to be filtered by (optional)
   * returns Job
   **/
  static async jobsIdGET ({ id, org }, { user }) {
    try {
      // Generate and send the result
      const orgList = await getAccessTokenOrgList(user, org, true);
      let result = {};
      await deviceQueues.iterateJobsIdsByOrg(orgList[0].toString(),
        [id], (job) => {
          const parsedJob = JobsService.selectJobsParams(job);
          result = parsedJob;
        }
      );
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Service Error',
        e.status || 500
      );
    }
  }
}

module.exports = JobsService;
