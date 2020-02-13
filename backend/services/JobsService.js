/* eslint-disable no-unused-vars */
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
  static async jobsGET({ offset, limit, status }, { user }) {
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
        await deviceQueues.iterateJobsByOrg(user.defaultOrg._id.toString(), status, (job) => result.push(job));
      }

      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Delete a job
   *
   * id Integer Numeric ID of the Job to delete
   * no response value expected for this operation
   **/
  static async jobsIdDELETE({ id }, { user }) {
    try {
      logger.info('Deleting jobs', {
        params: {
          org: user.defaultOrg._id.toString(),
          jobs: [ id ]
        },
        req: req
      });

      await deviceQueues.removeJobIdsByOrg(user.defaultOrg._id.toString(), [id]);
      return Service.successResponse(204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

}

module.exports = JobsService;
