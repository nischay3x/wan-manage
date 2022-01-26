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

const configs = require('../configs.js')();
const flexibilling = require('../flexibilling');

class ConfigurationService {
  /**
   * Get configuration
   *
   * returns List
   **/
  static async configurationGET ({ org }, { user }) {
    try {
      const restServerUrl = configs.get('restServerUrl', 'list');

      const accountId = user.defaultAccount._id.toString();
      const vpnMaxConnectionsNumber = await flexibilling.getFeatureData(
        accountId, 'max_vpn_connections');

      const res = {
        restServerUrl,
        vpnMaxConnectionsNumber
      };

      return Service.successResponse(res);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ConfigurationService;
