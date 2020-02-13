/* eslint-disable no-unused-vars */
const Service = require('./Service');
const configs = require('../configs')();
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

class BillingService {

  /**
   * Get all Invoices
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async invoicesGET({ offset, limit }, { user }) {
    try {
      return Service.successResponse([]);
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
  static async couponsPOST({ couponsRequest }, { user }) {
    try {
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }
}

module.exports = BillingService;
