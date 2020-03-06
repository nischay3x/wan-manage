// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
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

const periodic = require('./periodic')();
const tunnels = require('../deviceLogic/tunnels');

/***
 * This class periodically checks connected tunnels
 * If tunnel is active but not connected, reconnect it
 *
 ***/
class CheckTunnels {
  /**
     * Creates an instance of the CheckTunnels class.
     */
  constructor () {
    this.start = this.start.bind(this);
    this.periodicCheckTunnels = this.periodicCheckTunnels.bind(this);
  }

  /**
     * Starts the check-tunnels task
     * @return {void}
     */
  start () {
    periodic.registerTask('check_tunnels', this.periodicCheckTunnels, 30000);
    periodic.startTask('check_tunnels');
  }

  /**
     * Calls checkAndReconnectTunnels() to
     * periodically check all tunnels.
     * @return {void}
     */
  periodicCheckTunnels () {
    tunnels.tasks.checkAndReconnectTunnels();
  }
}

var checkTunnels = null;
module.exports = function () {
  if (checkTunnels) return checkTunnels;
  else {
    checkTunnels = new CheckTunnels();
    return checkTunnels;
  }
};
