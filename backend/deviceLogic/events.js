
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

// File used to dispatch the apply logic to the right function
const mongoose = require('mongoose');
const { devices } = require('../models/devices');
const tunnelsModel = require('../models/tunnels');
const notificationsMgr = require('../notifications/notifications')();
const cidr = require('cidr-tools');
const keyBy = require('lodash/keyBy');
const { generateTunnelParams } = require('../utils/tunnelUtils');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

const EVENTS = {
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  INTERFACE_CONNECTIVITY_LOST: 'INTERFACE_CONNECTIVITY_LOST',
  INTERFACE_CONNECTIVITY_RESTORED: 'INTERFACE_CONNECTIVITY_RESTORED',
  INTERFACE_IP_LOST: 'INTERFACE_IP_LOST',
  INTERFACE_IP_RESTORED: 'INTERFACE_IP_RESTORED',
  TUNNEL_SET_TO_PENDING: 'TUNNEL_SET_TO_PENDING',
  TUNNEL_SET_TO_ACTIVE: 'TUNNEL_SET_TO_ACTIVE',
  STATIC_ROUTE_SET_TO_PENDING: 'STATIC_ROUTE_SET_TO_PENDING'
};

const HANDLERS = {
  INTERFACE_IP_LOST: async (device, origIfc, ifc) => {
    // mark interface as lost IP
    await setInterfaceHasIP(device._id, origIfc._id, false);

    // set related tunnels as pending
    const tunnels = await tunnelsModel.find({
      $or: [
        { deviceA: device._id, interfaceA: origIfc._id },
        { deviceB: device._id, interfaceB: origIfc._id }
      ],
      isActive: true,
      configStatus: { $ne: 'incomplete' }
    }).lean();

    for (const tunnel of tunnels) {
      const reason = `Interface ${origIfc.name} in device ${device.name} has no IP address`;
      await setIncompleteTunnelStatus(tunnel.num, tunnel.org, true, reason, device);
    };

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
      await setIncompleteRouteStatus(route, true, reason, device);
    }
  },
  INTERFACE_IP_RESTORED: async (device, origIfc, ifc) => {
    // mark interface as lost IP
    await setInterfaceHasIP(device._id, origIfc._id, true);

    // unset related tunnels as pending
    const tunnels = await tunnelsModel.find({
      $or: [
        { deviceA: device._id, interfaceA: origIfc._id },
        { deviceB: device._id, interfaceB: origIfc._id }
      ],
      isActive: true,
      configStatus: 'incomplete'
    }).lean();

    for (const tunnel of tunnels) {
      await setIncompleteTunnelStatus(tunnel.num, tunnel.org, false, '', device);
    };

    // unset related static routes as pending
    const staticRoutes = device.staticroutes.filter(s => {
      if (s.configStatus !== 'incomplete') return false;

      const isSameIfc = s.ifname === ifc.devId;

      const gatewaySubnet = `${s.gateway}/32`;
      const isOverlapping = cidr.overlap(`${ifc.IPv4}/${ifc.IPv4Mask}`, gatewaySubnet);
      return isSameIfc || isOverlapping;
    });

    for (const route of staticRoutes) {
      await setIncompleteRouteStatus(route, false, '', device);
    }
  },
  INTERFACE_CONNECTIVITY_LOST: async (device, origIfc) => {
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: 'Interface connection change',
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: `Interface ${origIfc.name} state changed to "offline"`
    }]);
  },
  INTERFACE_CONNECTIVITY_RESTORED: async (device, origIfc) => {
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: 'Interface connection change',
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: `Interface ${origIfc.name} state changed to "online"`
    }]);
  },
  TUNNEL_SET_TO_PENDING: async (tunnel, device, reason) => {
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
    ]).allowDiskUse(true);

    for (const route of staticRoutes) {
      const reason = `Tunnel ${tunnel.num} is in pending state`;
      await setIncompleteRouteStatus(route, true, reason, device);
    }
  },
  TUNNEL_SET_TO_ACTIVE: async (tunnel, device, reason) => {
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
    ]).allowDiskUse(true);

    for (const route of staticRoutes) {
      await setIncompleteRouteStatus(route, false, '', device);
    }
  },
  STATIC_ROUTE_SET_TO_PENDING: async (route, device, reason) => {
    await notificationsMgr.sendNotifications([{
      org: device.org,
      title: `Static route via ${route.gateway} is in pending state`,
      time: new Date(),
      device: device._id,
      machineId: device.machineId,
      details: reason
    }]);
  }
};

