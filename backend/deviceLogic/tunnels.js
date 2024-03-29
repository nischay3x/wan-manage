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

// Logic to apply tunnels between devices
const MAX_TUNNELS_PER_DEVICE = 8000;
const MAX_TUNNELS_PER_ORG = 32000;

const configs = require('../configs')();
const orgModel = require('../models/organizations');
const tunnelsModel = require('../models/tunnels');
const tunnelIDsModel = require('../models/tunnelids');
const devicesModel = require('../models/devices').devices;
const mongoose = require('mongoose');
const {
  generateTunnelParams,
  generateRandomKeys,
  getTunnelsPipeline
} = require('../utils/tunnelUtils');
const { validateIKEv2 } = require('./IKEv2');
const { pendingTypes, getReason } = require('./events/eventReasons');
const publicAddrInfoLimiter = require('./publicAddressLimiter');
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);
const { routerVersionsCompatible, getMajorVersion, getMinorVersion } = require('../versioning');
const peersModel = require('../models/peers');
const logger = require('../logging/logging')({ module: module.filename, type: 'job' });
const keyBy = require('lodash/keyBy');
const globalTunnelMtu = configs.get('globalTunnelMtu', 'number');
const defaultTunnelOspfCost = configs.get('defaultTunnelOspfCost', 'number');
const tcpClampingHeaderSize = configs.get('tcpClampingHeaderSize', 'number');
const { transformBGP } = require('./jobParameters');
const organizations = require('../models/organizations');
const notificationsMgr = require('../notifications/notifications')();
const { validateOSPFArea } = require('../models/validators');

const intersectIfcLabels = (ifcLabelsA, ifcLabelsB) => {
  const intersection = [];
  ifcLabelsA.forEach(label => {
    if (label && ifcLabelsB.has(label)) intersection.push(label);
  });

  return intersection;
};

/**
 * This function handles create tunnels operations and returns an array of jobs.
 * @async
 * @param  {string}   org  organization ID
 * @param  {string}   user user id of the requesting user
 * @param  {array}    opDevices array of selected devices
 * @param  {array}    pathLabels array of selected path labels
 * @param  {Object}   advancedOptions advanced tunnel options: MTU, MSS Clamp, OSPF cost, routing
 * @param  {String}   topology topology of created tunnels (hubAndSpoke|fullMesh)
 * @param  {Number}   hubIdx index of the hub in 'Hub and Spoke' topology
 * @param  {set}      reasons reference to Set of reasons
 * @param  {Dictionary}   notificationsSettings an object of notification settings
 * @return {array}    A promises array of tunnels creations
 */
const handleTunnels = async (
  org, userName, opDevices, pathLabels,
  advancedOptions, topology, hubIdx, reasons, notificationsSettings = null
) => {
  const devicesLen = opDevices.length;
  const tasks = [];

  const { encryptionMethod } = await orgModel.findOne({ _id: org });
  // for now only 'none', 'ikev2' and 'psk' key exchange methods are supported
  if (!['none', 'ikev2', 'psk'].includes(encryptionMethod)) {
    logger.error('Tunnel creation failed',
      { params: { reason: 'Not supported key exchange method', encryptionMethod } }
    );
    throw new Error('Not supported key exchange method');
  }

  const devicesIds = opDevices.map(d => d._id);
  const existingTunnels = await tunnelsModel.find(
    {
      isActive: true,
      org: org,
      pathlabel: pathLabels.length > 0 ? { $ne: null } : { $eq: null },
      $or: [
        { deviceA: { $in: devicesIds } },
        { deviceB: { $in: devicesIds } }
      ]
    },
    {
      num: 1,
      deviceA: 1,
      deviceB: 1,
      interfaceB: 1,
      interfaceA: 1,
      pathlabel: 1
    }
  );

  const tunnelsPerDevice = {};
  const tunnelExists = {};
  existingTunnels.forEach(t => {
    tunnelsPerDevice[t.deviceA] = (tunnelsPerDevice[t.deviceA] ?? 0) + 1;
    if (t.deviceB) {
      tunnelsPerDevice[t.deviceB] = (tunnelsPerDevice[t.deviceB] ?? 0) + 1;
      // no need to search for existing tunnels with empty deviceB
      const tunnelKey = `${t.interfaceA}:${t.interfaceB}:${t.pathlabel ?? ''}`;
      tunnelExists[tunnelKey] = true;
    }
  });

  const isHubAndSpoke = (topology === 'hubAndSpoke');
  let aLoopStart = 0;
  let aLoopStop = devicesLen - 1;
  let bLoopStart = 0;
  if (isHubAndSpoke) {
    aLoopStart = hubIdx;
    aLoopStop = hubIdx + 1;
  }

  // Connecting tunnels done by double loop. The logic per topology is:
  // Hub and Spoke
  // - loopA: Hub index only
  // - loopB: All other selected devices (skipping hub)
  // Full mesh
  // - loopA: All indexes from 0 to Len(selected devices)-1
  // - loopB: From A index +1 to Len(selected devices)
  for (let idxA = aLoopStart; idxA < aLoopStop; idxA++) {
    if (!isHubAndSpoke) bLoopStart = idxA + 1; // Full-Mesh
    for (let idxB = bLoopStart; idxB < devicesLen; idxB++) {
      if (idxA === idxB) continue; // might happen in hubAndSpoke

      const deviceA = opDevices[idxA];
      const deviceB = opDevices[idxB];

      // Tunnels are supported only between devices of the same router version
      const [verA, verB] = [deviceA.versions.router, deviceB.versions.router];
      if (!routerVersionsCompatible(verA, verB)) {
        logger.warn('Tunnel creation failed', {
          params: { reason: 'Router version mismatch', versions: { verA: verA, verB: verB } }
        });
        reasons.add('Router version mismatch for some devices.');
        continue;
      }

      // only devices with version of agent >= 4
      // are supported for creating tunnels with none encryption method
      if (encryptionMethod === 'none') {
        let noneEncryptionValidated = true;
        for (const device of [deviceA, deviceB]) {
          const majorAgentVersion = getMajorVersion(device.versions.agent);
          if (majorAgentVersion < 4) {
            const reason = 'None encryption method not supported';
            logger.warn('Tunnel creation failed', {
              params: { reason, machineId: device.machineId }
            });
            reasons.add(`${reason} on some of devices.`);
            noneEncryptionValidated = false;
          }
        }
        if (!noneEncryptionValidated) {
          continue;
        }
      }

      // only devices with version of agent >= 4 and valid certificates
      // are supported for creating tunnels with IKEv2 key exchange method
      if (encryptionMethod === 'ikev2') {
        let ikev2Validated = true;
        for (const device of [deviceA, deviceB]) {
          const { valid, reason } = validateIKEv2(device);
          if (!valid) {
            logger.warn('Tunnel creation failed', {
              params: { reason, machineId: device.machineId }
            });
            reasons.add(`${reason} on some of devices.`);
            ikev2Validated = false;
          }
        }
        if (!ikev2Validated) {
          continue;
        }
      }

      // Create the list of interfaces for both devices.
      // Add a set of the interface's path labels
      const deviceAIntfs = getInterfacesWithPathLabels(deviceA);
      const deviceBIntfs = getInterfacesWithPathLabels(deviceB);

      const devicesInfo = {
        deviceA: { hostname: deviceA.hostname, interfaces: deviceAIntfs },
        deviceB: { hostname: deviceB.hostname, interfaces: deviceBIntfs }
      };
      logger.debug('Connecting tunnel between devices', { params: { devicesInfo } });

      // Create a tunnel between each WAN interface on device A to
      // each of the WAN interfaces on device B according to the path
      // labels assigned to the interfaces. If the list of path labels
      // IDs contains the ID 'FFFFFF', create tunnels between all common
      // path labels across all WAN interfaces.
      // TBD: key exchange should be dynamic
      const specifiedLabels = new Set(pathLabels);
      const createForAllLabels = specifiedLabels.has('FFFFFF');

      if (deviceAIntfs.length && deviceBIntfs.length) {
        // if need to add a message about the absence of common labels
        let isFoundInterfacesWithCommonLabels = false;

        for (let idxA = 0; idxA < deviceAIntfs.length; idxA++) {
          for (let idxB = 0; idxB < deviceBIntfs.length; idxB++) {
            const wanIfcA = deviceAIntfs[idxA];
            const wanIfcB = deviceBIntfs[idxB];
            const ifcALabels = wanIfcA.labelsSet;
            const ifcBLabels = wanIfcB.labelsSet;

            // If no path labels were selected, create a tunnel
            // only if both interfaces aren't assigned with labels
            if (specifiedLabels.size === 0) {
              // mark the bellow field as true since here we don't search for common interfaces
              isFoundInterfacesWithCommonLabels = true;

              if (ifcALabels.size === 0 && ifcBLabels.size === 0) {
                // If a tunnel already exists, skip the configuration
                const tunnelKey = `${wanIfcA._id}:${wanIfcB._id}:`;
                const tunnelKey2 = `${wanIfcB._id}:${wanIfcA._id}:`;
                if (tunnelExists[tunnelKey] || tunnelExists[tunnelKey2]) {
                  logger.debug('Found tunnel', { params: { tunnelKey } });
                  reasons.add('Some tunnels exist already.');
                } else if ((tunnelsPerDevice[deviceA._id] ?? 0) > MAX_TUNNELS_PER_DEVICE - 1) {
                  logger.warn('Exceeded limit of tunnels on device', { params: { deviceA } });
                  reasons.add(`Exceeded limit of ${MAX_TUNNELS_PER_DEVICE} tunnels per device.`);
                } else if ((tunnelsPerDevice[deviceB._id] ?? 0) > MAX_TUNNELS_PER_DEVICE - 1) {
                  logger.warn('Exceeded limit of tunnels on device', { params: { deviceB } });
                  reasons.add(`Exceeded limit of ${MAX_TUNNELS_PER_DEVICE} tunnels per device.`);
                } else {
                  tunnelsPerDevice[deviceA._id] = (tunnelsPerDevice[deviceA._id] ?? 0) + 1;
                  tunnelsPerDevice[deviceB._id] = (tunnelsPerDevice[deviceB._id] ?? 0) + 1;
                  tasks.push(generateTunnelPromise(userName, org, null,
                    { ...deviceA.toObject() }, { ...deviceB.toObject() },
                    { ...wanIfcA }, { ...wanIfcB }, encryptionMethod, advancedOptions,
                    null, notificationsSettings));
                }
              } else {
                reasons.add(
                  'No Path Labels specified but some devices have interfaces with Path Labels.'
                );
              }
            } else {
              // Create a list of path labels that are common to both interfaces.
              const labelsIntersection = intersectIfcLabels(ifcALabels, ifcBLabels);
              for (const label of labelsIntersection) {
                // Skip tunnel if the label is not included in
                // the list of labels specified by the user
                const shouldSkipTunnel = !createForAllLabels && !specifiedLabels.has(label);
                if (shouldSkipTunnel) {
                  continue;
                } else {
                  isFoundInterfacesWithCommonLabels = true;
                }
                // If a tunnel already exists, skip the configuration
                const tunnelKey = `${wanIfcA._id}:${wanIfcB._id}:${label}`;
                const tunnelKey2 = `${wanIfcB._id}:${wanIfcA._id}:${label}`;
                if (tunnelExists[tunnelKey] || tunnelExists[tunnelKey2]) {
                  logger.debug('Found tunnel', { params: { tunnelKey } });
                  reasons.add('Some tunnels exist already.');
                  continue;
                } else if ((tunnelsPerDevice[deviceA._id] ?? 0) > MAX_TUNNELS_PER_DEVICE - 1) {
                  logger.warn('Exceeded limit of tunnels on device', { params: { deviceA } });
                  reasons.add(`Exceeded limit of ${MAX_TUNNELS_PER_DEVICE} tunnels per device.`);
                  continue;
                } else if ((tunnelsPerDevice[deviceB._id] ?? 0) > MAX_TUNNELS_PER_DEVICE - 1) {
                  logger.warn('Exceeded limit of tunnels on device', { params: { deviceB } });
                  reasons.add(`Exceeded limit of ${MAX_TUNNELS_PER_DEVICE} tunnels per device.`);
                  continue;
                }
                tunnelsPerDevice[deviceA._id] = (tunnelsPerDevice[deviceA._id] ?? 0) + 1;
                tunnelsPerDevice[deviceB._id] = (tunnelsPerDevice[deviceB._id] ?? 0) + 1;
                // Use a copy of devices objects as promise runs later
                tasks.push(generateTunnelPromise(userName, org, label,
                  { ...deviceA.toObject() }, { ...deviceB.toObject() },
                  { ...wanIfcA }, { ...wanIfcB }, encryptionMethod, advancedOptions,
                  null, notificationsSettings));
              }
            }
          };
        };

        if (!isFoundInterfacesWithCommonLabels) {
          reasons.add('Some devices have interfaces without specified Path Labels.');
        }
      } else {
        logger.info('Failed to connect tunnel between devices', {
          params: {
            deviceA: deviceA.hostname,
            deviceB: deviceB.hostname,
            reason: 'no valid WAN interfaces'
          }
        });
        reasons.add('Some devices have no valid WAN interfaces.');
      }
    }
  }

  return tasks;
};

