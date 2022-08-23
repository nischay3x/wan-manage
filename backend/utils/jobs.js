// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2022  flexiWAN Ltd.

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
const uniqWith = require('lodash/uniqWith');
const isEqual = require('lodash/isEqual');

const addOrder = [
  'add-ospf', 'add-routing-filter', 'add-routing-bgp',
  'add-switch', 'add-interface', 'add-tunnel',
  'add-route', 'add-dhcp-config', 'add-application', 'add-multilink-policy', 'add-firewall-policy',
  'add-qos-traffic-map', 'add-qos-policy'
];

const removeOrder = addOrder.map(a => a.replace('add-', 'remove-')).reverse();

const getTaskKey = job => {
  const { message, params } = job;
  let key = null;
  switch (message) {
    case 'add-ospf':
    case 'add-application':
    case 'add-multilink-policy':
    case 'add-firewall-policy':
    case 'add-qos-policy':
    case 'add-qos-traffic-map':
      key = message;
      break;

    case 'add-routing-bgp':
    case 'modify-routing-bgp':
      key = 'add-routing-bgp';
      break;

    case 'add-interface':
    case 'modify-interface': // convert modify-interface to add-interface for key
      key = 'add-interface' + ';' + params.devId;
      break;

    case 'add-routing-filter':
      key = message + ';' + params.name;
      break;

    case 'add-switch':
      key = message + ';' + params.addr;
      break;

    case 'add-tunnel':
      key = message + ';' + params['tunnel-id'];
      break;

    case 'add-route':
      key = message + ';' + params.addr + ';' + params.via;
      // let keyParams = [params.addr, params.via];
      if (params.dev_id) {
        key += ';' + params.dev_id;
      }

      if (params.metric) {
        key += ';' + params.metric;
      }
      break;

    case 'add-dhcp-config':
      key = message + ';' + params.interface;
      break;

    default:
      key = message;
      break;
  }

  return key;
};

/**
 * Get available ips from a mask
 * @param  {number} mask  subnet mask
 * @return {number}       number of available ips
 */
const orderTasks = tasks => {
  let result = [];

  const messagesAddKeys = {};

  for (const msg of removeOrder) {
    for (const task of tasks) {
      if (msg === task.message) {
        result.push(task);
      }
    }
  }

  for (const msg of addOrder) {
    for (const task of tasks) {
      if (msg === task.message) {
        messagesAddKeys[getTaskKey(task)] = task;
        result.push(task);
      }
    }
  }

  // append modify-x after all remove-x and add-x
  for (const task of tasks) {
    if (task.message.startsWith('modify-')) {
      // check if there is add-x in the list for this modify-x
      // if so, ignore modify and keep only the add which is with the updated params.
      const modifyKey = getTaskKey(task);
      if (modifyKey in messagesAddKeys) {
        continue;
      }

      result.push(task);
    }
  }

  result = uniqWith(result, isEqual);

  return result;
};

module.exports = {
  orderTasks
};
