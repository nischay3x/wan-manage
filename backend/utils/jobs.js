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
  'add-ospf', 'add-routing-filter', 'add-routing-bgp', 'modify-routing-bgp',
  'add-switch', 'add-interface', 'modify-interface', 'add-tunnel',
  'add-route', 'add-dhcp-config', 'add-application', 'add-multilink-policy', 'add-firewall-policy'
];

const removeOrder = addOrder.map(a => a.replace('add-', 'remove-')).reverse();

/**
 * Get available ips from a mask
 * @param  {number} mask  subnet mask
 * @return {number}       number of available ips
 */
const orderTasks = tasks => {
  let result = [];

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
        result.push(task);
      }
    }
  }

  result = uniqWith(result, isEqual);

  return result;
};

module.exports = {
  orderTasks
};
