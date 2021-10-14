
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

const mongoose = require('mongoose');
const { devices } = require('../models/devices');
const tunnelsModel = require('../models/tunnels');
const notificationsMgr = require('../notifications/notifications')();
const cidr = require('cidr-tools');
const keyBy = require('lodash/keyBy');
const { generateTunnelParams } = require('../utils/tunnelUtils');
const { sendRemoveTunnelsJobs } = require('../deviceLogic/tunnels');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const modifyDeviceApply = require('./modifyDevice').apply;
const reconstructTunnels = require('./modifyDevice').reconstructTunnels;
const configStates = require('./configStates');
const eventsReasons = require('./events/eventReasons');
const configs = require('../configs')();
const Limiter = require('../limiters/limiter');
const publicAddrBlockTime = configs.get('publicAddrBlockTime', 'number');

// const publicAddrInfoLimiter = new Limiter(5, 60 * 60, publicAddrBlockTime);
// Change it
const publicAddrInfoLimiter = new Limiter(5, 60, publicAddrBlockTime);

class Events {
  constructor () {
    this.changedDevices = [];
    this.pendingTunnels = new Set();
    this.activeTunnels = new Set();
  }

  /**
   * Add device id to the changed devices list
   * @param  {string} deviceId device id
  */
  async addChangedDevice (deviceId, origDevice = null) {
    const id = deviceId.toString();
    if (!this.changedDevices[id]) {
      // save the orig device for job processing
      if (!origDevice) {
        origDevice = await devices.findOne({ _id: id });
      }

      this.changedDevices[id] = {
        orig: origDevice
      };
    }
  }

