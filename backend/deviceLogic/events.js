
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
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { publicPortLimiter } = require('./eventsRateLimiter');

class Events {
  constructor (session) {
    this.session = session;
  }

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
   * Set IP exists on the interface
   * @param  {number} deviceId device id
   * @param  {number} ifcId    interface id
   * @param  {boolean} hasIP  indicate if ip exists in the device side
   * @return void
  */
  async setInterfaceHasIP (deviceId, ifcId, hasIP) {
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
    ).session(this.session);
  };

  /**
   * Set incomplete state for tunnel if needed and send notification
   * @param  {number} num  tunnel number
   * @param  {string} org  organization id
   * @param  {boolean} isIncomplete  indicate if need set as incomplete or not
   * @param  {string} reason  incomplete reason
   * @param  {object} device  device of incomplete tunnel
   * @return void
  */
  async setIncompleteTunnelStatus (num, org, isIncomplete, reason, device) {
    const tunnel = await tunnelsModel.findOneAndUpdate(
      // Query, use the org and tunnel number
      { org, num },
      {
        $set: {
          configStatus: isIncomplete ? 'incomplete' : '',
          configStatusReason: isIncomplete ? reason : ''
        }
      },
      // Options
      { upsert: false, new: true }
    ).session(this.session).lean();

    if (isIncomplete) {
      await this.tunnelSetToPending(tunnel, device, reason);
    } else {
      await this.tunnelSetToActive(tunnel, device, reason);
    }
  };

  async interfaceConnectivityLost (device, origIfc) {
    logger.info('Interface connectivity changed to offline', { params: { origIfc } });
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: 'Interface connection change',
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: `Interface ${origIfc.name} state changed to "offline"`
    }]);
  };

  async interfaceConnectivityRestored (device, origIfc) {
    logger.info('Interface connectivity changed to online', { params: { origIfc } });
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: 'Interface connection change',
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: `Interface ${origIfc.name} state changed to "online"`
    }]);
  };

  async interfaceIpRestored (device, origIfc, ifc) {
    logger.info('Interface IP restored', { params: { device, origIfc, ifc } });

    // mark interface as lost IP
    await this.setInterfaceHasIP(device._id, origIfc._id, true);

    // unset related tunnels as pending
    await this.removePendingStateFromTunnels(device, origIfc);

    // unset related static routes as pending
    const staticRoutes = device.staticroutes.filter(s => {
      if (s.configStatus !== 'incomplete') return false;

      const isSameIfc = s.ifname === ifc.devId;

      const gatewaySubnet = `${s.gateway}/32`;
      const isOverlapping = cidr.overlap(`${ifc.IPv4}/${ifc.IPv4Mask}`, gatewaySubnet);
      return isSameIfc || isOverlapping;
    });

    for (const route of staticRoutes) {
      await this.setIncompleteRouteStatus(route, false, '', device);
    }
  };

  async removePendingStateFromTunnels (device, origIfc = null) {
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
      isActive: true,
      configStatus: 'incomplete'
    })
      .populate('deviceA', 'interfaces')
      .populate('deviceB', 'interfaces')
      .session(this.session).lean();

    for (const tunnel of tunnels) {
      // make sure both interfaces have IP addresses before removing pending status
      const ifcA = tunnel.deviceA.interfaces.find(
        i => i._id.toString() === tunnel.interfaceA.toString());
      const ifcB = tunnel.deviceB.interfaces.find(
        i => i._id.toString() === tunnel.interfaceB.toString());

      if (ifcA.hasIpOnDevice && ifcB.hasIpOnDevice) {
        await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, false, '', device);
      }
    };
  }

  async interfaceIpLost (device, origIfc, ifc) {
    logger.info('Interface IP lost', { params: { device, origIfc, ifc } });

    // mark interface as lost IP
    await this.setInterfaceHasIP(device._id, origIfc._id, false);

    // set related tunnels as pending
    const reason = `Interface ${origIfc.name} in device ${device.name} has no IP address`;
    await this.setPendingStateToTunnels(device, origIfc, reason);

    // set related static routes as pending
    const staticRoutes = device.staticroutes.filter(s => {
      if (s.configStatus === 'incomplete') return false;

      const isSameIfc = s.ifname === ifc.devId;

      const gatewaySubnet = `${s.gateway}/32`;
      const isOverlapping = cidr.overlap(`${origIfc.IPv4}/${origIfc.IPv4Mask}`, gatewaySubnet);
      return isSameIfc || isOverlapping;
    });

    for (const route of staticRoutes) {
      const reason = `Interface ${origIfc.name} in device ${device.name} has no IP address`;
      await this.setIncompleteRouteStatus(route, true, reason, device);
    }
  };

  async setPendingStateToTunnels (device, origIfc, reason) {
    const tunnels = await tunnelsModel.find({
      $or: [
        { deviceA: device._id, interfaceA: origIfc._id },
        { deviceB: device._id, interfaceB: origIfc._id }
      ],
      isActive: true,
      configStatus: { $ne: 'incomplete' }
    }).session(this.session).lean();

    for (const tunnel of tunnels) {
      await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, true, reason, device);
    };
  }

  async tunnelSetToPending (tunnel, device, reason) {
    await notificationsMgr.sendNotifications([{
      org: tunnel.org,
      title: `Tunnel number ${tunnel.num} is in pending state`,
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: reason
    }]);

    const { ip1, ip2 } = generateTunnelParams(tunnel.num);
    // get static routes via this tunnel and set them as pending
    const staticRoutes = await devices.aggregate([
      { $match: { org: tunnel.org } }, // org match is very important here
      { $project: { _id: 0, staticroutes: 1 } },
      { $unwind: '$staticroutes' },
      // filter our non object documents before 'replaceRoot` stage
      { $match: { staticroutes: { $exists: true, $not: { $type: 'array' }, $type: 'object' } } },
      { $replaceRoot: { newRoot: '$staticroutes' } },
      { $match: { configStatus: { $ne: 'incomplete' }, $or: [{ gateway: ip1 }, { gateway: ip2 }] } }
    ]).session(this.session).allowDiskUse(true);

    for (const route of staticRoutes) {
      const reason = `Tunnel ${tunnel.num} is in pending state`;
      await this.setIncompleteRouteStatus(route, true, reason, device);
    }
  };

  async tunnelSetToActive (tunnel, device, reason) {
    const { ip1, ip2 } = generateTunnelParams(tunnel.num);
    // get static routes via this tunnel and unset them as pending
    const staticRoutes = await devices.aggregate([
      { $match: { org: tunnel.org } }, // org match is very important here
      { $project: { _id: 0, staticroutes: 1 } },
      { $unwind: '$staticroutes' },
      // filter our non object documents before 'replaceRoot` stage
      { $match: { staticroutes: { $exists: true, $not: { $type: 'array' }, $type: 'object' } } },
      { $replaceRoot: { newRoot: '$staticroutes' } },
      { $match: { configStatus: 'incomplete', $or: [{ gateway: ip1 }, { gateway: ip2 }] } }
    ]).session(this.session).allowDiskUse(true);

    for (const route of staticRoutes) {
      await this.setIncompleteRouteStatus(route, false, '', device);
    }
  };

  /**
   * Set incomplete state for static route if needed
   * @param  {number} routeId  static route id
   * @param  {boolean} isIncomplete  indicate if need set as incomplete or not
   * @param  {string} reason  incomplete reason
   * @param  {object} device  device of incomplete tunnel
   * @return void
  */
  async setIncompleteRouteStatus (route, isIncomplete, reason, device) {
    await devices.findOneAndUpdate(
      { _id: mongoose.Types.ObjectId(device._id) },
      {
        $set: {
          'staticroutes.$[elem].configStatus': isIncomplete ? 'incomplete' : '',
          'staticroutes.$[elem].configStatusReason': isIncomplete ? reason : ''
        }
      },
      {
        arrayFilters: [{ 'elem._id': mongoose.Types.ObjectId(route._id) }]
      }
    ).session(this.session);

    if (isIncomplete) {
      await this.staticRouteSetToPending(route, device, reason);
    }
  };

  async check (origDevice, newInterfaces, routerIsRunning) {
    let deviceChanged = false;
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

        if (isInterfaceConnectivityChanged(origIfc, updatedIfc)) {
          if (updatedIfc.internetAccess) {
            await this.interfaceConnectivityRestored(origDevice, origIfc);
          } else {
            await this.interfaceConnectivityLost(origDevice, origIfc);
          }
          deviceChanged = true;
        }

        if (isIpLost(origIfc, updatedIfc, routerIsRunning)) {
          await this.interfaceIpLost(origDevice, origIfc, updatedIfc);
          deviceChanged = true;
        }

        if (isIpRestored(origIfc, updatedIfc)) {
          await this.interfaceIpRestored(origDevice, origIfc, updatedIfc);
          deviceChanged = true;
        }

        if (isPublicPortChanged(origIfc, updatedIfc)) {
          try {
            const res = await publicPortLimiter.consume(origDevice._id);
            // release pending tunnels
            if (res.consumedPoints === 1) {
              deviceChanged = true;
              await this.removePendingStateFromTunnels(origDevice, origIfc);
            }
          } catch (err) {
            // if rate limiting exceeded, we set tunnels as pending
            logger.error('Public port rate limit exceeded. tunnels will set as pending', {
              params: {
                deviceId: origDevice._id,
                origPort: origIfc.PublicPort,
                newPort: updatedIfc.public_port.toString()
              }
            });

            if (err.consumedPoints === publicPortLimiter.points + 1) {
              deviceChanged = true;
              // eslint-disable-next-line max-len
              const reason = `The public port for interface ${origIfc.name} in device ${origDevice.name} is changing at a high rate`;
              await this.setPendingStateToTunnels(origDevice, origIfc, reason);
            }
          }
        }
      }
      return deviceChanged;
    } catch (err) {
      logger.error('events check failed', { params: { err: err.message } });
      throw err;
    }
  }
}