const trigger = async (eventType, ...args) => {
  try {
    if (!EVENTS[eventType]) {
      logger.error('event not found', { params: { eventType, ...args } });
      throw new Error('Event not found');
    }

    const res = await HANDLERS[eventType](...args);
    return res;
  } catch (err) {
    logger.error('failed to trigger event', { params: { err: err.message, eventType, ...args } });
  }
};

const check = async (origDevice, newInterfaces, routerIsRunning) => {
  const orig = keyBy(origDevice.interfaces, 'devId');
  const updated = keyBy(newInterfaces, 'devId');
  let deviceChanged = false;

  for (const devId in orig) {
    const origIfc = orig[devId];
    const updatedIfc = updated[devId];

    // no need to send events for unassigned interfaces
    if (!origIfc.isAssigned) {
      continue;
    }

    if (isInterfaceConnectivityChanged(origIfc, updatedIfc)) {
      logger.info('Interface connectivity changed', { params: { origIfc, updatedIfc } });
      if (updatedIfc.internetAccess) {
        await trigger(EVENTS.INTERFACE_CONNECTIVITY_RESTORED, origDevice, origIfc);
      } else {
        await trigger(EVENTS.INTERFACE_CONNECTIVITY_LOST, origDevice, origIfc);
      }
    }

    if (isIpLost(origIfc, updatedIfc, routerIsRunning)) {
      logger.info('Interface IP lost', { params: { origIfc, updatedIfc, routerIsRunning } });
      await trigger(EVENTS.INTERFACE_IP_LOST, origDevice, origIfc, updatedIfc);
      deviceChanged = true;
    }

    if (isIpRestored(origIfc, updatedIfc)) {
      logger.info('Interface IP restored', { params: { origIfc, updatedIfc } });
      await trigger(EVENTS.INTERFACE_IP_RESTORED, origDevice, origIfc, updatedIfc);
      deviceChanged = true;
    }
  }

  return deviceChanged;
};

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
 * Set incomplete state for tunnel if needed and send notification
 * @param  {number} num  tunnel number
 * @param  {string} org  organization id
 * @param  {boolean} isIncomplete  indicate if need set as incomplete or not
 * @param  {string} reason  incomplete reason
 * @param  {object} device  device of incomplete tunnel
 * @return void
 */
const setIncompleteTunnelStatus = async (num, org, isIncomplete, reason, device) => {
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
  ).lean();

  if (isIncomplete) {
    await trigger(EVENTS.TUNNEL_SET_TO_PENDING, tunnel, device, reason);
  } else {
    await trigger(EVENTS.TUNNEL_SET_TO_ACTIVE, tunnel, device, reason);
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
const setIncompleteRouteStatus = async (route, isIncomplete, reason, device) => {
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
  );

  if (isIncomplete) {
    await trigger(
      EVENTS.STATIC_ROUTE_SET_TO_PENDING, route, device, reason);
  }
};

/**
 * Set IP exists on the interface
 * @param  {number} deviceId device id
 * @param  {number} ifcId    interface id
 * @param  {boolean} hasIP  indicate if ip exists in the device side
 * @return void
 */
const setInterfaceHasIP = async (deviceId, ifcId, hasIP) => {
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

module.exports = {
  check,
  trigger,
  EVENTS
};