/**
 * This function handles create peers operations and returns an array of jobs.
 * @async
 * @param  {string}   org  organization ID
 * @param  {string}   user user id of the requesting user
 * @param  {array}    opDevices array of selected devices
 * @param  {array}    pathLabels array of selected path labels
 * @param  {Object}   advancedOptions advanced tunnel options: MTU, MSS Clamp, OSPF cost, routing
 * @param  {array}    peersIds array of peers ids
 * @param  {set}      reasons reference to Set of reasons
 * @return {array}    A promises array of tunnels creations
 */
const handlePeers = async (
  org, userName, opDevices, pathLabels, advancedOptions, peersIds, reasons
) => {
  const tasks = [];

  // get peers configurations
  const peers = await peersModel.find({ _id: { $in: peersIds }, org: org }).lean();

  const existingPeers = await tunnelsModel.find(
    {
      isActive: true,
      org: org,
      peer: { $in: peersIds }
    },
    {
      num: 1,
      interfaceA: 1,
      deviceA: 1,
      peer: 1,
      pathlabel: 1
    }
  );
  const getDevicePeerKey = (deviceId, peerId) => `${deviceId}_${peerId}`;
  const existingDevicePeersMap = keyBy(existingPeers, p => getDevicePeerKey(p.deviceA, p.peer));

  for (const device of opDevices) {
    // peer is supported for major version 5
    const majorAgentVersion = getMajorVersion(device.versions.agent);
    if (majorAgentVersion < 5) {
      reasons.add('Selected devices do not run required flexiWAN version for peering. ' +
        'Please upgrade and try again');
      continue;
    };

    // Create the list of interfaces for the device.
    // Add a set of the interface's path labels
    const deviceIntfs = getInterfacesWithPathLabels(device);
    logger.debug('Peer device info', { params: { deviceIntfs } });

    if (deviceIntfs.length === 0) {
      logger.info('Failed to create peer for device', {
        params: {
          device: device.hostname,
          reason: 'no valid WAN interfaces'
        }
      });
      reasons.add('Some devices have no valid WAN interfaces.');
      continue;
    }

    const peersSrcDst = await getPeersSrcDst(org);
    const srcDstKeys = keyBy(peersSrcDst, 'key');

    // Create a peer for each WAN interface of the device according to the path
    // labels assigned to the interfaces. If the list of path labels
    // IDs contains the ID 'FFFFFF', create peers between all common
    // path labels across all WAN interfaces.
    const specifiedLabels = new Set(pathLabels);
    const createForAllLabels = specifiedLabels.has('FFFFFF');
    let isFoundInterfacesWithSpecifiedLabels = false;
    for (const wanIfc of deviceIntfs) {
      const ifcLabels = wanIfc.labelsSet;

      // If no path labels were specified by user,
      // but interface has path labels, we don't create for peer for this interface.
      if (specifiedLabels.size === 0) {
        // if no pat label specified - mark it as true since we don't search for pathlabels
        isFoundInterfacesWithSpecifiedLabels = true;

        // If the WAN interface has path labels, we skip the creation for this interface
        if (ifcLabels.size > 0) {
          const reason =
            `Paths labels were not specified -
            The system didn't configure interfaces with path labels.`;
          logger.info('Skip creation peer for interface', {
            params: { device: device.hostname, interface: wanIfc.name, reason }
          });
          reasons.add(reason);
          continue;
        }

        // Create peer configuration for the interface
        for (const peer of peers) {
          // each peer can be installed once in a device.
          const devicePeerKey = getDevicePeerKey(device._id, peer._id);
          if (devicePeerKey in existingDevicePeersMap) {
            logger.debug('Found same peer in the device', { params: { peer: peer } });
            reasons.add(`A peer tunnel with the selected profile (${peer.name}) \
            already exists in the selected devices (${device.name}). `);
            continue;
          }

          const srcDst = `${wanIfc.IPv4}_${peer.remoteIP}`;
          if (srcDst in srcDstKeys) {
            reasons.add('Some peer tunnels with same source and destination IP already exists. ');
            continue;
          }

          // generate peer configuration job
          const promise = generateTunnelPromise(userName, org, null, device,
            null, wanIfc, null, 'ikev2', advancedOptions, peer);
          tasks.push(promise);
        }
      } else {
        // If interface has more than one path label, we can't create peer for each one
        if (ifcLabels.size > 1) {
          let allLabelsSelected = createForAllLabels;
          if (!allLabelsSelected) {
            allLabelsSelected = ifcLabels.size === specifiedLabels.size;
          }

          if (allLabelsSelected) {
            logger.debug('Interface has more than one path label.',
              {
                params: {
                  ifcLabels,
                  wanIfc
                }
              });
            reasons.add('The system skipped interfaces that have multiple path labels.');
            continue;
          }
        }

        for (const label of ifcLabels) {
          const shouldSkipPeer = !createForAllLabels && !specifiedLabels.has(label);
          if (shouldSkipPeer) {
            continue;
          } else {
            isFoundInterfacesWithSpecifiedLabels = true;
          }

          for (const peer of peers) {
            // each peer can be installed once in a device.
            const devicePeerKey = getDevicePeerKey(device._id, peer._id);
            if (devicePeerKey in existingDevicePeersMap) {
              logger.debug('Found same peer in the device', { params: { peer: peer } });
              reasons.add(`A peer tunnel with the selected profile (${peer.name}) \
              already exists in the selected device (${device.name}). `);
              continue;
            }

            const srcDst = `${wanIfc.IPv4}_${peer.remoteIP}`;
            if (srcDst in srcDstKeys) {
              reasons.add('Some peer tunnels with same source and destination IP already exists. ');
              continue;
            }

            // generate peer configuration job
            const promise = generateTunnelPromise(
              userName, org, label, device, null, wanIfc, null, 'ikev2', advancedOptions, peer
            );
            tasks.push(promise);
          }
        }
      }
    }
    if (!isFoundInterfacesWithSpecifiedLabels) {
      reasons.add('Some devices have interfaces without specified Path Labels.');
    }
  }

  return tasks;
};

/**
 * Get peer tunnels with the given src ip and destination ip
 * @async
 * @param  {string}   org  organization ID
 * @param  {string}   interfaceIp interface IP, used as source ip of a tunnel
 * @param  {array}    peerRemoteIp peer remote IP, used as remote ip of a peer tunnel
 * @return {array}    array of peer tunnels with the given src and destination ip
 */
const getPeersSrcDst = async (org) => {
  try {
    const pipeline = [
      // get active peers for the given organization
      { $match: { org: mongoose.Types.ObjectId(org), peer: { $ne: null }, isActive: true } },
      { $project: { deviceA: 1, interfaceA: 1, peer: 1, _id: 0 } },
      // get interface object used by the tunnel
      {
        $lookup: {
          from: 'devices',
          let: { deviceId: '$deviceA', ifc_id: '$interfaceA' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$deviceId'] } } },
            { $project: { interfaces: 1 } },
            { $unwind: '$interfaces' },
            { $match: { $expr: { $eq: ['$interfaces._id', '$$ifc_id'] } } },
            { $project: { _id: 0, src: '$interfaces.IPv4' } }
          ],
          as: 'interface'
        }
      },
      // get peer object used by the tunnel
      { $lookup: { from: 'peers', localField: 'peer', foreignField: '_id', as: 'peer' } },
      { $unwind: '$peer' },
      { $unwind: '$interface' },
      { $project: { _id: 0, key: { $concat: ['$interface.src', '_', '$peer.remoteIP'] } } }
      // check if the given src and dst combination is already in use by a peer in this organization
      // { $match: { src: interfaceIp, dst: peerRemoteIp } }
    ];

    const res = await tunnelsModel.aggregate(pipeline).allowDiskUse(true);
    return res;
  } catch (err) {
    logger.error('Failed to check for duplication src and dst ips', {
      params: { org, err: err.message }
    });
    throw err;
  }
};

