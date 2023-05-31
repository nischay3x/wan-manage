/* eslint-disable no-multi-str */
/* eslint-disable no-template-curly-in-string */
// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2023  flexiWAN Ltd.

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

const Service = require('./Service');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
// const jwt = require('jsonwebtoken');
// const configs = require('../configs.js')();
const Vrrp = require('../models/vrrp');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const ObjectId = require('mongoose').Types.ObjectId;

class VrrpService {
  /**
   * Get all VRRP groups
   *
   * returns List
   **/
  static async vrrpGET ({ org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const result = await Vrrp.find({ org: { $in: orgList } })
        .populate('devices.device', '_id name')
        .lean();

      const vrrpGroups = result.map(vrrp => {
        return {
          name: vrrp.name,
          virtualRouterId: vrrp.virtualRouterId,
          virtualIp: vrrp.virtualIp,
          devices: vrrp.devices.map(d => {
            return { name: d.device.name, _id: d.device._id.toString() };
          }),
          _id: vrrp._id.toString()
        };
      });

      return Service.successResponse(vrrpGroups);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Create new VRRP Group
   *
   * vrrpGroupRequest vrrpGroupRequest
   * returns VRRP Group
   **/
  static async vrrpPOST ({ org, vrrpGroupRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const { valid, err } = VrrpService.validateVrrp(vrrpGroupRequest);
      if (!valid) {
        throw new Error(err);
      }

      // on creation, we set tempId for each device row so here we delete it.
      // Note, it is not about device ID but ID of the vrrp device item in the list.
      vrrpGroupRequest.devices = vrrpGroupRequest.devices.map(d => {
        delete d._id;
        return d;
      });

      const newPeer = await Vrrp.create({ ...vrrpGroupRequest, org: orgList[0].toString() });

      // TODO: install on devices.

      return Service.successResponse(newPeer);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
  * Delete VRRP Group
  **/
  static async vrrpIdDELETE ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const resp = await Vrrp.deleteOne({ _id: id, org: { $in: orgList } });
      if (resp?.deletedCount === 0) {
        logger.error('Failed to remove VRRP Group', {
          params: { id, org, orgList, resp: resp }
        });
        return Service.rejectResponse('VRRP Group is not found', 404);
      }

      // TODO: remove from devices.

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
  * Get devices which overlapping with the virtualIP
  **/
  static async vrrpDeviceVrrpInterfacesGET ({ org, virtualIp }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const pipeline = [
        { $match: { org: { $in: orgList.map(o => ObjectId(o)) } } },
        {
          $project: {
            _id: 1,
            name: 1,
            interfaces: {
              $map: {
                input: {
                  $filter: {
                    input: '$interfaces',
                    as: 'ifc',
                    cond: {
                      $and: [
                        { $eq: ['$$ifc.type', 'LAN'] },
                        { $eq: ['$$ifc.isAssigned', true] },
                        { $ne: ['$$ifc.IPv4', ''] },
                        { $ne: ['$$ifc.IPv4Mask', ''] }
                      ]
                    }
                  }
                },
                as: 'ifc',
                in: {
                  _id: '$$ifc._id',
                  name: '$$ifc.name',
                  IPv4: { $concat: ['$$ifc.IPv4', '/', '$$ifc.IPv4Mask'] }
                }
              }
            }
          }
        },
        {
          $addFields: {
            isOverlapping: {
              $function: {
                body: checkOverlapping.toString(),
                args: ['$interfaces', virtualIp],
                lang: 'js'
              }
            }
          }
        },
        { $match: { isOverlapping: true } },
        { $unset: ['isOverlapping'] }
      ];

      const res = await devices.aggregate(pipeline).allowDiskUse(true);

      return res.map(r => {
        return {
          ...r,
          _id: r._id.toString(),
          interfaces: r.interfaces.map(i => {
            return {
              ...i,
              _id: i._id.toString()
            };
          })
        };
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static validateVrrp (vrrp) {
    return { valid: true, err: '' };
  }
}

function checkOverlapping (interfaces, virtualIP) {
  function checkSubnetIntersection (subnet1, subnet2) {
    // Parse subnet strings into network address and mask
    const [address1, mask1] = subnet1.split('/');
    const [address2, mask2] = subnet2.split('/');
    // Convert network addresses to binary format
    const address1Binary = ipToBinary(address1);
    const address2Binary = ipToBinary(address2);
    // Convert masks to binary format
    const mask1Binary = maskToBinary(mask1);
    const mask2Binary = maskToBinary(mask2);
    // Calculate the network address and broadcast address using bitwise AND
    const network1 = bitwiseAnd(address1Binary, mask1Binary);
    const network2 = bitwiseAnd(address2Binary, mask2Binary);
    const broadcast1 = bitwiseOr(network1, bitwiseNot(mask1Binary));
    const broadcast2 = bitwiseOr(network2, bitwiseNot(mask2Binary));
    // Check for intersection by comparing network addresses and broadcast addresses
    return (
      (network1 >= network2 && network1 <= broadcast2) ||
      (network2 >= network1 && network2 <= broadcast1)
    );
  }

  // Helper function to convert an IP address to binary format
  function ipToBinary (ipAddress) {
    return ipAddress.split('.').map((segment) => {
      return parseInt(segment).toString(2).padStart(8, '0');
    }).join('');
  }

  // Helper function to convert a subnet mask to binary format
  function maskToBinary (mask) {
    const binaryMask = '1'.repeat(mask) + '0'.repeat(32 - mask);
    return binaryMask;
  }

  // Helper function for bitwise AND operation
  function bitwiseAnd (a, b) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
      result += a[i] === '1' && b[i] === '1' ? '1' : '0';
    }
    return result;
  }

  // Helper function for bitwise OR operation
  function bitwiseOr (a, b) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
      result += a[i] === '1' || b[i] === '1' ? '1' : '0';
    }
    return result;
  }

  // Helper function for bitwise NOT operation
  function bitwiseNot (a) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
      result += a[i] === '1' ? '0' : '1';
    }
    return result;
  }

  return interfaces.some(i => {
    return checkSubnetIntersection(i.IPv4, `${virtualIP}/32`);
  });
};

module.exports = VrrpService;