  /**
   * Send notification about pending static route
   * @param  {object} route route object
   * @param  {object} device device object
   * @param  {string} reason  notification reason
  */
  async staticRouteSetToPending (route, device, reason) {
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: `Static route via ${route.gateway} is in pending state`,
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: reason
    }]);
  }

  /**
   * Handle public port/ip rate limited
   * @param  {object} origDevice device object
   * @param  {object} origIfc interface object
  */
  async publicInfoIsRateLimited (origDevice, origIfc) {
    logger.error('Public address rate limit exceeded. tunnels will set as pending',
      { params: { deviceId: origDevice._id, interfaceId: origIfc._id } }
    );

    const reason = `The public address of interface ${origIfc.name}
    in device ${origDevice.name} is changing at a high rate.
    Click on the "Sync" button to re-enable self-healing`;
    await this.setPendingStateToTunnels(origDevice, origIfc, reason);
  }

  /**
   * Handle public port/ip rate limit released
   * @param  {object} origDevice device object
   * @param  {object} origIfc interface object
  */
  async publicInfoRateLimitIsReleased (origDevice, origIfc) {
    await this.removePendingStateFromTunnels(origDevice, origIfc);
  }

  /**
   * Set IP exists on the interface
   * @param  {number} deviceId device id
   * @param  {number} ifcId    interface id
   * @param  {boolean} hasIP  indicate if ip exists in the device side
  */
  async setInterfaceHasIP (deviceId, ifcId, hasIP) {
    await this.addChangedDevice(deviceId);

    await devices.findOneAndUpdate(
      { _id: deviceId },
      {
        $set: {
          'interfaces.$[elem].hasIpOnDevice': hasIP
        }
      },
      {
        arrayFilters: [{ 'elem._id': ifcId }]
      }
    );
  };

  /**
   * Set incomplete state for tunnel if needed and send notification
   * @param  {number} num  tunnel number
   * @param  {string} org  organization id
   * @param  {boolean} isIncomplete  indicate if need set as incomplete or not
   * @param  {string} reason  incomplete reason
   * @param  {object} device  device of incomplete tunnel
  */
  async setIncompleteTunnelStatus (num, org, isIncomplete, reason, device) {
    await this.addChangedDevice(device._id);

    const tunnel = await tunnelsModel.findOneAndUpdate(
      // Query, use the org and tunnel number
      { org, num },
      {
        $set: {
          configStatus: isIncomplete ? configStates.INCOMPLETE : '',
          configStatusReason: isIncomplete ? reason : ''
        }
      },
      // Options
      { upsert: false, new: true }
    ).lean();

    if (isIncomplete) {
      this.pendingTunnels.add(tunnel._id.toString());
      await this.tunnelSetToPending(tunnel, device, reason);
    } else {
      this.activeTunnels.add(tunnel._id.toString());
      await this.tunnelSetToActive(tunnel, device);
    }
  };

  /**
   * Send notification about interface connectivity state
   * @param  {object} device device object
   * @param  {object} origIfc interface object
   * @param  {boolean} state if true, the connectivity is online
  */
  async interfaceConnectivityChanged (device, origIfc, state) {
    const stateTxt = state ? 'online' : 'offline';
    logger.info(`Interface connectivity changed to ${stateTxt}`, { params: { origIfc } });
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: 'Interface connection changed',
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: `Interface ${origIfc.name} state changed to "${stateTxt}"`
    }]);
  };

  /**
   * Handle interface ip restored event
   * @param  {object} device device object
   * @param  {object} origIfc original interface object
   * @param  {object} ifc updated interface object
  */
  async interfaceIpExists (device, origIfc, ifc) {
    // no need to print it every time
    if (origIfc.hasIpOnDevice === false) {
      logger.info('Interface IP exists', {
        params: {
          deviceId: device._id,
          origIp: origIfc.IPv4,
          updatedIp: ifc.IPv4
        }
      });
    }

    // mark interface as lost IP
    await this.setInterfaceHasIP(device._id, origIfc._id, true);

    // unset related tunnels as pending
    await this.removePendingStateFromTunnels(device, origIfc);

    // unset related static routes as pending
    for (let i = 0; i < device.staticroutes.length; i++) {
      const s = device.staticroutes[i];
      if (s.configStatus !== configStates.INCOMPLETE) continue;

      const isSameIfc = s.ifname === ifc.devId;

      const gatewaySubnet = `${s.gateway}/32`;
      const isOverlapping = cidr.overlap(`${ifc.IPv4}/${ifc.IPv4Mask}`, gatewaySubnet);

      if (isSameIfc || isOverlapping) {
        await this.setIncompleteRouteStatus(s, false, '', device);
      }
    }
  };

  /**
   * Remove pending status from tunnels
   * @param  {object} device device object
   * @param  {object} origIfc original interface object
  */
  async removePendingStateFromTunnels (device, origIfc = null) {
    // check if tunnels are pending due to rate limit
    const isBlocked = await publicAddrInfoLimiter.isBlocked(device._id.toString());
    if (isBlocked) {
      return;
    }

    const orQuery = [];
    if (origIfc) {
      orQuery.push({ deviceA: device._id, interfaceA: origIfc._id });
      orQuery.push({ deviceB: device._id, interfaceB: origIfc._id });
    } else {
      orQuery.push({ deviceA: device._id });
      orQuery.push({ deviceB: device._id });
    };

    const tunnels = await tunnelsModel.find({
      $or: orQuery,
      isActive: true
    })
      .populate('deviceA', 'name interfaces')
      .populate('deviceB', 'name interfaces')
      .lean();

    for (const tunnel of tunnels) {
      // no need to update active tunnels, go and check routes
      if (tunnel.configStatus === '') {
        await this.tunnelSetToActive(tunnel, device);
      } else {
        // make sure both interfaces have IP addresses before removing pending status
        const ifcA = tunnel.deviceA.interfaces.find(
          i => i._id.toString() === tunnel.interfaceA.toString());
        const ifcB = tunnel.peer ? null : tunnel.deviceB.interfaces.find(
          i => i._id.toString() === tunnel.interfaceB.toString());

        if (ifcA.hasIpOnDevice && (tunnel.peer || ifcB.hasIpOnDevice)) {
          await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, false, '', device);
        } else {
          const ifcWithoutIp = tunnel.peer ? ifcA : ifcA.hasIpOnDevice ? ifcB : ifcA;
          const deviceWithoutIp = tunnel.peer
            ? tunnel.deviceA : ifcA.hasIpOnDevice ? tunnel.deviceB : tunnel.deviceA;

          // if one event is removed but still no ip on the interface, change the reason
          const reason = eventsReasons.interfaceHasNoIp(ifcWithoutIp.name, deviceWithoutIp.name);
          await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, true, reason, device);
        }
      }
    };
  }

  /**
   * Handle event: Interface has no expected IP
   * @param  {object} device device object
   * @param  {object} origIfc original interface before the event
   * @param  {object} ifc updated ifc from the device
  */
  async interfaceIpMissing (device, origIfc, ifc) {
    logger.info('Interface IP missing', { params: { device, origIfc, ifc } });

    // mark interface as lost IP
    await this.setInterfaceHasIP(device._id, origIfc._id, false);

    // set related tunnels as pending
    const reason = eventsReasons.interfaceHasNoIp(origIfc.name, device.name);
    await this.setPendingStateToTunnels(device, origIfc, reason);

    // set related static routes as pending
    for (let i = 0; i < device.staticroutes.length; i++) {
      const s = device.staticroutes[i];
      if (s.configStatus === configStates.INCOMPLETE) continue;

      const isSameIfc = s.ifname === ifc.devId;

      const gatewaySubnet = `${s.gateway}/32`;
      const isOverlapping = cidr.overlap(`${origIfc.IPv4}/${origIfc.IPv4Mask}`, gatewaySubnet);

      if (isSameIfc || isOverlapping) {
        const reason = eventsReasons.interfaceHasNoIp(origIfc.name, device.name);
        await this.setIncompleteRouteStatus(s, true, reason, device);
      }
    }
  };

  /**
   * Set pending status to a tunnel
   * @param  {object} device device object
   * @param  {object} origIfc original interface before the event
   * @param  {string} reason indicate why tunnel should be pending
  */
  async setPendingStateToTunnels (device, origIfc, reason) {
    const tunnels = await tunnelsModel.find({
      $or: [
        { deviceA: device._id, interfaceA: origIfc._id },
        { deviceB: device._id, interfaceB: origIfc._id }
      ],
      isActive: true
    }).lean();

    for (const tunnel of tunnels) {
      // if tunnel already pending, no need to update it
      if (tunnel.configStatus === configStates.INCOMPLETE) {
        await this.tunnelSetToPending(tunnel, device, reason, false);
      } else {
        await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, true, reason, device);
      }
    };
  }

  /**
   * Handle event: tunnel configured as a pending
   * @param  {object} tunnel tunnel object
   * @param  {object} device device that caused the event
   * @param  {string} reason indicate why tunnel should be pending
   * @param  {boolean} reason indicate if need to notify
  */
  async tunnelSetToPending (tunnel, device, reason, notify = true) {
    if (notify) {
      await notificationsMgr.sendNotifications([{
        org: tunnel.org,
        title: `Tunnel number ${tunnel.num} is in pending state`,
        time: new Date(),
        device: device._id,
        machineId: device.machineId,
        details: reason
      }]);
    }

    const staticRoutesDevices = await this.getTunnelStaticRoutes(tunnel);

    for (const staticRouteDevice of staticRoutesDevices) {
      for (const staticRoute of staticRouteDevice.staticroutes) {
        // no need to update pending static routes
        if (staticRoute.configStatus === configStates.INCOMPLETE) {
          continue;
        }

        const reason = eventsReasons.tunnelIsPending(tunnel.num);
        await this.setIncompleteRouteStatus(staticRoute, true, reason, staticRouteDevice);
      }
    }
  };

  /**
   * Handle event: tunnel configured as a active
   * @param  {object} tunnel tunnel object
   * @param  {object} device device that caused the event
   * @param  {string} reason indicate why tunnel should be pending
  */
  async tunnelSetToActive (tunnel, device) {
    // get tunnel static routes
    const staticRoutesDevices = await this.getTunnelStaticRoutes(tunnel);

    for (const staticRouteDevice of staticRoutesDevices) {
      for (const staticRoute of staticRouteDevice.staticroutes) {
        // no need to update non pending routes
        if (staticRoute.configStatus === '') {
          continue;
        } else {
          await this.setIncompleteRouteStatus(staticRoute, false, '', staticRouteDevice);
        }
      }
    }
  };

  /**
   * Get all devices with static routes via the tunnel
   * @param  {object} tunnel tunnel object
   * @param  {boolean} pending indicate if need to fetch pending static routes or active
   * @return {[{object}]} array of devices with static routes via the given tunnel
  */
  async getTunnelStaticRoutes (tunnel) {
    const { ip1, ip2 } = generateTunnelParams(tunnel.num);

    const devicesStaticRoutes = await devices.aggregate([
      { $match: { org: tunnel.org } }, // org match is very important here
      {
        $addFields: {
          staticroutes: {
            $filter: {
              input: '$staticroutes',
              as: 'route',
              cond: {
                $and: [
                  {
                    $or: [
                      { $eq: ['$$route.gateway', ip1] },
                      { $eq: ['$$route.gateway', ip2] }
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    ]).allowDiskUse(true);

    return devicesStaticRoutes;
  }

  /**
   * Set incomplete state for static route if needed
   * @param  {number} routeId  static route id
   * @param  {boolean} isIncomplete  indicate if need set as incomplete or not
   * @param  {string} reason  incomplete reason
   * @param  {object} device  device of incomplete tunnel
  */
  async setIncompleteRouteStatus (route, isIncomplete, reason, device) {
    await this.addChangedDevice(device._id);

    await devices.findOneAndUpdate(
      { _id: mongoose.Types.ObjectId(device._id) },
      {
        $set: {
          'staticroutes.$[elem].configStatus': isIncomplete ? configStates.INCOMPLETE : '',
          'staticroutes.$[elem].configStatusReason': isIncomplete ? reason : ''
        }
      },
      {
        arrayFilters: [{ 'elem._id': mongoose.Types.ObjectId(route._id) }]
      }
    );

    if (isIncomplete) {
      await this.staticRouteSetToPending(route, device, reason);
    }
  };

  /**
   * Send needed tunnels jobs (remove or add)
  */
  async sendTunnelsRemoveJobs () {
    const removeTunnelIds = Array.from(this.pendingTunnels);
    if (removeTunnelIds.length > 0) {
      await sendRemoveTunnelsJobs(removeTunnelIds);
    }
  }

  /**
   * Send needed tunnels jobs (remove or add)
  */
  async sendTunnelsCreateJobs () {
    const reconstructTunnelIds = Array.from(this.activeTunnels);
    if (reconstructTunnelIds.length > 0) {
      await reconstructTunnels(reconstructTunnelIds, 'system');
    }
  }

  /**
   * Computes and checks if need to trigger event
   * @param  {object} origDevice  original device from DB
   * @param  {array} newInterfaces  incoming interfaces from the device
   * @param  {boolean} routerIsRunning  indicate if router is running
  */
  async checkIfToTriggerEvent (origDevice, newInterfaces, routerIsRunning) {
    try {
      const orig = keyBy(origDevice.interfaces, 'devId');
      const updated = keyBy(newInterfaces, 'devId');

      for (const devId in orig) {
        const origIfc = orig[devId];
        const updatedIfc = updated[devId];

        // no need to send events for unassigned interfaces
        if (!origIfc.isAssigned) {
          continue;
        }

        if (this.isInterfaceConnectivityChanged(origIfc, updatedIfc)) {
          await this.interfaceConnectivityChanged(origDevice, origIfc, updatedIfc.internetAccess);
        }

        const isPublicPortChanged = this.isPublicPortChanged(origIfc, updatedIfc);
        const isPublicIpChanged = this.isPublicIpChanged(origIfc, updatedIfc);
        if (isPublicPortChanged || isPublicIpChanged) {
          const deviceId = origDevice._id.toString();
          const { allowed, blockedNow, releasedNow } = await publicAddrInfoLimiter.use(deviceId);
          if (releasedNow) {
            await this.publicInfoRateLimitIsReleased(origDevice, origIfc);
          } else if (!allowed && blockedNow) {
            await this.publicInfoIsRateLimited(origDevice, origIfc);
          }
        }

        if (this.isIpMissing(origIfc, updatedIfc, routerIsRunning)) {
          await this.interfaceIpMissing(origDevice, origIfc, updatedIfc);
        }

        if (this.isIpExists(updatedIfc)) {
          await this.interfaceIpExists(origDevice, origIfc, updatedIfc);
        }
      }
    } catch (err) {
      logger.error('events check failed', { params: { err: err.message } });
      throw err;
    }
  }

  /**
   * Check if WAN interface lost connectivity
   * @param  {object} origIfc  interface from flexiManage DB
   * @param  {object} updatedIfc  incoming interface info from device
   * @return {boolean} if need to trigger event of internet connectivity lost
  */
  isInterfaceConnectivityChanged (origIfc, updatedIfc) {
    // from device internetAccess type is boolean, in management it is enum yes/no
    const prevInternetAccess = origIfc.internetAccess === 'yes';

    if (updatedIfc.internetAccess === undefined) {
      return false;
    }

    if (!origIfc.monitorInternet) {
      return false;
    }

    if (updatedIfc.internetAccess === prevInternetAccess) {
      return false;
    }

    return true;
  };

  /**
   * Prepares a dictionary of routers to send to modify-device job
   * @return {{machineId: {orig: object, updated: object}}} dictionary with orig and updated device
   */
  async prepareModifyDispatcherParameters () {
    const modifyDevices = { /* original, updated */ };

    const devicesIds = Object.keys(this.changedDevices);

    let updatedDevices = await devices.find({
      _id: { $in: devicesIds }
    });

    updatedDevices = keyBy(updatedDevices, '_id');

    for (const deviceId in this.changedDevices) {
      const orig = this.changedDevices[deviceId].orig;
      const machineId = orig.machineId;
      modifyDevices[machineId] = {
        orig: orig,
        updated: updatedDevices[deviceId]
      };
    }

    return modifyDevices;
  };

  /**
   * Check if public port is changed
   * @param  {object} origIfc  interface from flexiManage DB
   * @param  {object} updatedIfc  incoming interface info from device
   * @return {boolean} if need to trigger event of ip restored
  */
  isPublicPortChanged (origIfc, updatedIfc) {
    if (updatedIfc.public_port === '') {
      return false;
    }

    if (origIfc.PublicPort === updatedIfc.public_port.toString()) {
      return false;
    }

    return true;
  };

  /**
   * Check if public ip is changed
   * @param  {object} origIfc  interface from flexiManage DB
   * @param  {object} updatedIfc  incoming interface info from device
   * @return {boolean} if need to trigger event of ip restored
  */
  isPublicIpChanged (origIfc, updatedIfc) {
    if (updatedIfc.public_ip === '') {
      return false;
    }

    if (origIfc.PublicIP === updatedIfc.public_ip) {
      return false;
    }

    return true;
  };

  /**
   * Check if IP is exists on an interface
   * @param  {object} origIfc  interface from flexiManage DB
   * @param  {object} updatedIfc  incoming interface info from device
   * @return {boolean} if need to trigger event of ip restored
  */
  isIpExists (updatedIfc) {
    // check if the incoming interface has ip address
    if (updatedIfc.IPv4 === '') {
      return false;
    }

    return true;
  };

  /**
   * Check if IP is missing on an interface
   * @param  {object} origIfc  interface from flexiManage DB
   * @param  {object} updatedIfc  incoming interface info from device
   * @param  {boolean} routerIsRunning  indicate if router is in running state
   * @return {boolean} if need to trigger event of ip lost
   */
  isIpMissing (origIfc, updatedIfc, routerIsRunning) {
    // check if incoming interface is without ip address
    if (updatedIfc.IPv4 !== '') {
      return false;
    }

    // no need to trigger event for LAN interface if router is not running
    if (origIfc.type === 'LAN' && !routerIsRunning) {
      return false;
    }

    return true;
  };
}

/**
 * Remove all pending tunnels for a device
 * @param  {object} device  device object
*/
const removePendingStateFromTunnels = async (device) => {
  const events = new Events();
  await events.removePendingStateFromTunnels(device);

  const modifyDevices = await events.prepareModifyDispatcherParameters();

  await events.sendTunnelsCreateJobs();

  for (const modified in modifyDevices) {
    await modifyDeviceApply(
      [modifyDevices[modified].orig],
      { username: 'system' },
      {
        org: modifyDevices[modified].orig.org.toString(),
        newDevice: modifyDevices[modified].updated
      }
    );
  }
};

module.exports = Events; // default export
exports = module.exports;

exports.removePendingStateFromTunnels = removePendingStateFromTunnels; // named export
exports.publicAddrInfoLimiter = publicAddrInfoLimiter; // named export