/**
 * This function is called when adding new tunnels
 * @async
 * @param  {Array}    devices   an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const applyTunnelAdd = async (devices, user, data) => {
  /**
     * Request body holds the list of devices ids to connect tunnel between
     */
  const selectedDevices = data.devices;
  const startedAt = Date.now();
  logger.info('Creating tunnels between devices', {
    params: { devices: selectedDevices }
  });
  devices = await Promise.all(devices.map(d => d
    .populate('interfaces.pathlabels', '_id name type')
    .execPopulate()
  ));

  // Get details for devices to connect
  const opDevices = (devices && selectedDevices)
    ? devices.filter((device) => {
      const inSelected = selectedDevices.hasOwnProperty(device._id);
      if (inSelected) return true;
      else return false;
    }) : [];

  const isPeer = data.meta.tunnelType === 'peer';
  if (isPeer &&
    (!data.meta.peers || !Array.isArray(data.meta.peers) || data.meta.peers.length === 0)
  ) {
    throw new Error('Peers identifiers were not specified');
  }

  // For a site-to-site tunnel we only allow more than two devices
  if (!isPeer && opDevices.length < 2) {
    logger.error('At least 2 devices must be selected to create tunnels', { params: {} });
    throw new Error('At least 2 devices must be selected to create tunnels');
  }

  const {
    pathLabels, advancedOptions,
    peers, topology, hub, notificationsSettings = null
  } = data.meta;
  if (notificationsSettings) {
    for (const eventType in Object.keys(notificationsSettings)) {
      const { warningThreshold, criticalThreshold } = notificationsSettings[eventType];
      if (warningThreshold !== undefined && criticalThreshold !== undefined &&
        (isNaN(warningThreshold) || isNaN(criticalThreshold) ||
        warningThreshold >= criticalThreshold || warningThreshold < 1 || criticalThreshold < 1)) {
        logger.error('Wrong threshold value when creating tunnels',
          { params: notificationsSettings[eventType] });
        throw new Error(
          // eslint-disable-next-line max-len
          'Please ensure that the notification thresholds are defined as positive values and that the warning threshold is kept smaller than the critical threshold.');
      }
      switch (eventType) {
        case 'Link/Tunnel round trip time':
          if (warningThreshold > 30000 || criticalThreshold > 30000) {
            logger.error('Wrong threshold value when creating tunnels',
              { params: notificationsSettings[eventType] });
            throw new Error(
            // eslint-disable-next-line max-len
              'RTT thresholds must be between 1ms to 30 seconds');
          }
          break;
        case 'Link/Tunnel default drop rate':
          if (warningThreshold > 100 || criticalThreshold > 100) {
            logger.error('Wrong threshold value when creating tunnels',
              { params: notificationsSettings[eventType] });
            throw new Error(
            // eslint-disable-next-line max-len
              'Drop rate thresholds must be between 1 to 100(%)');
          }
          break;
      }
    }
  }
  // If ospfCost is not defined, use the default cost
  advancedOptions.ospfCost = Number(advancedOptions.ospfCost || defaultTunnelOspfCost);
  const { mtu, mssClamp, ospfCost, ospfArea, routing } = advancedOptions || {};

  if (mtu !== undefined && mtu !== '' && (isNaN(mtu) || mtu < 500 || mtu > 1500)) {
    logger.error('Wrong MTU value when creating tunnels', { params: { mtu } });
    throw new Error('MTU value must be between 500 and 1500');
  }

  if (mssClamp && !['yes', 'no'].includes(mssClamp)) {
    logger.error('Wrong MSS Clamping when creating tunnels', { params: { mssClamp } });
    throw new Error('MSS Clamping must be "yes" or "no"');
  }

  if (isNaN(ospfCost) || ospfCost <= 0) {
    logger.error('Wrong OSPF cost when creating tunnels', { params: { ospfCost } });
    throw new Error('OSPF cost must be a positive numeric value or empty');
  }

  if (ospfArea && !validateOSPFArea(ospfArea)) {
    logger.error('Wrong OSPF area when creating tunnels', { params: { ospfArea } });
    throw new Error('OSPF area must be a valid area');
  }

  if (topology !== 'hubAndSpoke' && topology !== 'fullMesh') {
    logger.error('Unknown topology when creating tunnels', { params: { topology: topology } });
    throw new Error('Unknown topology when creating tunnels');
  }
  let hubIdx = -1;
  if (topology === 'hubAndSpoke') {
    if (!hub || hub === '') {
      logger.error('Hub must be specified for hub and spoke topology', { params: { hub: hub } });
      throw new Error('Hub must be specified for hub and spoke topology');
    }
    hubIdx = opDevices.findIndex((d) => d._id.toString() === hub);
    if (hubIdx === -1) {
      logger.error('Hub device not found', { params: { hub: hub } });
      throw new Error('Hub device not found');
    }
  }

  if (routing === 'bgp') {
    const bothInstalledBGP = devices.every(d => d.bgp.enable === true);
    if (!bothInstalledBGP) {
      throw new Error('BGP is not enabled on all selected devices');
    }
  }

  let dbTasks = [];
  const userName = user.username;
  const org = data.org;

  // array of common reasons of not created tunnels for some devices
  // used to build a response message
  const reasons = new Set(); // unique messages array

  if (isPeer) {
    const tasks = await handlePeers(
      org, userName, opDevices, pathLabels, advancedOptions, peers, reasons);
    dbTasks = dbTasks.concat(tasks);
  } else {
    const tasks = await handleTunnels(
      org, userName, opDevices, pathLabels, advancedOptions,
      topology, hubIdx, reasons, notificationsSettings);
    dbTasks = dbTasks.concat(tasks);
  }

  if (dbTasks.length > 1000) {
    Promise.allSettled(dbTasks).then(promiseStatus => {
      let failed = 0;
      promiseStatus.forEach(elem => {
        if (elem.status !== 'fulfilled') {
          failed++;
          logger.error('Add tunnel error',
            { params: { error: elem.reason.message } }
          );
        };
      });
      const completed = dbTasks.length - failed;
      logger.debug('Add tunnels operation finished',
        { params: { completed, failed, durationMs: Date.now() - startedAt } }
      );
    });
    logger.debug('Adding more than 1000 jobs in progress', { params: { tunnels: dbTasks.length } });
    let message = 'Adding more than 1000 jobs in progress, check the result on the Jobs page.';
    if (reasons.size > 0) {
      message = `${message} ${Array.from(reasons).join(' ')}`;
    }
    return { ids: [], status: 'unknown', message };
  }

  // Execute all promises
  logger.debug('Running tunnel promises', { params: { tunnels: dbTasks.length } });

  const promiseStatus = await Promise.allSettled(dbTasks);
  const fulfilled = promiseStatus.reduce((arr, elem) => {
    if (elem.status === 'fulfilled') {
      const job = elem.value;
      arr.push(job);
    } else {
      reasons.add(elem.reason.message);
    };
    return arr;
  }, []);

  const status = fulfilled.length < dbTasks.length
    ? 'partially completed' : 'completed';

  const desired = dbTasks.flat().map(job => job.id);
  const ids = fulfilled.flat().map(job => job.id);
  let message = `${isPeer ? 'peer ' : ''}tunnel creation jobs added.`;
  if (desired.length === 0 || fulfilled.flat().length === 0) {
    message = 'No ' + message;
  } else if (ids.length < desired.length) {
    message = `${ids.length} of ${desired.length} ${message}`;
  } else {
    message = `${ids.length} ${message}`;
  }
  if (reasons.size > 0) {
    message = `${message} ${Array.from(reasons).join(' ')}`;
  }
  return { ids, status, message };
};

/**
 * Complete tunnel add, called for each of the
 * devices that are connected by the tunnel.
 * @param  {number} jobId Kue job ID
 * @param  {Object} res   including the deviceA id, deviceB id, deviceSideConf
 * @return {void}
 */
const completeTunnelAdd = (jobId, res) => {
  if (!res || !res.tunnelId || !res.target || !res.username || !res.org) {
    logger.warn('Got an invalid job result', { params: { result: res, jobId: jobId } });
    return;
  }

  updateTunnelIsConnected(tunnelsModel, res.org,
    res.tunnelId, res.target, true)(null, (err, res) => {
    if (err) {
      logger.error('Update tunnel connectivity failed', {
        params: { jobId: jobId, reason: err.message }
      });
    }
  }
  );
};

/**
 * Complete handler for sync job
 * @return void
 */
const completeSync = async (jobId, jobsData) => {
  try {
    for (const data of jobsData) {
      await completeTunnelAdd(jobId, data);
    }
  } catch (err) {
    logger.error('Tunnels sync complete callback failed', {
      params: { jobsData, reason: err.message }
    });
  }
};

/**
 * Error tunnel add, called for each of the
 * devices that are connected by the tunnel.
 * @param  {number} jobId Kue job ID
 * @param  {Object} res   including the deviceA id, deviceB id, deviceSideConf
 * @return {void}
 */
const errorTunnelAdd = async (jobId, res) => {
  logger.info('Tunnel add error.',
    { params: { result: res, jobId: jobId } });
  if (!res || !res.deviceA || !res.deviceB || !res.target || !res.username || !res.org) {
    logger.warn('Got an invalid job result', { params: { result: res, jobId: jobId } });
  }
};

/**
 * This function generates one tunnel promise including
 * all configurations for the tunnel into the device
 * @param  {string}   user         user id of the requesting user
 * @param  {string}   org          organization id the user belongs to
 * @param  {string}   pathLabel    path label
 * @param  {Object}   deviceA      device A details
 * @param  {Object?}  deviceB      device B details
 * @param  {Object}   deviceAIntf  device A tunnel interface
 * @param  {Object?}  deviceBIntf  device B tunnel interface
 * @param  {string}   encryptionMethod key exchange method [none|ikev2|psk]
 * @param  {Object}   advancedOptions advanced tunnel options: MTU, MSS Clamp, OSPF cost, routing
 * @param  {boolean}  peer         peer configurations
 */
