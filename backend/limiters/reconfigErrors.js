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
const configs = require('../configs')();
const notificationsMgr = require('../notifications/notifications')();
const logger = require('../logging/logging')({ module: module.filename, type: 'websocket' });

const reconfigBlockTime = configs.get('reconfigErrorBlockTime', 'number');

const onReconfigBlocked = async (deviceId, machineId, org) => {
  logger.error('Reconfig rate limit exceeded', { params: { deviceId } });

  await notificationsMgr.sendNotifications([{
    org: org,
    title: 'Unsuccessful self-healing operations',
    time: new Date(),
    device: deviceId,
    machineId: machineId,
    details: 'Unsuccessful updating device data. Please contact flexiWAN support'
  }]);
};

// 5 times in a minute
const reconfigErrorSLimiter = new Limiter(5, 60, reconfigBlockTime, undefined, onReconfigBlocked);

module.exports = {
  reconfigErrorSLimiter
};
