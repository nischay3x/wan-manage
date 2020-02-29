// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const Service = require('./Service');
const configs = require('../configs')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

class JobsService {
  /**
   * Get all Jobs
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * status String A filter on the job status (optional)
   * returns List
   **/
  static async jobsGET ({ offset, limit, status }, { user }) {
    try {
      const stateOpts = ['complete', 'failed', 'inactive', 'delayed', 'active'];
      // Check state provided is allowed
      if (!stateOpts.includes(status) && status !== 'all') {
        return Service.rejectResponse(400, 'Unsupported query state');
      }

      // Generate and send the result
      const result = [];
      if (status === 'all') {
        await Promise.all(
          stateOpts.map(async (s) => {
            await deviceQueues.iterateJobsByOrg(user.defaultOrg._id.toString(), s, (job) => {
              result.push(job);
            });
          })
        );
      } else {
        await deviceQueues.iterateJobsByOrg(user.defaultOrg._id.toString(),
          status, (job) => result.push(job));
      }

      return Service.successResponse(result);
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
  static async jobsIdDELETE ({ id }, req) {
    try {
      logger.info('Deleting jobs', {
        params: {
          org: req.user.defaultOrg._id.toString(),
          jobs: [id]
        },
        req: req
      });

      await deviceQueues.removeJobIdsByOrg(req.user.defaultOrg._id.toString(), [id]);
      return Service.successResponse();
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = JobsService;
