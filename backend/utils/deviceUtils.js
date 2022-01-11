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

const { devices } = require('../models/devices');

/**
 * Get all LAN subnets in the same organization
 * @param  {string} orgId         the id of the organization
 * @return {[_id: objectId, name: string, subnet: string]} array of LAN subnets with router name
 */
const getAllOrganizationLanSubnets = async orgId => {
  const subnets = await devices.aggregate([
    { $match: { org: orgId } },
    {
      $project: {
        'interfaces.IPv4': 1,
        'interfaces.IPv4Mask': 1,
        'interfaces.type': 1,
        'interfaces.isAssigned': 1,
        name: 1,
        _id: 1
      }
    },
    { $unwind: '$interfaces' },
    {
      $match: {
        'interfaces.type': 'LAN',
        'interfaces.isAssigned': true,
        'interfaces.IPv4': { $ne: '' },
        'interfaces.IPv4Mask': { $ne: '' }
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        subnet: {
          $concat: ['$interfaces.IPv4', '/', '$interfaces.IPv4Mask']
        }
      }
    }
  ]);

  return subnets;
};

/**
 * Get the default gateway of the device
 * @param {Object}  device
 * @return {string} defaultRouter
 */
const getDefaultGateway = device => {
  const defaultIfc = device.interfaces.reduce((d, i) => {
    return i.type !== 'WAN' || i.routing !== 'NONE' || !i.gateway ||
      (d && Number(d.metric) < Number(i.metric)) ? d : i;
  }, false);
  return !defaultIfc ? device.defaultRoute : defaultIfc.gateway;
};

const mapWifiNames = agentData => {
  const map = {
    ap_status: 'accessPointStatus'
  };
  return renameKeys(agentData, map);
};

/**
 * Map the LTE keys that come from the agent into one convention.
 * The keys from the agent are a bit messy, some with uppercase and some with lowercase, etc.
 * So this function is mapping between agent to an object with names in one convention.
 * @param {Object}  agentData LTE data from agent
 * @return {Object} Mapped object
 */
const mapLteNames = agentData => {
  const map = {
    sim_status: 'simStatus',
    hardware_info: 'hardwareInfo',
    packet_service_state: 'packetServiceState',
    phone_number: 'phoneNumber',
    system_info: 'systemInfo',
    default_settings: 'defaultSettings',
    pin_state: 'pinState',
    connection_state: 'connectionState',
    registration_network: 'registrationNetworkState',
    APN: 'apn',
    downlink_speed: 'downlinkSpeed',
    uplink_speed: 'uplinkSpeed',
    pin1_retries: 'pin1Retries',
    pin1_status: 'pin1Status',
    puk1_retries: 'puk1Retries',
    network_error: 'networkError',
    register_state: 'registrationState',
    cell_id: 'cellId',
    operator_name: 'operatorName'
  };

  return renameKeys(agentData, map);
};

const renameKeys = (obj, map) => {
  Object.keys(obj).forEach(key => {
    const newKey = map[key];
    let value = obj[key];

    if (value && typeof value === 'object') {
      value = renameKeys(value, map);
    }

    if (newKey) {
      obj[newKey] = value;
      delete obj[key];
    } else {
      obj[key] = value;
    }
  });
  return obj;
};

/**
 * Calculation bridges by interfaces list
 * @param {array}  interfaces LTE data from agent
 * @return {object} dictionary contains the bridge IP as key with array of devIds
 */
const getBridges = interfaces => {
  const bridges = {};

  for (const ifc of interfaces) {
    const devId = ifc.devId;

    if (!ifc.isAssigned) {
      continue;
    }

    if (ifc.type !== 'LAN') {
      continue;
    }

    if (ifc.IPv4 === '' || ifc.IPv4Mask === '') {
      continue;
    }
    const addr = ifc.IPv4 + '/' + ifc.IPv4Mask;

    const needsToBridge = interfaces.some(i => {
      return devId !== i.devId && addr === i.IPv4 + '/' + i.IPv4Mask;
    });

    if (!needsToBridge) {
      continue;
    }

    if (!bridges.hasOwnProperty(addr)) {
      bridges[addr] = [];
    }

    bridges[addr].push(ifc.devId);
  };

  return bridges;
};

// Default exports
module.exports = {
  getAllOrganizationLanSubnets,
  getDefaultGateway,
  getBridges,
  mapLteNames,
  mapWifiNames
};