const generateTunnelPromise = async (user, org, pathLabel, deviceA, deviceB,
  deviceAIntf, deviceBIntf, encryptionMethod, advancedOptions, peer = null,
  notificationsSettings = null) => {
  logger.debug(`Adding tunnel${peer ? '' : ' between devices'}`, {
    params: {
      deviceA: deviceA.hostname,
      deviceB: peer ? null : deviceB.hostname,
      interfaces: {
        interfaceA: deviceAIntf.name,
        interfaceB: peer ? null : deviceBIntf.name
      },
      label: pathLabel,
      encryptionMethod: encryptionMethod,
      peer,
      notificationsSettings
    }
  });
  let tunnelnum = null;
  try {
    // Check if tunnel can be created
    // Get a unique tunnel number
    // Search first in deleted tunnels
    const tunnelResp = await tunnelsModel.findOneAndUpdate(
      // Query
      { isActive: false, org: org },
      // Update, make sure other query doesn't find the same number
      { isActive: true },
      // Options
      { upsert: false }
    );
    if (tunnelResp !== null) { // deleted tunnel found, use it
      tunnelnum = tunnelResp.num;
      logger.debug('Adding tunnel from deleted tunnel', { params: { tunnel: tunnelnum } });
    } else {
      try {
        const idResp = await tunnelIDsModel.findOneAndUpdate(
          // Query, allow only MAX_TUNNELS_PER_ORG tunnels per organization
          {
            org: org,
            nextAvailID: { $gte: 0, $lt: MAX_TUNNELS_PER_ORG }
          },
          // Update
          { $inc: { nextAvailID: 1 } },
          // Options
          { new: true, upsert: true }
        );
        if (!idResp || !idResp.nextAvailID) {
          throw new Error('Failed to get a new tunnel number');
        }
        tunnelnum = idResp.nextAvailID;
        logger.info('Adding tunnel with new ID', { params: { tunnel: tunnelnum } });
      } catch (err) {
        // org is a key value in the collection, upsert sometimes creates a new doc
        // (if two upserts done at once)
        // In this case we need to check the error and try again if such occurred
        // See more info in:
        // eslint-disable-next-line max-len
        // https://stackoverflow.com/questions/37295648/mongoose-duplicate-key-error-with-upsert
        if (err.code === 11000) {
          logger.debug('2nd try to find tunnel ID', { params: {} });
          const idResp = tunnelIDsModel.findOneAndUpdate(
            // Query, allow only MAX_TUNNELS_PER_ORG tunnels per organization
            {
              org: org,
              nextAvailID: { $gte: 0, $lt: MAX_TUNNELS_PER_ORG }
            },
            // Update
            { $inc: { nextAvailID: 1 } },
            // Options
            { new: true, upsert: true }
          );
          if (!idResp || !idResp.nextAvailID) {
            throw new Error('Failed to get a new tunnel number');
          }
          tunnelnum = idResp.nextAvailID;
          logger.debug('Adding tunnel with new ID', { params: { tunnel: tunnelnum } });
        } else {
          throw new Error('Failed to get a new tunnel number: ' + err.message);
        }
      }
    }
    if (tunnelnum === null) {
      throw new Error('Failed to get a new tunnel number');
    }
    const tunnelJobs = await addTunnel(user, org, tunnelnum, encryptionMethod,
      deviceA, deviceB, deviceAIntf, deviceBIntf, pathLabel,
      advancedOptions, peer, notificationsSettings);
    return tunnelJobs;
  } catch (err) {
    // there can be an exception in the addTunnel function
    // we need to set tunnel as inactive in case of not pending
    if (tunnelnum !== null && !err.message.includes('pending')) {
      try {
        await tunnelsModel.findOneAndUpdate(
          { num: tunnelnum, isActive: true, org: org },
          { isActive: false },
          { upsert: false }
        );
      } catch (error) {
        logger.error('Failed to deactivate tunnel', {
          params: { tunnelnum, error: error.message }
        });
      }
    }
    logger.error('Failed to add tunnel', {
      params: { tunnelnum, error: err.message }
    });
    throw new Error(err.message);
  }
};

/**
 * Queues the tunnel creation/deletion jobs to both
 * of the devices that are connected via the tunnel
 * @param  {boolean} isAdd        a flag indicating creation/deletion
 * @param  {string} title         title of the task
 * @param  {Object} tasksDeviceA  device A tunnel job
 * @param  {Object} tasksDeviceB  device B tunnel job
 * @param  {string} user          user id of the requesting user
 * @param  {string} orgId           user's organization id
 * @param  {string} devAMachineID device A host id
 * @param  {string?} devBMachineID device B host id
 * @param  {string} devAOid       device A database mongodb object id
 * @param  {string?} devBOid      device B database mongodb object id
 * @param  {string} tunnelId      tunnel number
 * @param  {string} pathLabel     pathLabel
 * @param  {object?} peer         peer configurations
 * @return {void}
 */
const queueTunnel = async (
  isAdd,
  title,
  tasksDeviceA,
  tasksDeviceB,
  user,
  orgId,
  devAMachineID,
  devBMachineID,
  devAOid,
  devBOid,
  tunnelId,
  pathLabel,
  peer = null
) => {
  try {
    const devices = { deviceA: devAOid, deviceB: devBOid };
    const jobA = await deviceQueues.addJob(
      devAMachineID,
      user,
      orgId,
      // Data
      {
        title: title,
        tasks: tasksDeviceA
      },
      // Response data
      {
        method: isAdd ? 'tunnels' : 'deltunnels',
        data: {
          username: user,
          org: orgId,
          tunnelId: tunnelId,
          deviceA: devAOid,
          deviceB: devBOid,
          pathlabel: pathLabel,
          target: 'deviceAconf',
          peer
        }
      },
      // Metadata
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      // Complete callback
      null
    );

    logger.info(`${isAdd ? 'Add' : 'Del'} tunnel job queued - deviceA`, {
      params: { devices: devices },
      job: jobA
    });

    const jobB = peer ? null : await deviceQueues.addJob(
      devBMachineID,
      user,
      orgId,
      // Data
      {
        title: title,
        tasks: tasksDeviceB
      },
      // Response data
      {
        method: isAdd ? 'tunnels' : 'deltunnels',
        data: {
          username: user,
          org: orgId,
          tunnelId: tunnelId,
          deviceA: devAOid,
          deviceB: devBOid,
          pathlabel: pathLabel,
          target: 'deviceBconf'
        }
      },
      // Metadata
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      // Complete callback
      null
    );

    logger.info(`${isAdd ? 'Add' : 'Del'} tunnel job queued - deviceB`, {
      params: { devices: devices },
      job: jobB
    });

    const res = [jobA];
    if (jobB) res.push(jobB);
    return res;
  } catch (err) {
    logger.error('Error queuing tunnel', {
      params: { deviceAId: devAMachineID, deviceBId: devBMachineID, message: err.message }
    });
    if (peer) {
      throw new Error(
        `Error queuing peer tunnel for device ID ${devAMachineID} and peer ${peer.name}`);
    } else {
      throw new Error(`Error queuing tunnel for device IDs ${devAMachineID} and ${devBMachineID}`);
    }
  }
};

/**
 * Prepares tunnel add jobs by creating an array that contains
 * the jobs that should be queued for each of the devices connected
 * by the tunnel.
 * @param  {object} tunnel    tunnel object
 * @param  {object} org       organization object
 * @param  {boolean} includeDeviceConfigDependencies tunnel dependencies (routes via the tunnel)
 * @param  {boolean} isSync  if "sync" module called to this function
 * @return {[{entity: string, message: string, params: Object}]} an array of tunnel-add jobs
 */
