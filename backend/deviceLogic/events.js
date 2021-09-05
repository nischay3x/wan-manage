
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

// File used to dispatch the apply logic to the right function
const start = require('./start');
const stop = require('./stop');
const reset = require('./reset');
const modify = require('./modifyDevice');
const tunnels = require('./tunnels');
const staticroutes = require('./staticroutes');
const upgrade = require('./applyUpgrade');
const mlpolicy = require('./mlpolicy');
const firewallPolicy = require('./firewallPolicy');
const dhcp = require('./dhcp');
const appIdentification = require('./appIdentification');
const sync = require('./sync');
const IKEv2 = require('./IKEv2');
const configs = require('../configs')();
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);

const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

const EVENTS = {
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  INTERFACE_CONNECTIVITY_LOST: 'INTERFACE_CONNECTIVITY_LOST',
  INTERFACE_CONNECTIVITY_RESTORED: 'INTERFACE_CONNECTIVITY_RESTORED',
  INTERFACE_IP_LOST: 'INTERFACE_IP_LOST',
  INTERFACE_IP_RESTORED: 'INTERFACE_IP_RESTORED',
  TUNNEL_IS_PENDING: 'TUNNEL_IS_PENDING'
};

const HANDLERS = {
  INTERFACE_IP_LOST: async (deviceId, interfaceId) => {
    // 1. get device tunnels that interfaceId is the interface
    // 2. for each tunnel, set to pending trigger the TUNNEL_PENDING handler
    // 3. get static routes connected to this tunnel
    // 4. for each route, trigger the 
  },
  INTERFACE_IP_RESTORED: async (deviceId, interfaceId) => {

  },
  INTERFACE_CONNECTIVITY_LOST: async () => {},
  INTERFACE_CONNECTIVITY_RESTORED: async () => {},
  TUNNEL_IS_PENDING: async tunnelId => {
    // 1. get device tunnels that interfaceId is the interface
    // 2. for each tunnel, trigger the TUNNEL_PENDING handler
  }
};

const trigger = async (eventType, ...args) => {
  if (!EVENTS[eventType]) {
    throw new Error('Event not found');
  }

  const res = await HANDLERS[eventType](...args);
  return res;
};

const check = async (origInterfaces, newInterfaces) => {
  

};

module.exports = {
  check
};
