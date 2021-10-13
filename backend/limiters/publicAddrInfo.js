
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

const Limiter = require('./limiter');
const logger = require('../logging/logging')({ module: module.filename, type: 'websocket' });
const configs = require('../configs')();

const publicAddrBlockTime = configs.get('publicAddrBlockTime', 'number');

const blockCallback = async (instance, origDevice, origIfc) => {
  logger.error('Public address rate limit exceeded. tunnels will set as pending',
    { params: { deviceId: origDevice._id, interfaceId: origIfc._id } }
  );

  const reason = `The public address of interface ${origIfc.name} in device ${origDevice.name}
  is changing at a high rate.
  Click on the "Sync" button to re-enable self-healing`;
  await instance.setPendingStateToTunnels(origDevice, origIfc, reason);
};

const releaseCallback = async (instance, origDevice, origIfc) => {
  await instance.removePendingStateFromTunnels(origDevice, origIfc);
};

const publicAddrInfoLimiter = new Limiter(
  5, 60 * 60, publicAddrBlockTime, releaseCallback, blockCallback);

module.exports = {
  publicAddrInfoLimiter
};