const prepareTunnelAddJob = async (
  tunnel, org, includeDeviceConfigDependencies = false, isSync = false
) => {
  // Extract tunnel keys from the database
  if (!tunnel) throw new Error('Tunnel not found');

  const { deviceA, deviceB, peer, pathlabel, advancedOptions } = tunnel;

  let deviceAIntf = null;
  let deviceBIntf = null;

  // populate interfaces only if needed. Sometimes they are already populated.
  if (mongoose.Types.ObjectId.isValid(tunnel.interfaceA)) {
    deviceAIntf = deviceA.interfaces.find(ifc => {
      return ifc._id.toString() === tunnel.interfaceA.toString();
    });
  } else {
    deviceAIntf = tunnel.interfaceA;
  }

  if (!peer && mongoose.Types.ObjectId.isValid(tunnel.interfaceB)) {
    deviceBIntf = deviceB.interfaces.find(ifc => {
      return ifc._id.toString() === tunnel.interfaceB.toString();
    });
  } else if (!peer) {
    deviceBIntf = tunnel.interfaceB;
  }

  const tasksDeviceA = [];
  const tasksDeviceB = [];

  const {
    paramsDeviceA,
    paramsDeviceB,
    tunnelParams
  } = prepareTunnelParams(
    tunnel,
    deviceAIntf,
    deviceBIntf,
    deviceA,
    deviceB,
    org,
    pathlabel,
    advancedOptions,
    peer
  );

  const validateParams = [paramsDeviceA];
  if (!peer) validateParams.push(paramsDeviceB);
  validateParams.forEach(({ src, dst, dstPort }, idx) => {
    if (!src) {
      throw new Error('Source IP address is empty');
    }
    if (!dst) {
      throw new Error('Destination IP address is empty');
    }
    if (!dstPort && !peer) {
      throw new Error('Destination port is empty');
    }
  });

  if (tunnel.encryptionMethod === 'ikev2') {
    if (peer) {
      let localDeviceId = peer.localId;
      if (localDeviceId === 'Automatic' && peer.idType === 'ip4-addr') {
        if (deviceAIntf.PublicIP) {
          localDeviceId = deviceAIntf.PublicIP;
        } else if (deviceAIntf.IPv4) {
          localDeviceId = deviceAIntf.IPv4;
        } else {
          // this error should not be raised as tunnel should be pending if no IPv4 address.
          throw new Error('There is no IP on interface to use as peer local ID');
        }
      }

      // construct IKEv2 tunnel
      paramsDeviceA.ikev2 = {
        role: 'initiator',
        mode: 'psk',
        psk: peer.psk,
        'local-device-id-type': peer.idType === 'email' ? 'rfc822' : peer.idType,
        'local-device-id': localDeviceId,
        'remote-device-id-type': peer.remoteIdType === 'email' ? 'rfc822' : peer.remoteIdType,
        'remote-device-id': peer.remoteId,
        lifetime: parseInt(peer.sessionLifeTime),
        ike_lifetime: parseInt(peer.ikeLifeTime),
        pfs: peer.pfs ?? false,
        ike: {
          'crypto-alg': peer.ikeCryptoAlg,
          'integ-alg': peer.ikeIntegAlg,
          'dh-group': peer.ikeDhGroup,
          'key-size': parseInt(peer.ikeKeySize)
        },
        esp: {
          'crypto-alg': peer.espCryptoAlg,
          'integ-alg': peer.espIntegAlg,
          // 'dh-group': peer.espDhGroup,
          'dh-group': '', // NOTE - NOT IN USE BY AGENT
          'key-size': parseInt(peer.espKeySize)
        },
        'local-ts': {
          protocol: peer.localProtocol,
          'start-port': peer.localPortRangeStart,
          'end-port': peer.localPortRangeEnd,
          'start-addr': peer.localIpRangeStart,
          'end-addr': peer.localIpRangeEnd
        },
        'remote-ts': {
          protocol: peer.remoteProtocol,
          'start-port': peer.remotePortRangeStart,
          'end-port': peer.remotePortRangeEnd,
          'start-addr': peer.remoteIpRangeStart,
          'end-addr': peer.remoteIpRangeEnd
        }
      };
    } else {
      const isSupportPfs = versions => {
        const majorVersion = getMajorVersion(versions);
        const minorVersion = getMinorVersion(versions);
        return majorVersion > 6 || (majorVersion === 6 && minorVersion >= 3);
      };

      let pfs = false;
      let lifetime = 3600; // phase 2
      let ikeLifetime = 0; // phase 1

      // Only if both devices support, if can be true.
      if (isSupportPfs(deviceA.versions.agent) && isSupportPfs(deviceB.versions.agent)) {
        lifetime = configs.get('ikev2Lifetime', 'number'); // phase 2
        ikeLifetime = configs.get('ikev2LifetimePhase1', 'number'); // phase 1
        pfs = configs.get('ikev2Pfs', 'boolean');
      }

      // construct IKEv2 tunnel
      paramsDeviceA.ikev2 = {
        role: 'initiator',
        'remote-device-id': deviceB.machineId,
        lifetime: lifetime, // phase 2
        ike_lifetime: ikeLifetime, // phase 1
        pfs: pfs,
        ike: {
          'crypto-alg': 'aes-cbc',
          'integ-alg': 'hmac-sha2-256-128',
          'dh-group': 'modp-2048',
          'key-size': 256
        },
        esp: {
          'crypto-alg': 'aes-cbc',
          'integ-alg': 'hmac-sha2-256-128',
          'dh-group': 'ecp-256',
          'key-size': 256
        },
        certificate: deviceB.IKEv2.certificate
      };

      paramsDeviceB.ikev2 = {
        role: 'responder',
        'remote-device-id': deviceA.machineId,
        certificate: deviceA.IKEv2.certificate
      };
    }
  } else if (tunnel.encryptionMethod === 'psk') {
    // construct static ipsec tunnel
    if (!tunnel.tunnelKeys) {
      // Generate new IPsec Keys and store them in the database
      const { key1, key2, key3, key4 } = generateRandomKeys();
      try {
        await tunnelsModel.findOneAndUpdate(
          { _id: tunnel._id },
          { tunnelKeys: { key1, key2, key3, key4 } },
          { upsert: false }
        );
        tunnel.tunnelKeys = { key1, key2, key3, key4 };
        logger.warn('New tunnel keys generated', {
          params: { tunnelId: tunnel._id }
        });
      } catch (err) {
        logger.error('Failed to set new tunnel keys', {
          params: { tunnelId: tunnel._id, err: err.message }
        });
      }
    }
    const tunnelKeys = {
      key1: tunnel.tunnelKeys.key1,
      key2: tunnel.tunnelKeys.key2,
      key3: tunnel.tunnelKeys.key3,
      key4: tunnel.tunnelKeys.key4
    };

    const paramsIpsecDeviceA = {};
    const paramsIpsecDeviceB = {};
    const paramsSaAB = {
      spi: tunnelParams.sa1,
      'crypto-key': tunnelKeys.key1,
      'integr-key': tunnelKeys.key2,
      'crypto-alg': 'aes-cbc-128',
      'integr-alg': 'sha-256-128'
    };
    const paramsSaBA = {
      spi: tunnelParams.sa2,
      'crypto-key': tunnelKeys.key3,
      'integr-key': tunnelKeys.key4,
      'crypto-alg': 'aes-cbc-128',
      'integr-alg': 'sha-256-128'
    };
    paramsIpsecDeviceA['local-sa'] = paramsSaAB;
    paramsIpsecDeviceA['remote-sa'] = paramsSaBA;
    paramsDeviceA.ipsec = paramsIpsecDeviceA;

    const majorAgentBVersion = getMajorVersion(deviceB.versions.agent);

    if (majorAgentBVersion < 4) { // version 1-3.X.X
      // The following looks as a wrong config in vpp 19.01 ipsec-gre interface,
      // spi isn't configured properly for SA
      paramsIpsecDeviceB['local-sa'] = { ...paramsSaAB, spi: tunnelParams.sa2 };
      paramsIpsecDeviceB['remote-sa'] = { ...paramsSaBA, spi: tunnelParams.sa1 };
    } else if (majorAgentBVersion >= 4) { // version 4.X.X+
      paramsIpsecDeviceB['local-sa'] = { ...paramsSaBA };
      paramsIpsecDeviceB['remote-sa'] = { ...paramsSaAB };
    }
    paramsDeviceB.ipsec = paramsIpsecDeviceB;
  }

  if (includeDeviceConfigDependencies) {
    const [configTasksDeviceA, configTasksDeviceB] = await getTunnelConfigDependenciesTasks(
      tunnel, true);

    tasksDeviceA.push(...configTasksDeviceA);
    tasksDeviceB.push(...configTasksDeviceB);
  }

  // Saving configuration for device A
  tasksDeviceA.push({
    entity: 'agent',
    message: 'add-tunnel',
    params: paramsDeviceA
  });

  if (!peer) {
    // Saving configuration for device B
    tasksDeviceB.push({
      entity: 'agent',
      message: 'add-tunnel',
      params: paramsDeviceB
    });
  }

  // In sync, we don't send modify-X. only add-x.
  // The BGP neighbors will be sent in add-routing-bgp
  if (!isSync) {
    const [bgpTasksDeviceA, bgpTasksDeviceB] = await addBgpNeighborsIfNeeded(tunnel);
    if (bgpTasksDeviceA.length > 0) {
      tasksDeviceA.push(...bgpTasksDeviceA); // modify-bgp after add-tunnel
    }

    if (bgpTasksDeviceB.length > 0) {
      tasksDeviceB.push(...bgpTasksDeviceB); // modify-bgp after add-tunnel
    }
  }

  return [tasksDeviceA, tasksDeviceB, deviceAIntf, deviceBIntf];
};

/**
 * Calls the necessary APIs for creating a single tunnel
 * @param  {string}   user         user id of requesting user
 * @param  {string}   org          id of the organization of the user
 * @param  {number}   tunnelnum    id of the tunnel to be added
 * @param  {string}   encryptionMethod key exchange method [none|ikev2|psk]
 * @param  {Object}   deviceA      details of device A
 * @param  {Object?}  deviceB      details of device B
 * @param  {Object}   deviceAIntf  device A tunnel interface
 * @param  {Object?}  deviceBIntf  device B tunnel interface
 * @param  {Object}   advancedOptions advanced tunnel options: MTU, MSS Clamp, OSPF cost, routing
 * @param  {Object?}  peer         peer configurations
 * @return {void}
 */
const addTunnel = async (
  user,
  org,
  tunnelnum,
  encryptionMethod,
  deviceA,
  deviceB,
  deviceAIntf,
  deviceBIntf,
  pathLabel,
  advancedOptions,
  peer = null,
  notificationsSettings = null
) => {
  const devicesInfo = {
    deviceA: { hostname: deviceA.hostname, interface: deviceAIntf.name }
  };
  if (!peer) {
    devicesInfo.deviceB = { hostname: deviceB.hostname, interface: deviceBIntf.name };
  }
  logger.info('Adding Tunnel', {
    params: { devices: devicesInfo }
  });

  // Generate IPsec Keys and store them in the database
  const tunnelKeys = encryptionMethod === 'psk' ? generateRandomKeys() : null;

  // Advanced tunnel options
  const { mtu, mssClamp, ospfCost, ospfArea, routing } = advancedOptions || {};

  // check if need to create the tunnel as pending
  let isPending = false;
  let pendingReason = '';
  let pendingType = '';

  if (deviceAIntf.IPv4 === '') {
    isPending = true;
    pendingType = pendingTypes.interfaceHasNoIp;
    pendingReason = getReason(pendingType, deviceAIntf.name, deviceA.name);
  }

  if (!peer && deviceBIntf.IPv4 === '') {
    isPending = true;
    pendingType = pendingTypes.interfaceHasNoIp;
    pendingReason = getReason(pendingType, deviceBIntf.name, deviceB.name);
  }

  // on creation tunnel we remove the public address limiter if exists
  await publicAddrInfoLimiter.release(`${deviceA._id}:${deviceAIntf._id}`);
  if (!peer) {
    await publicAddrInfoLimiter.release(`${deviceB._id}:${deviceBIntf._id}`);
  }

  const tunnel = await tunnelsModel.findOneAndUpdate(
    // Query, use the org and tunnel number
    {
      org: org,
      num: tunnelnum
    },
    // Update
    {
      isActive: true,
      deviceAconf: false,
      deviceBconf: false,
      deviceA: deviceA._id,
      interfaceA: deviceAIntf._id,
      deviceB: peer ? null : deviceB._id,
      interfaceB: peer ? null : deviceBIntf._id,
      pathlabel: pathLabel,
      isPending: isPending,
      pendingType: pendingType,
      pendingTime: isPending ? new Date() : '',
      pendingReason: pendingReason,
      encryptionMethod,
      tunnelKeys,
      advancedOptions: { mtu, mssClamp, ospfCost, ospfArea, routing },
      peer: peer ? peer._id : null,
      notificationsSettings: notificationsSettings
    },
    // Options
    { upsert: true, new: true }
  )
    .populate('deviceA', '_id machineId name hostname versions interfaces IKEv2 bgp')
    .populate('deviceB', '_id machineId name hostname versions interfaces IKEv2 bgp')
    .populate('peer')
    .populate('org');

  if (!tunnel.deviceA || (!tunnel.peer && !tunnel.deviceB)) {
    await tunnelsModel.findOneAndUpdate({
      org: org, num: tunnelnum
    }, {
      isActive: false,
      deviceAconf: false,
      deviceBconf: false,
      pendingTunnelModification: false,
      status: 'down',
      tunnelKeys: null
    });
    throw new Error('Some devices were removed');
  }

  // don't send jobs for pending tunnels
  if (isPending) {
    throw new Error(`Tunnel #${tunnelnum} set as pending - ${pendingReason}`);
  }

  return await sendAddTunnelsJobs([tunnel], user);
};

/**
 * Update tunnel device configuration
 * @param  {Object}  tunnelsModel mongoose tunnel schema
 * @param  {string}  org          organization initiated the request
 * @param  {string}  tunnelId     the id of the tunnel to update
 * @param  {string}  target       which parameter to update in the model
 * @param  {boolean} isAdd        update to configuration of true or false
 * @return {void}
 */
const updateTunnelIsConnected = (
  tunnelsModel,
  org,
  tunnelId,
  target,
  isAdd
) => (inp, callback) => {
  const params = {
    org: org,
    target: target,
    isAdd: isAdd
  };
  logger.info('Updating tunnels connectivity', { params: params });
  const update = {};
  update[target] = isAdd;

  tunnelsModel
    .findOneAndUpdate(
      // Query
      { num: tunnelId, org: org },
      // Update
      update,
      // Options
      { upsert: false, new: true }
    )
    .then(
      resp => {
        if (resp != null) {
          callback(null, { ok: 1 });
        } else {
          const err = new Error('Update tunnel connected status failure');
          callback(err, false);
        }
      },
      err => {
        callback(err, false);
      }
    )
    .catch(err => {
      callback(err, false);
    });
};