/**
 * Check if WAN interface lost connectivity
 * @param  {object} origIfc  interface from flexiManage DB
 * @param  {object} updatedIfc  incoming interface info from device
 * @return {boolean} if need to trigger event of internet connectivity lost
 */
const isInterfaceConnectivityChanged = (origIfc, updatedIfc) => {
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
 * Check if IP is lost on an interface
 * @param  {object} origIfc  interface from flexiManage DB
 * @param  {object} updatedIfc  incoming interface info from device
 * @param  {boolean} routerIsRunning  indicate if router is in running state
 * @return {boolean} if need to trigger event of ip lost
 */
const isIpLost = (origIfc, updatedIfc, routerIsRunning) => {
  // check if the real ip is different than flexiManage configuration
  if (origIfc.IPv4 === updatedIfc.IPv4) {
    return false;
  }

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

/**
 * Check if IP is restored on an interface
 * @param  {object} origIfc  interface from flexiManage DB
 * @param  {object} updatedIfc  incoming interface info from device
 * @return {boolean} if need to trigger event of ip restored
 */
const isIpRestored = (origIfc, updatedIfc) => {
  // check if the interface is marked without IP
  if (origIfc.hasIpOnDevice !== false) {
    return false;
  }

  // check if the incoming interface has ip address
  if (updatedIfc.IPv4 === '') {
    return false;
  }

  return true;
};

/**
 * Check if public port is changed
 * @param  {object} origIfc  interface from flexiManage DB
 * @param  {object} updatedIfc  incoming interface info from device
 * @return {boolean} if need to trigger event of ip restored
 */
const isPublicPortChanged = (origIfc, updatedIfc) => {
  if (updatedIfc.public_port === '') {
    return false;
  }

  if (origIfc.PublicPort === updatedIfc.public_port.toString()) {
    return false;
  }

  return true;
};

module.exports = Events;
