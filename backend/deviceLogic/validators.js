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

const net = require('net');
const cidr = require('cidr-tools');
const { devices } = require('../models/devices');

/**
 * Checks whether a value is empty
 * @param  {string}  val the value to be checked
 * @return {boolean}     true if the value is empty, false otherwise
 */
const isEmpty = (val) => { return val === null || val === undefined || val === ''; };

/**
 * Checks whether a value is a valid IPv4 network mask
 * @param  {string}  mask the mask to be checked
 * @return {boolean}      true if mask is valid, false otherwise
 */
const validateIPv4Mask = mask => {
  return (
    !isEmpty(mask) &&
        mask.length < 3 &&
        !isNaN(Number(mask)) &&
        (mask >= 0 && mask <= 32)
  );
};

/**
 * Checks whether the device configuration is valid,
 * therefore the device can be started.
 * @param  {Object}  device                 the device to check
 * @return {{valid: boolean, err: string}}  test result + error, if device is invalid
 */
const validateDevice = async (device) => {
  // Get all assigned interface. There should be at least
  // two such interfaces - one LAN and the other WAN
  const interfaces = device.interfaces;
  const assignedIfs = interfaces.filter(ifc => { return ifc.isAssigned; });
  const [wanIfcs, lanIfcs] = [
    assignedIfs.filter(ifc => { return ifc.type === 'WAN'; }),
    assignedIfs.filter(ifc => { return ifc.type === 'LAN'; })
  ];

  if (assignedIfs.length < 2 || (wanIfcs.length === 0 || lanIfcs.length === 0)) {
    return {
      valid: false,
      err: 'There should be at least one LAN and one WAN interfaces'
    };
  }

  for (const ifc of assignedIfs) {
    // Assigned interfaces must be either WAN or LAN
    if (!['WAN', 'LAN'].includes(ifc.type)) {
      return {
        valid: false,
        err: `Invalid interface type for ${ifc.name}: ${ifc.type}`
      };
    }

    if (!net.isIPv4(ifc.IPv4) || ifc.IPv4Mask === '') {
      return {
        valid: false,
        err: `Interface ${ifc.name} does not have an ${ifc.IPv4Mask === ''
                      ? 'IPv4 mask' : 'IP address'}`
      };
    }

    // OSPF is not allowed on WAN interfaces
    if (ifc.type === 'WAN' && ifc.routing === 'OSPF') {
      return {
        valid: false,
        err: 'OSPF should not be configured on WAN interface'
      };
    }
  }

  // LAN and WAN interfaces must not be on the same subnet
  // WAN IP address and default GW IP addresses must be on the same subnet
  for (const wanIfc of wanIfcs) {
    for (const lanIfc of lanIfcs) {
      const wanSubnet = `${wanIfc.IPv4}/${wanIfc.IPv4Mask}`;
      const lanSubnet = `${lanIfc.IPv4}/${lanIfc.IPv4Mask}`;
      // const defaultGwSubnet = `${device.defaultRoute}/32`;

      if (cidr.overlap(wanSubnet, lanSubnet)) {
        return {
          valid: false,
          err: 'WAN and LAN IP addresses have an overlap'
        };
      }
    }
  }

  if (device.org) {
    // LAN subnet must not be overlap with other devices in this org
    const otherDevices = await devices.find({ org: device.org, _id: { $ne: device._id } }).exec();

    for (const otherDevice of otherDevices) {
      const otherLanIfcs = otherDevice.interfaces
        .filter(ifc => ifc.type === 'LAN' && ifc.isAssigned === true);

      for (const otherLanIfc of otherLanIfcs) {
        const otherDeviceLanSubnet = `${otherLanIfc.IPv4}/${otherLanIfc.IPv4Mask}`;

        // compare each LAN subnet with current device LAN subnet
        for (const currentLanIfc of lanIfcs) {
          const deviceLanSubnet = `${currentLanIfc.IPv4}/${currentLanIfc.IPv4Mask}`;

          if (cidr.overlap(deviceLanSubnet, otherDeviceLanSubnet)) {
            return {
              valid: false,
              err: `The device ${device.name} has a LAN subnet overlap with ${otherDevice.name}`
            };
          }
        }
      }
    }
  }

  /*
    if (!cidr.overlap(wanSubnet, defaultGwSubnet)) {
        return {
            valid: false,
            err: 'WAN and default route IP addresses are not on the same subnet'
        };
    }
    */
  return { valid: true, err: '' };
};

/**
 * Checks whether a modify-device message body
 * contains valid configurations.
 * @param  {Object} modifyDeviceMsg         modify-device message body
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateModifyDeviceMsg = (modifyDeviceMsg) => {
  // Support both arrays and single interface
  const msg = Array.isArray(modifyDeviceMsg) ? modifyDeviceMsg : [modifyDeviceMsg];
  for (const ifc of msg) {
    const [ip, mask] = (ifc.addr || '/').split('/');
    if (!net.isIPv4(ip) || !validateIPv4Mask(mask)) {
      return {
        valid: false,
        err: `Bad request: Invalid IP address ${ifc.addr}`
      };
    }
  }
  return { valid: true, err: '' };
};

module.exports = {
  validateDevice: validateDevice,
  validateModifyDeviceMsg: validateModifyDeviceMsg
};