const bulkUpdate = async (updateOps) => {
  if (updateOps.length) {
    try {
      const { matchedCount, modifiedCount } = await tunnelsModel.bulkWrite(updateOps);
      if (modifiedCount !== updateOps.length) {
        logger.error('Updated tunnels count does not match requested',
          { params: { matchedCount, modifiedCount, updateOps } }
        );
      }
    } catch (err) {
      logger.warn('Failed to update tunnels in database', {
        params: { message: err.message }
      });
    }
  };
};

/**
 * This function is called when deleting a tunnel
 * @async
 * @param  {Array}    device    an array of the devices to be modified
 * @param  {Object}   user      User object
 * @param  {Object}   data      Additional data used by caller
 * @return {None}
 */
const applyTunnelDel = async (devices, user, data) => {
  const { tunnels, filters } = data;
  logger.info('Delete tunnels ', { params: { tunnels, filters } });
  const startedAt = Date.now();
  let tunnelIds = [];
  let tunnelsArray;
  if (tunnels) {
    tunnelIds = Object.keys(tunnels);
    tunnelsArray = await tunnelsModel.find(
      { _id: { $in: tunnelIds }, isActive: true, org: data.org }
    )
      .populate('deviceA', '_id machineId name hostname sync staticroutes interfaces versions')
      .populate('deviceB', '_id machineId name hostname sync staticroutes interfaces versions')
      .populate('peer')
      .populate('org', '_id tunnelRange');

    if (tunnelsArray.length !== tunnelIds.length) {
      logger.error('Some tunnels were not found, try refresh and delete again',
        { params: { tunnelIds, foundIds: tunnelsArray.map(t => t._id) } });
      throw new Error('Some tunnels were not found, try refresh and delete again');
    }
  } else if (filters) {
    const updateStatusInDb = filters.includes('tunnelStatus');
    const statusesInDb = require('../periodic/statusesInDb')();
    if (updateStatusInDb) {
      // need to update changed statuses from memory to DB
      await statusesInDb.updateDevicesStatuses([data.org]);
      await statusesInDb.updateTunnelsStatuses([data.org]);
    }
    const {
      matchPipeline,
      dataPipeline,
      filterPipeline
    } = getTunnelsPipeline([data.org], filters);
    const pipeline = [...matchPipeline, ...dataPipeline, ...filterPipeline];
    tunnelsArray = await tunnelsModel.aggregate(pipeline).allowDiskUse(true);
  }

  if (devices && tunnelsArray.length > 0) {
    const org = tunnelsArray[0].org;
    const userName = user.username;

    const delPromises = [];
    const updateOps = [];
    tunnelsArray.forEach(tunnel => {
      try {
        const delPromise = delTunnel(tunnel, userName, org, updateOps);
        delPromises.push(delPromise);
      } catch (err) {
        logger.error('Delete tunnel error',
          { params: { tunnelID: tunnel._id, error: err.message } }
        );
      }
    });

    if (delPromises.length > 1000) {
      logger.debug('More than 1000 jobs in progress', { params: { tunnels: delPromises.length } });
      const message = 'More than 1000 jobs in progress, check the result on the Jobs page.';
      Promise.allSettled(delPromises).then(promiseStatus => {
        let failed = 0;
        bulkUpdate(updateOps);
        promiseStatus.forEach(elem => {
          if (elem.status !== 'fulfilled') {
            failed++;
            logger.error('Delete tunnel error',
              { params: { error: elem.reason.message } }
            );
          };
        });
        const completed = delPromises.length - failed;
        logger.debug('Delete tunnels operation finished',
          { params: { completed, failed, durationMs: Date.now() - startedAt } }
        );
      });
      return { ids: [], status: 'unknown', message };
    }

    const promiseStatus = await Promise.allSettled(delPromises);
    bulkUpdate(updateOps);

    const { fulfilled, reasons } = promiseStatus.reduce(({ fulfilled, reasons }, elem) => {
      if (elem.status === 'fulfilled') {
        const job = elem.value;
        if (job.length) {
          fulfilled.push(job);
        }
      } else {
        if (!reasons.includes(elem.reason.message)) {
          reasons.push(elem.reason.message);
        }
      };
      return { fulfilled, reasons };
    }, { fulfilled: [], reasons: [] });
    const status = fulfilled.length < tunnelsArray.length
      ? 'partially completed' : 'completed';

    const desired = delPromises.flat().map(job => job.id);
    const ids = fulfilled.flat().map(job => job.id);
    let message = 'tunnel deletion jobs added.';
    if (desired.length === 0 || fulfilled.flat().length === 0) {
      message = 'No ' + message;
    } else if (ids.length < desired.length) {
      message = `${ids.length} of ${desired.length} ${message}`;
    } else {
      message = `${ids.length} ${message}`;
    }
    if (reasons.length > 0) {
      message = `${message} ${Array.from(reasons).join(' ')}`;
    }

    const deletedTunnelNumbers = fulfilled.flat().map(
      job => job.data.message.tasks[0].params['tunnel-id'].toString());

    // resolve tunnel notifications
    await notificationsMgr.resolveNotificationsOfDeletedTunnels(
      deletedTunnelNumbers, data.org, true);

    return { ids: fulfilled.flat().map(job => job.id), status, message };
  } else {
    logger.error('Delete tunnels failed. No tunnels\' ids provided or no devices found',
      { params: { tunnelIds, devices } });
    throw new Error('Delete tunnels failed. No tunnels\' ids provided or no devices found');
  }
};

/**
 * Deletes a single tunnel.
 * @param  {object}   tunnel     the tunnel object
 * @param  {string}   user       the user id of the requesting user
 * @param  {string}   org        the user's organization
 * @return {array}    jobs created
 */
const delTunnel = async (tunnel, user, org, updateOps) => {
  const { _id, isPending, num, deviceA, deviceB, peer } = tunnel;

  // Check if tunnel used by any static route
  // const organization = await organizations.findOne({ _id: org }).lean();
  const { ip1, ip2 } = generateTunnelParams(num, org.tunnelRange);
  [...(deviceA?.staticroutes ?? []), ...(deviceB?.staticroutes ?? [])].forEach(s => {
    if ([ip1, ip2].includes(s.gateway)) {
      throw new Error(
        'Some static routes defined via removed tunnel, please remove static routes first'
      );
    }

    if ((s.conditions ?? []).some(c => c?.via?.tunnelId === tunnel.num)) {
      throw new Error(
        'A conditional static routes defined via removed tunnel, please remove static routes first'
      );
    }
  });

  updateOps.push({
    updateOne: {
      filter: { _id, org: org._id },
      update: {
        isActive: false,
        deviceAconf: false,
        deviceBconf: false,
        pendingTunnelModification: false,
        status: 'down',
        tunnelKeys: null
      },
      upsert: false
    }
  });

  let tunnelJobs = [];

  // don't send remove jobs for pending tunnels
  if (!isPending) {
    tunnelJobs = await sendRemoveTunnelsJobs([tunnel], user);
  }

  // remove the tunnel status from memory
  const deviceStatus = require('../periodic/deviceStatus')();
  deviceStatus.clearTunnelStatus(deviceA.machineId, num);
  if (!peer) {
    deviceStatus.clearTunnelStatus(deviceB.machineId, num);
  }

  // throw this error after removing from database
  if (isPending) {
    throw new Error('Tunnel was in pending state');
  }

  return tunnelJobs;
};

/**
 * Called when tunnel delete jobs are finished successfully.
 * @param  {number} jobId the id of the delete tunnel job
 * @param  {Object} res   the result of the delete tunnel job
 * @return {void}
 */
const completeTunnelDel = (jobId, res) => {
};

/**
 * Prepares tunnel delete jobs by creating an array that contains
 * the jobs that should be queued for each of the devices connected
 * by the tunnel.
 * @param  {Object} tunnel      the tunnel object to be deleted
 * @return {[{entity: string, message: string, params: Object}]} an array of tunnel-add jobs
 */
const prepareTunnelRemoveJob = async (
  tunnel,
  includeDeviceConfigDependencies = false
) => {
  const tasksDeviceA = [];
  const tasksDeviceB = [];

  const removeParams = {
    'tunnel-id': tunnel.num
  };

  if (includeDeviceConfigDependencies) {
    const [configTasksDeviceA, configTasksDeviceB] = await getTunnelConfigDependenciesTasks(
      tunnel, false);

    tasksDeviceA.push(...configTasksDeviceA);
    tasksDeviceB.push(...configTasksDeviceB);
  }

  // Saving configuration for device A
  tasksDeviceA.push({ entity: 'agent', message: 'remove-tunnel', params: removeParams });

  if (!tunnel.peer) {
    // Saving configuration for device B
    tasksDeviceB.push({ entity: 'agent', message: 'remove-tunnel', params: removeParams });
  }

  const [bgpTasksDeviceA, bgpTasksDeviceB] = await addBgpNeighborsIfNeeded(tunnel);
  if (bgpTasksDeviceA.length > 0) {
    tasksDeviceA.unshift(...bgpTasksDeviceA); // modify-bgp before remove-tunnel
  }

  if (bgpTasksDeviceB.length > 0) {
    tasksDeviceB.unshift(...bgpTasksDeviceB); // modify-bgp before remove-tunnel
  }

  return [tasksDeviceA, tasksDeviceB];
};

/**
 * Get all devices configurations that depend on the tunnel.
 * e.g. static route via the tunnel
 * @return Array
 */
const getTunnelConfigDependenciesTasks = async (tunnel, isAdd) => {
  const deviceATasks = [];
  const deviceBTasks = [];

  // If we are in the process of adding a tunnel,
  // we need to send tasks only to the non-pending dependent configurations.
  // Hence. we put "false" as second variable.
  // When we are in the process of removing a tunnel,
  // we need to take both, pending and non-pending
  // dependent configurations, hence we put null.
  const dependedDevices = await getTunnelConfigDependencies(tunnel, isAdd ? false : null);
  for (const dependedDevice of dependedDevices) {
    const deviceId = dependedDevice._id.toString();

    let deviceTasksArray = null;
    if (deviceId === tunnel.deviceA._id.toString()) {
      deviceTasksArray = deviceATasks;
    } else {
      deviceTasksArray = deviceBTasks;
    }

    for (const staticRoute of dependedDevice.staticroutes) {
      const {
        ifname,
        gateway,
        destination,
        metric,
        redistributeViaOSPF,
        redistributeViaBGP,
        onLink
      } = staticRoute;

      const params = {
        addr: destination,
        via: gateway,
        dev_id: ifname || undefined,
        metric: metric ? parseInt(metric, 10) : undefined,
        redistributeViaOSPF: redistributeViaOSPF,
        redistributeViaBGP: redistributeViaBGP,
        onLink: onLink
      };

      deviceTasksArray.push({
        entity: 'agent',
        message: `${isAdd ? 'add' : 'remove'}-route`,
        params
      });
    }
  }

  return [deviceATasks, deviceBTasks];
};

