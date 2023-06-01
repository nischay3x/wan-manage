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
  static selectVrrpGroupParams (vrrpGroup) {
    vrrpGroup._id = vrrpGroup._id.toString();
    vrrpGroup.org = vrrpGroup.org.toString();
    vrrpGroup.virtualRouterId = vrrpGroup.virtualRouterId.toString();
    vrrpGroup.devices = vrrpGroup.devices.map(d => {
      return {
        ...d,
        _id: d._id.toString(),
        device: d.device.toString(),
        interface: d.interface.toString(),
        trackInterfaces: d.trackInterfaces.map(t => t.toString())
      };
    });

    return vrrpGroup;
  }

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
   * VrrpGroup VrrpGroup
   * returns VRRP Group
   **/
  static async vrrpPOST ({ org, vrrpGroup }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const { valid, err } = VrrpService.validateVrrp(vrrpGroup);
      if (!valid) {
        throw new Error(err);
      }

      const newVrrpGroup = await Vrrp.create({ ...vrrpGroup, org: orgList[0].toString() });

      // TODO: install on devices.

      return Service.successResponse(newVrrpGroup);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
  * Update a VRRP Group
  **/
  static async vrrpIdPUT ({ id, org, vrrpGroup }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const isExists = await Vrrp.findOne({ _id: id, org: { $in: orgList } }).lean();
      if (!isExists) {
        logger.error('Failed to get VRRP Group', {
          params: { id, org, orgList }
        });
        return Service.rejectResponse('VRRP Group is not found', 404);
      }

      const { valid, err } = VrrpService.validateVrrp(vrrpGroup);
      if (!valid) {
        throw new Error(err);
      }

      const updatedVrrpGroup = await Vrrp.findOneAndUpdate(
        { _id: id }, // no need to check for org as it was checked before
        vrrpGroup,
        { upsert: false, new: true, runValidators: true }
      ).lean();

      // TODO: update all devices.

      const returnValue = VrrpService.selectVrrpGroupParams(updatedVrrpGroup);
      return Service.successResponse(returnValue, 200);
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
  * Get a VRRP Group
  **/
  static async vrrpIdGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const vrrpGroup = await Vrrp.findOne({ _id: id, org: { $in: orgList } }).lean();
      if (!vrrpGroup) {
        logger.error('Failed to get VRRP Group', {
          params: { id, org, orgList }
        });
        return Service.rejectResponse('VRRP Group is not found', 404);
      }

      const returnValue = VrrpService.selectVrrpGroupParams(vrrpGroup);
      return Service.successResponse(returnValue, 200);
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
                        // { $eq: ['$$ifc.type', 'LAN'] },
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
    function u (n) { return n >>> 0; } // convert to unsigned
    function addr32 (ip) {
      const m = ip.split('.');
      return m.reduce((a, o) => { return u(+a << 8) + +o; });
    }
    const [address1, mask1] = subnet1.split('/');
    const [address2, mask2] = subnet2.split('/');

    const binAddress1 = addr32(address1);
    const binAddress2 = addr32(address2);
    const binMask1 = u(~0 << (32 - +mask1));
    const binMask2 = u(~0 << (32 - +mask2));

    const [start1, end1] = [u(binAddress1 & binMask1), u(binAddress1 | ~binMask1)];
    const [start2, end2] = [u(binAddress2 & binMask2), u(binAddress2 | ~binMask2)];

    return (
      (start1 >= start2 && start1 <= end2) ||
      (start2 >= start1 && start2 <= end1)
    );
  }

  return interfaces.some(i => {
    return checkSubnetIntersection(i.IPv4, `${virtualIP}/32`);
  });
}

module.exports = VrrpService;
