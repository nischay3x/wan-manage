
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
const mongoConns = require('../mongoConns.js')();
const modifyDeviceApply = require('./modifyDevice').apply;
const reconstructTunnels = require('./modifyDevice').reconstructTunnels;
class Events {
  constructor (session) {
    this.session = session;
    this.changedDevices = new Set();
  }

  addChangedDevice (deviceId) {
    this.changedDevices.add(deviceId.toString());
  }

  /**
   * Send notification about pending static route
   * @param  {object} route route object
   * @param  {object} device device object
   * @param  {string} reason  notification reason
   * @return void
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

    this.addChangedDevice(deviceId);
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

    this.addChangedDevice(device._id);

    if (isIncomplete) {
      await this.tunnelSetToPending(tunnel, device, reason);
    } else {
      await this.tunnelSetToActive(tunnel, device, reason);
    }
  };

  /**
   * Send notification about interface connectivity lost
   * @param  {object} device device object
   * @param  {object} origIfc interface object
   * @return void
  */
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

  /**
   * Send notification about interface connectivity restored
   * @param  {object} device device object
   * @param  {object} origIfc interface object
   * @return void
  */
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

  /**
   * Handle interface ip restored event
   * @param  {object} device device object
   * @param  {object} origIfc original interface object
   * @param  {object} ifc updated interface object
   * @return void
  */
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

  /**
   * Remove pending status from tunnels
   * @param  {object} device device object
   * @param  {object} origIfc original interface object
   * @return void
  */
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
      } else {
        const ifcWithoutIp = ifcA.hasIpOnDevice ? ifcB : ifcA;
        const deviceWithoutIp = ifcA.hasIpOnDevice ? tunnel.deviceB : tunnel.deviceA;

        // if one event is removed but still no ip on the interface, change the reason
        const reason =
          `Interface ${ifcWithoutIp.name} in device ${deviceWithoutIp.name} has no IP address`;
        await this.setIncompleteTunnelStatus(tunnel.num, tunnel.org, true, reason, device);
      }
    };

    return tunnels;
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

    const staticRoutesDevices = await this.getTunnelStaticRoutes(tunnel, false);

    for (const staticRouteDevice of staticRoutesDevices) {
      for (const staticRoute of staticRouteDevice.staticroutes) {
        const reason = `Tunnel ${tunnel.num} is in pending state`;
        await this.setIncompleteRouteStatus(staticRoute, true, reason, staticRouteDevice);
      }
    }
  };

  async getTunnelStaticRoutes (tunnel, pending = false) {
    const { ip1, ip2 } = generateTunnelParams(tunnel.num);
    const pendingStage = pending
      ? { $eq: ['$$route.configStatus', 'incomplete'] }
      : { $ne: ['$$route.configStatus', 'incomplete'] };

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
                  pendingStage,
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
    ]).session(this.session).allowDiskUse(true);

    return devicesStaticRoutes;
  }

  async tunnelSetToActive (tunnel, device, reason) {
    // get incomplete static routes
    const staticRoutesDevices = await this.getTunnelStaticRoutes(tunnel, true);

    for (const staticRouteDevice of staticRoutesDevices) {
      for (const staticRoute of staticRouteDevice.staticroutes) {
        await this.setIncompleteRouteStatus(staticRoute, false, '', staticRouteDevice);
      }
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

    this.addChangedDevice(device._id);

    if (isIncomplete) {
      await this.staticRouteSetToPending(route, device, reason);
    }
  };

  async check (origDevice, newInterfaces, routerIsRunning) {
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
          this.changedDevices.add(origDevice._id);
        }

        if (isIpLost(origIfc, updatedIfc, routerIsRunning)) {
          await this.interfaceIpLost(origDevice, origIfc, updatedIfc);
          this.changedDevices.add(origDevice._id);
        }

        if (isIpRestored(origIfc, updatedIfc)) {
          await this.interfaceIpRestored(origDevice, origIfc, updatedIfc);
          this.changedDevices.add(origDevice._id);
        }

        if (isPublicPortChanged(origIfc, updatedIfc)) {
          try {
            const res = await publicPortLimiter.consume(origDevice._id.toString());
            // release pending tunnels
            if (res.consumedPoints === 1) {
              this.changedDevices.add(origDevice._id);
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
              this.changedDevices.add(origDevice._id);
              // eslint-disable-next-line max-len
              const reason = `The public port for interface ${origIfc.name} in device ${origDevice.name} is changing at a high rate`;
              await this.setPendingStateToTunnels(origDevice, origIfc, reason);
            }
          }
        }
      }
      return this.changedDevices;
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

const removePendingStateFromTunnels = async (device, sendJobs = false) => {
  let session = null;
  try {
    session = await mongoConns.getMainDB().startSession();
    await session.startTransaction();
    const events = new Events(session);
    const tunnels = await events.removePendingStateFromTunnels(device);

    if (!sendJobs || events.changedDevices.size === 0) {
      await session.commitTransaction();
      await session.endSession();
      return;
    }

    const devicesIdsArr = Array.from(events.changedDevices);
    const modifyDevices = await prepareModifyDispatcherParameters(devicesIdsArr, session);

    await session.commitTransaction();
    await session.endSession();

    await reconstructTunnels(tunnels.map(t => t._id), device.org, 'system');

    for (const modified in modifyDevices) {
      await modifyDeviceApply(
        [modifyDevices[modified].orig],
        { username: 'system' },
        {
          org: modifyDevices[modified].orig.org.toString(),
          newDevice: modifyDevices[modified].updated,
          origTunnels: modifyDevices[modified].origTunnels
        }
      );
    }
  } catch (err) {
    if (session) await session.abortTransaction();
    throw err;
  } finally {
    if (session) await session.endSession();
  }
};

const prepareModifyDispatcherParameters = async (devicesIds, session) => {
  const modifyDevices = { /* original, updated, origTunnels */ };

  let origDevices = await devices.find({
    _id: { $in: devicesIds }
  }); // without session

  let updatedDevices = await devices.find({
    _id: { $in: devicesIds }
  }).session(session); // with session

  origDevices = keyBy(origDevices, 'machineId');
  updatedDevices = keyBy(updatedDevices, 'machineId');

  for (const machineId in origDevices) {
    const origTunnels = await tunnelsModel.find({
      isActive: true,
      $or: [
        { deviceA: origDevices[machineId]._id },
        { deviceB: origDevices[machineId]._id }
      ]
    }).lean();

    modifyDevices[machineId] = {
      orig: origDevices[machineId],
      updated: updatedDevices[machineId],
      origTunnels: origTunnels
    };
  }

  return modifyDevices;
};

module.exports = Events; // default export
exports = module.exports;

exports.removePendingStateFromTunnels = removePendingStateFromTunnels; // named export
exports.prepareModifyDispatcherParameters = prepareModifyDispatcherParameters; // named export