/**
 * Creates the tunnels section in the full sync job.
 * @return Array
 */
const sync = async (deviceId, org) => {
  // Get all active tunnels of the devices
  const tunnels = await tunnelsModel.find(
    {
      $and: [
        { org },
        { $or: [{ deviceA: deviceId }, { deviceB: deviceId }] },
        { isActive: true },
        { isPending: { $ne: true } } // skip pending tunnels on sync
      ]
    },
    {
      _id: 1,
      num: 1,
      org: 1,
      deviceA: 1,
      deviceB: 1,
      interfaceA: 1,
      interfaceB: 1,
      tunnelKeys: 1,
      encryptionMethod: 1,
      pathlabel: 1,
      advancedOptions: 1,
      notificationsSettings: 1,
      peer: 1
    }
  )
    .populate('deviceA', 'machineId interfaces versions IKEv2 bgp org')
    .populate('deviceB', 'machineId interfaces versions IKEv2 bgp org')
    .populate('peer')
    .populate('org')
    .lean();

  // Create add-tunnel messages
  const tunnelsRequests = [];
  const completeCbData = [];
  let callComplete = false;
  const devicesToSync = [];
  for (const tunnel of tunnels) {
    const {
      _id,
      num,
      deviceA,
      deviceB,
      tunnelKeys,
      encryptionMethod,
      peer,
      org: tunnelOrg
    } = tunnel;

    if (!tunnelKeys && encryptionMethod === 'psk' && peer === null) {
      // No keys for some reason, probably version 2 upgraded.
      // Tunnel keys will be generated in prepareTunnelAddJob.
      // Need to sync another side as well.
      const remoteDeviceId = deviceId.toString() === deviceA._id.toString()
        ? deviceB._id : deviceA._id;
      logger.warn('No tunnel keys', { params: { tunnelId: _id, deviceId: remoteDeviceId } });
      if (!devicesToSync.includes(remoteDeviceId)) {
        devicesToSync.push(remoteDeviceId);
      }
    }
    const [tasksA, tasksB] = await prepareTunnelAddJob(tunnel, tunnelOrg, false, true);

    // Add the tunnel only for the device that is being synced
    const deviceTasks =
      deviceId.toString() === deviceA._id.toString() ? tasksA : tasksB;
    tunnelsRequests.push(...deviceTasks);

    // Store the data required by the complete callback
    const target =
      deviceId.toString() === deviceA._id.toString()
        ? 'deviceAconf'
        : 'deviceBconf';
    completeCbData.push({
      org,
      username: 'system',
      tunnelId: num,
      target
    });
    callComplete = true;
  };
  // Reset auto sync in database for devices with generated keys
  if (devicesToSync.length > 0) {
    logger.info(
      'Resest autosync to set new keys on devices',
      { params: { devices: devicesToSync } }
    );
    devicesModel.updateMany(
      { _id: { $in: devicesToSync } },
      {
        $set: {
          'sync.state': 'syncing',
          'sync.autoSync': 'on'
        }
      },
      { upsert: false }
    );
  };
  return {
    requests: tunnelsRequests,
    completeCbData,
    callComplete
  };
};

const isDevSupportsVxlanPort = (majorVer, minorVer) => {
  return majorVer > 6 || (majorVer === 6 && minorVer >= 2);
};

const populateTunnelDestinations = (
  paramsA, paramsB, ifcA, ifcB, isDevASupportsVxlanPort, isDevBSupportsVxlanPort, orgSourcePort
) => {
  let usePrivateIps = false;

  if (!ifcA.PublicIP || !ifcB.PublicIP) {
    usePrivateIps = true;
  }

  // if both interfaces have the same public IP,
  // it means that they can use their private IPs as destinations
  if (ifcA.PublicIP === ifcB.PublicIP) {
    usePrivateIps = true;
  }

  // populate destination ips
  paramsA.dst = usePrivateIps ? ifcB.IPv4 : ifcB.PublicIP;
  paramsB.dst = usePrivateIps ? ifcA.IPv4 : ifcA.PublicIP;

  // if device version is lower than 6.2 - use 4789. Otherwise take the org.vxlanPort;
  const configSourcePort = configs.get('tunnelPort');
  const deviceADefaultDstPort = isDevASupportsVxlanPort ? orgSourcePort : configSourcePort;
  const deviceBDefaultDstPort = isDevBSupportsVxlanPort ? orgSourcePort : configSourcePort;

  // if one of the following met, use the default port and not the one detected by STUN.
  //    1. Device does not have public port.
  //    2. User forced to use default.
  //    3. Both tunnel sides are in the same subnet.
  const deviceAUseDefaultPort = !ifcA.PublicPort || ifcA.useFixedPublicPort || usePrivateIps;
  const deviceBUseDefaultPort = !ifcB.PublicPort || ifcB.useFixedPublicPort || usePrivateIps;

  paramsA.dstPort = deviceBUseDefaultPort ? deviceBDefaultDstPort : ifcB.PublicPort;
  paramsB.dstPort = deviceAUseDefaultPort ? deviceADefaultDstPort : ifcA.PublicPort;
};

/**
 * Prepares common parameters for add/remove tunnel jobs
 * @param  {object} tunnel      the tunnel object
 * @param  {object} deviceAIntf device A tunnel interface
 * @param  {object?} deviceBIntf device B tunnel interface
 * @param  {object?} deviceA device A object
 * @param  {object?} deviceB device B object
 * @param  {object?} org organization object
 * @param  {pathLabel?} pathLabel label used for this tunnel
 * @param  {object} advancedOptions advanced tunnel options: MTU, MSS Clamp, OSPF cost, routing
 * @param  {object?}  peer peer configurations. If exists, fill peer configurations
*/

const prepareTunnelParams = (
  tunnel, deviceAIntf, deviceBIntf, deviceA, deviceB, org,
  pathLabel = null, advancedOptions = {}, peer = null
) => {
  const paramsDeviceA = {};
  const paramsDeviceB = {};

  // add tunnel notifications settings for both devices
  if (tunnel?.notificationsSettings && Object.keys(tunnel.notificationsSettings).length > 0) {
    paramsDeviceA.notificationsSettings = tunnel.notificationsSettings;
    paramsDeviceB.notificationsSettings = tunnel.notificationsSettings;
  }

  // need to check versions for some parameters compatibility
  const majorVersionA = getMajorVersion(deviceA.versions.agent);
  const minorVersionA = getMinorVersion(deviceA.versions.agent);
  const majorVersionB = peer ? null : getMajorVersion(deviceB?.versions.agent);
  const minorVersionB = peer ? null : getMinorVersion(deviceB?.versions.agent);

  // Generate from the tunnel num: IP A/B, MAC A/B, SA A/B
  const tunnelParams = generateTunnelParams(tunnel.num, org.tunnelRange);

  // no additional header for not encrypted tunnels
  const packetHeaderSize = tunnel.encryptionMethod === 'none' ? 0 : 150;
  let minMtu = Math.min(
    deviceAIntf.mtu || 1500,
    deviceBIntf && deviceBIntf.mtu ? deviceBIntf.mtu : 1500
  ) - packetHeaderSize;

  let { mtu, ospfCost, ospfArea, mssClamp, routing } = advancedOptions;
  if (!mtu) {
    mtu = (globalTunnelMtu > 0) ? globalTunnelMtu : minMtu;
  }
  mtu = Math.min(Math.max(mtu, 500), 1500);
  minMtu = Math.min(mtu, minMtu);

  // Create common settings for both tunnel types
  paramsDeviceA['encryption-mode'] = tunnel.encryptionMethod;
  paramsDeviceA.dev_id = deviceAIntf.devId;
  paramsDeviceA['tunnel-id'] = tunnel.num;

  const isDevASupportsVxlanPort = isDevSupportsVxlanPort(majorVersionA, minorVersionA);
  const orgSourcePort = org.vxlanPort;

  paramsDeviceA.src = deviceAIntf.IPv4;
  if (isDevASupportsVxlanPort) {
    paramsDeviceA.srcPort = orgSourcePort;
  }

  if (peer) {
    // destination
    paramsDeviceA.peer = {};

    paramsDeviceA.dst = peer.remoteIP;

    // handle peer configurations
    paramsDeviceA.peer.addr = tunnelParams.ip1 + '/31';
    paramsDeviceA.peer.routing = routing || 'ospf';
    paramsDeviceA.peer.mtu = mtu;
    paramsDeviceA.peer.multilink = {
      labels: pathLabel ? [pathLabel] : []
    };
    paramsDeviceA.peer.urls = peer.urls;
    paramsDeviceA.peer.ips = peer.ips;
    if (mssClamp !== 'no') {
      paramsDeviceA.peer['tcp-mss-clamp'] = minMtu - tcpClampingHeaderSize;
    }
    if (ospfCost) {
      paramsDeviceA.peer['ospf-cost'] = ospfCost;
    }
    if (ospfArea) {
      paramsDeviceA.peer['ospf-area'] = ospfArea;
    }
  } else {
    const isDevBSupportsVxlanPort = isDevSupportsVxlanPort(majorVersionB, minorVersionB);

    paramsDeviceB.src = deviceBIntf.IPv4;
    if (isDevBSupportsVxlanPort) {
      paramsDeviceB.srcPort = orgSourcePort;
    }

    // destination
    populateTunnelDestinations(
      paramsDeviceA,
      paramsDeviceB,
      deviceAIntf,
      deviceBIntf,
      isDevASupportsVxlanPort,
      isDevBSupportsVxlanPort,
      orgSourcePort
    );

    paramsDeviceA['loopback-iface'] = {
      addr: tunnelParams.ip1 + '/31',
      mac: tunnelParams.mac1,
      mtu: mtu,
      routing: routing || 'ospf',
      multilink: {
        labels: pathLabel ? [pathLabel] : []
      }
    };

    // handle params device B
    paramsDeviceB['encryption-mode'] = tunnel.encryptionMethod;
    paramsDeviceB.dev_id = deviceBIntf.devId;

    paramsDeviceB['tunnel-id'] = tunnel.num;
    paramsDeviceB['loopback-iface'] = {
      addr: tunnelParams.ip2 + '/31',
      mac: tunnelParams.mac2,
      mtu: mtu,
      routing: routing || 'ospf',
      multilink: {
        labels: pathLabel ? [pathLabel] : []
      }
    };
    if (majorVersionA >= 6) {
      paramsDeviceA.remoteBandwidthMbps = {
        tx: +(deviceBIntf.bandwidthMbps?.tx ?? 100),
        rx: +(deviceBIntf.bandwidthMbps?.rx ?? 100)
      };
    };
    if (majorVersionB >= 6) {
      paramsDeviceB.remoteBandwidthMbps = {
        tx: +(deviceAIntf.bandwidthMbps?.tx ?? 100),
        rx: +(deviceAIntf.bandwidthMbps?.rx ?? 100)
      };
    };
    if (mssClamp !== 'no') {
      paramsDeviceA['loopback-iface']['tcp-mss-clamp'] = minMtu - tcpClampingHeaderSize;
      paramsDeviceB['loopback-iface']['tcp-mss-clamp'] = minMtu - tcpClampingHeaderSize;
    }
    if (ospfCost) {
      paramsDeviceA['loopback-iface']['ospf-cost'] = ospfCost;
      paramsDeviceB['loopback-iface']['ospf-cost'] = ospfCost;
    }
    if (ospfArea) {
      paramsDeviceA['loopback-iface']['ospf-area'] = ospfArea;
      paramsDeviceB['loopback-iface']['ospf-area'] = ospfArea;
    }

    if (routing === 'bgp') {
      const isNeedToSendRemoteAsnA =
        majorVersionA >= 6 || (majorVersionA === 5 && minorVersionA >= 4);
      const isNeedToSendRemoteAsnB =
        majorVersionB >= 6 || (majorVersionB === 5 && minorVersionB >= 4);

      if (isNeedToSendRemoteAsnA) {
        const bgpAsnDeviceB = deviceB.bgp.localASN;
        paramsDeviceA['loopback-iface']['bgp-remote-asn'] = bgpAsnDeviceB;
      }
      if (isNeedToSendRemoteAsnB) {
        const bgpAsnDeviceA = deviceA.bgp.localASN;
        paramsDeviceB['loopback-iface']['bgp-remote-asn'] = bgpAsnDeviceA;
      }
    }
  }

  return { paramsDeviceA, paramsDeviceB, tunnelParams };
};

