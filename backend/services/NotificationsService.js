/* eslint-disable no-unused-vars */
const Service = require('./Service');

const notificationsDb = require('../models/notifications');
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

class NotificationsService {

  /**
   * Get all Notifications
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async notificationsGET({ offset, limit }, { user }) {
    try {
      const query = { org: user.defaultOrg._id };

      // If operation is 'count', return the amount
      // of notifications for each device
      const notifications = await notificationsDb.find(query, 'time device title details status machineId')
        .populate('device', 'name -_id', devices);

      return Service.successResponse(notifications);
    } catch (e) {
      logger.warn('Failed to retrieve notifications', {
        params: {
          org: user.defaultOrg._id.toString(),
          err: err.message
        },
        req: req
      });
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

}

module.exports = NotificationsService;
