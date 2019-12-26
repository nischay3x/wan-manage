// flexiWAN SD-WAN software - flexiEdge, flexiManage. For more information go to https://flexiwan.com
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
const validateDevice = (device) => {
    // Get all assigned interface. There should be exactly
    // two such interfaces - one LAN and the other WAN
    const interfaces = device.interfaces;
    const assignedIfs = interfaces.filter(ifc => {return ifc.isAssigned; });
    const [wanIf, lanIf] = [
        assignedIfs.find(ifc => { return ifc.type === 'WAN'; }),
        assignedIfs.find(ifc => { return ifc.type === 'LAN'; })
    ];

    if(assignedIfs.length !== 2 || (!wanIf || !lanIf)) {
        return {
            valid: false,
            err: 'There should be exactly one LAN and one WAN interfaces'
        };
    }

    // Check that both interfaces have valid IP addresses and masks
    for(let ifc of assignedIfs) {
        if (!net.isIPv4(ifc.IPv4) || ifc.IPv4Mask === '') {
            return {
                valid: false,
                err: `Interface ${ifc.name} does not have an ${ifc.IPv4Mask === '' ?
                      'IPv4 mask' : 'IP address'}`
            };
        }
    }

    // LAN and WAN interfaces must not be on the same subnet
    // WAN IP address and default GW IP addresses must be on the same subnet
    const wanSubnet = `${wanIf.IPv4}/${wanIf.IPv4Mask}`;
    const lanSubnet = `${lanIf.IPv4}/${lanIf.IPv4Mask}`;
    const defaultGwSubnet = `${device.defaultRoute}/32`;

    if(cidr.overlap(wanSubnet, lanSubnet)) {
        return {
            valid: false,
            err: 'WAN and LAN IP addresses have an overlap'
        };
    }

    /*
    if (!cidr.overlap(wanSubnet, defaultGwSubnet)) {
        return {
            valid: false,
            err: 'WAN and default route IP addresses are not on the same subnet'
        };
    }
    */

    // Currently, we do not support routing on the WAN interface
    if(wanIf.routing === 'OSPF') {
       return {
           valid: false,
           err: 'OSPF should not be configured on WAN interface'
       };
    }

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
    for(let ifc of msg) {
        const [ip, mask] = (ifc.addr || "/").split('/');
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
