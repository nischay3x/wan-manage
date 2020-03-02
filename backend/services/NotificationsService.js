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

const notificationsDb = require('../models/notifications');
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

class NotificationsService {
  /**
   * Get all Notifications
   *
   * offset Integer The number of items to skip before starting to collect the result set
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async notificationsGET ({ org, offset, limit }, { user }) {
    try {
      const query = { org: user.defaultOrg._id };

      // If operation is 'count', return the amount
      // of notifications for each device
      const notifications = await notificationsDb
        .find(query, 'time device title details status machineId')
        .populate('device', 'name -_id', devices);

      return Service.successResponse(notifications);
    } catch (e) {
      logger.warn('Failed to retrieve notifications', {
        params: {
          org: user.defaultOrg._id.toString(),
          err: e.message
        }
      });
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = NotificationsService;
