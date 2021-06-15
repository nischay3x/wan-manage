// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2020  flexiWAN Ltd.

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

/**
   * Get the current server address.
      First try to get from the request, if it does not exist we use env
   * @param {Object} request - Requests to http request
   * @param {string} server - Server address
*/
const getCurrentServer = request => {
  let server = request.protocol + '://' + request.get('host');
  const servers = configs.get('restServerUrl', 'list');
  if (!servers.find(ser => ser === server)) {
    server = servers[0];
  }

  return server;
};

// Default exports
module.exports = {
  getCurrentServer
};