/**
 * Send tunnels remove jobs
 * @param  {Array}   tunnelIds an array of ids of the tunnels to remove
 * @param  {string}  username  the name of the user that requested the device change
 * @return {Array}             array of add-tunnel jobs
 */
const sendRemoveTunnelsJobs = async (
  tunnels, username = 'system', includeDeviceConfigDependencies = false
) => {
  let tunnelsJobs = [];

  for (const tunnel of tunnels) {
    const { org, deviceA, deviceB, interfaceA, interfaceB, pathlabel, peer } = tunnel;

    const ifcA = tunnel.interfaceADetails ?? deviceA.interfaces.find(ifc => {
      return ifc._id.toString() === interfaceA.toString();
    });
    const ifcB = peer ? null : tunnel.interfaceBDetails ?? deviceB.interfaces.find(ifc => {
      return ifc._id.toString() === interfaceB.toString();
    });

    let [tasksDeviceA, tasksDeviceB] = await prepareTunnelRemoveJob(
      tunnel,
      includeDeviceConfigDependencies
    );

    if (tasksDeviceA.length > 1) {
      tasksDeviceA = [{
        entity: 'agent',
        message: 'aggregated',
        params: { requests: tasksDeviceA }
      }];
    }

    if (tasksDeviceB.length > 1) {
      tasksDeviceB = [{
        entity: 'agent',
        message: 'aggregated',
        params: { requests: tasksDeviceB }
      }];
    }

    try {
      let title = '';
      if (peer) {
        title = 'Delete peer tunnel between (' +
        deviceA.hostname +
        ',' +
        ifcA.name +
        ') and peer (' +
        peer.name +
        ')';
      } else {
        title = 'Delete tunnel between (' +
        deviceA.hostname +
        ',' +
        ifcA.name +
        ') and (' +
        deviceB.hostname +
        ',' +
        ifcB.name +
        ')';
      };

      const removeTunnelJobs = await queueTunnel(
        false,
        title,
        tasksDeviceA,
        tasksDeviceB,
        username,
        org._id,
        deviceA.machineId,
        peer ? null : deviceB.machineId,
        deviceA._id,
        peer ? null : deviceB._id,
        tunnel.num,
        pathlabel,
        peer
      );
      logger.debug('Tunnel jobs queued', {
        params: { jobA: removeTunnelJobs[0], jobB: removeTunnelJobs[1] }
      });

      tunnelsJobs = tunnelsJobs.concat(removeTunnelJobs);
    } catch (err) {
      logger.error('Delete tunnel error', { params: { reason: err.message } });
      throw err;
    }
  }

  return tunnelsJobs;
};

/**
 * Send tunnels add jobs
 * @param  {Array}   tunnelIds an array of ids of the tunnels to create
 * @param  {string}  username  the name of the user that requested the device change
 * @return {Array}             array of add-tunnel jobs
 */
const sendAddTunnelsJobs = async (tunnels, username, includeDeviceConfigDependencies = false) => {
  let jobs = [];
  let orgId = null;
  try {
    for (const tunnel of tunnels) {
      orgId = tunnel.org._id;

      const {
        deviceA,
        deviceB,
        num,
        pathlabel,
        peer,
        org
      } = tunnel;

      let [tasksDeviceA, tasksDeviceB, ifcA, ifcB] = await prepareTunnelAddJob(
        tunnel, org, includeDeviceConfigDependencies
      );

      if (tasksDeviceA.length > 1) {
        tasksDeviceA = [{
          entity: 'agent',
          message: 'aggregated',
          params: { requests: tasksDeviceA }
        }];
      }

      if (tasksDeviceB.length > 1) {
        tasksDeviceB = [{
          entity: 'agent',
          message: 'aggregated',
          params: { requests: tasksDeviceB }
        }];
      }

      let title = '';
      if (peer) {
        title += 'Create peer tunnel between (' +
          deviceA.hostname +
          ',' +
          ifcA.name +
          ') and peer (' +
          peer.name +
          ')';
      } else {
        title += 'Create tunnel between (' +
          deviceA.hostname +
          ',' +
          ifcA.name +
          ') and (' +
          deviceB.hostname +
          ',' +
          ifcB.name +
          ')';
      }
      const tunnelJobs = await queueTunnel(
        true,
        title,
        tasksDeviceA,
        tasksDeviceB,
        username,
        orgId,
        deviceA.machineId,
        peer ? null : deviceB.machineId,
        deviceA._id,
        peer ? null : deviceB._id,
        num,
        pathlabel,
        peer
      );

      jobs = jobs.concat(tunnelJobs);
    }
  } catch (err) {
    logger.error('Failed to queue Add tunnel jobs', {
      params: { err: err.message }
    });
  };
  return jobs;
};

const addBgpNeighborsIfNeeded = async tunnel => {
  const { deviceA, deviceB, advancedOptions, peer } = tunnel;
  const { routing } = advancedOptions;

  const deviceATasks = [];
  const deviceBTasks = [];

  if (routing === 'bgp') {
    const majorA = getMajorVersion(deviceA.versions.agent);
    const minorA = getMinorVersion(deviceA.versions.agent);
    const majorB = peer ? null : getMajorVersion(deviceB.versions.agent);
    const minorB = peer ? null : getMinorVersion(deviceB.versions.agent);

    const isNeedToSendNeighborsA = majorA === 5 && minorA === 3;
    const isNeedToSendNeighborsB = majorB === 5 && minorB === 3;
    if (isNeedToSendNeighborsA || isNeedToSendNeighborsB) {
      if (isNeedToSendNeighborsA) {
        const modifyBgp = await buildModifyBgpJob(deviceA);
        deviceATasks.push(modifyBgp);
      }

      if (isNeedToSendNeighborsB) {
        const modifyBgp = await buildModifyBgpJob(deviceB);
        deviceBTasks.push(modifyBgp);
      }
    }
  }

  return [deviceATasks, deviceBTasks];
};

const buildModifyBgpJob = async device => {
  const bgpParams = await transformBGP(device);
  return { entity: 'agent', message: 'modify-routing-bgp', params: bgpParams };
};

const getInterfacesWithPathLabels = device => {
  const deviceIntfs = [];
  device.interfaces.forEach(intf => {
    if (intf.isAssigned === true && intf.type === 'WAN') {
      const labelsSet = new Set(intf.pathlabels.map(label => {
        // DIA interfaces cannot be used in tunnels
        return label.type !== 'DIA' ? label._id.toString() : null;
      }));
      deviceIntfs.push({
        labelsSet: labelsSet,
        ...intf.toObject()
      });
    }
  });
  return deviceIntfs;
};

/**
 * Get all devices with config depend on the tunnel
 * @param  {object} tunnel tunnel object
 * @return {[{object}]} array of devices with config
*/
const getTunnelConfigDependencies = async (tunnel, isPending) => {
  const org = await organizations.findOne({ _id: tunnel.org }).lean();
  const { ip1, ip2 } = generateTunnelParams(tunnel.num, org.tunnelRange);

  const staticRouteArrayFilters = {
    $and: [{
      $or: [
        { $eq: ['$$route.gateway', ip1] },
        { $eq: ['$$route.gateway', ip2] }
      ]
    }]
  };

  if (isPending === true || isPending === false) {
    staticRouteArrayFilters.$and.push({
      [isPending ? '$eq' : '$ne']: ['$$route.isPending', true]
    });
  }

  // // tunnel.org sometimes populated and sometimes does not.
  // // since the "aggregate" below requires using mongoose object ID,
  // // here is a safer workaround to get the always the object ID.
  const orgId = tunnel?.org?._id?.toString() ?? tunnel.org;

  const devicesStaticRoutes = await devicesModel.aggregate([
    { $match: { org: mongoose.Types.ObjectId(orgId) } }, // org match is very important here
    {
      $addFields: {
        staticroutes: {
          $filter: {
            input: '$staticroutes',
            as: 'route',
            cond: staticRouteArrayFilters
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        org: 1,
        machineId: 1,
        name: 1,
        staticroutes: 1
      }
    }
  ]).allowDiskUse(true);

  return devicesStaticRoutes;
};

module.exports = {
  apply: {
    applyTunnelAdd: applyTunnelAdd,
    applyTunnelDel: applyTunnelDel
  },
  complete: {
    completeTunnelAdd: completeTunnelAdd,
    completeTunnelDel: completeTunnelDel
  },
  error: {
    errorTunnelAdd: errorTunnelAdd
  },
  sync: sync,
  completeSync: completeSync,
  sendRemoveTunnelsJobs: sendRemoveTunnelsJobs,
  prepareTunnelAddJob: prepareTunnelAddJob,
  prepareTunnelRemoveJob: prepareTunnelRemoveJob,
  sendAddTunnelsJobs: sendAddTunnelsJobs,
  getTunnelConfigDependencies: getTunnelConfigDependencies
};
