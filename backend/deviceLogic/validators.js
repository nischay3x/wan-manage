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

const configs = require('../configs')();
const net = require('net');
const cidr = require('cidr-tools');
const { getBridges, getCpuInfo, validateFirewallRules, isEmpty } = require('../utils/deviceUtils');
const { generateTunnelParams } = require('../utils/tunnelUtils');
const { getMajorVersion, getMinorVersion } = require('../versioning');
const keyBy = require('lodash/keyBy');
const { isEqual } = require('lodash');
const maxMetric = 2 * 10 ** 9;
const { getAllOrganizationBGPDevices, checkLanOverlappingWith } = require('../utils/orgUtils');
const appsLogic = require('../applicationLogic/applications')();
const { getStartEndIp } = require('../utils/networks');

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
 * Checks whether dhcp server configuration is valid
 * Validate if any dhcp is assigned on a modified interface
 * @param {Object} device - the device to validate
 * @param {List} modifiedInterfaces - list of modified interfaces
 * @return {{valid: boolean, err: string}}  test result + error, if device is invalid
 */
const validateDhcpConfig = (device, modifiedInterfaces) => {
  const assignedDhcps = device.dhcp.map(d => d.interface);
  const modifiedDhcp = modifiedInterfaces.filter(i => {
    // don't validate unassigned modified interface
    if (!assignedDhcps.includes(i.devId)) {
      return false;
    }

    // validate only critical fields
    const orig = device.interfaces.find(intf => intf.devId === i.devId);
    if (i.type !== orig.type ||
      i.dhcp !== orig.dhcp ||
      i.addr !== `${orig.IPv4}/${orig.IPv4Mask}` ||
      // Check if both gateways are not falsy values (undefined, "", null, etc).
      // In such case, we don't consider it as modification
      (i.gateway && orig.gateway && i.gateway !== orig.gateway)
    ) {
      return true;
    } else {
      return false;
    }
  });
  if (modifiedDhcp.length > 0) {
    // get first interface from device
    const firstIf = device.interfaces.filter(i => i.devId === modifiedDhcp[0].devId);
    const result = {
      valid: false,
      err: `DHCP defined on interface ${
        firstIf[0].name
      }, please remove it before modifying this interface`
    };
    return result;
  }
  return { valid: true, err: '' };
};

/**
 * Checks whether the device configuration is valid,
 * therefore the device can be started.
 * @param {object}  device     the device to check
 * @param {object}  org        organization object
 * @param {boolean} isRunning  is the device running
 * @param {boolean} allowOverlapping  if to allow interface LAN overlapping
 * @param {object} origDevice  origDevice object. Can be different that "device"
 * @return {{valid: boolean, err: string}}  test result + error, if device is invalid
 */
const validateDevice = async (
  device,
  org,
  isRunning = false,
  allowOverlapping = false,
  origDevice = null
) => {
  const major = getMajorVersion(device.versions.agent);
  const minor = getMinorVersion(device.versions.agent);

  // Get all assigned interface. There should be at least
  // two such interfaces - one LAN and the other WAN
  const interfaces = device.interfaces;
  if (!Array.isArray(interfaces) || interfaces.length < 2) {
    return {
      valid: false,
      err: 'There should be at least two interfaces'
    };
  }
  const assignedIfs = interfaces.filter(ifc => { return ifc.isAssigned; });
  const [wanIfcs, lanIfcs] = [
    assignedIfs.filter(ifc => { return ifc.type === 'WAN'; }),
    assignedIfs.filter(ifc => { return ifc.type === 'LAN'; })
  ];

  if (isRunning && (assignedIfs.length < 2 || (wanIfcs.length === 0 || lanIfcs.length === 0))) {
    return {
      valid: false,
      err: 'There should be at least one LAN and one WAN interfaces'
    };
  }

  if (assignedIfs.some(ifc => +ifc.metric >= maxMetric)) {
    return {
      valid: false,
      err: `Metric should be lower than ${maxMetric}`
    };
  }

  const bridges = getBridges(assignedIfs);
  const assignedByDevId = keyBy(assignedIfs, 'devId');
  for (const ifc of assignedIfs) {
    // Assigned interfaces must be either WAN, LAN or TRUNK
    if (!['WAN', 'LAN', 'TRUNK'].includes(ifc.type)) {
      return {
        valid: false,
        err: `Invalid interface type for ${ifc.name}: ${ifc.type}`
      };
    }

    const validationResult = validateIPv4Address(ifc.IPv4, ifc.IPv4Mask);
    if (!validationResult.valid && ifc.dhcp !== 'yes' && ifc.type !== 'TRUNK') {
      return {
        valid: false,
        err: `[${ifc.name}]: ${validationResult.err}`
      };
    }

    const ipv4 = `${ifc.IPv4}/${ifc.IPv4Mask}`;
    // if interface in a bridge - make sure all bridged interface has no conflicts in configuration
    if (ipv4 in bridges) {
      for (const devId of bridges[ipv4]) {
        if (!isEqual(assignedByDevId[devId].ospf, ifc.ospf)) {
          return {
            valid: false,
            err: 'There is a conflict between the OSPF configuration of the bridge interfaces'
          };
        }
      }
    }

    if ((ifc.routing === 'BGP' || ifc.routing === 'OSPF,BGP') && !device.bgp.enable) {
      return {
        valid: false,
        err: `Cannot set BGP routing protocol for interface ${ifc.name}. BGP is not enabled`
      };
    }

    if (ifc.type === 'LAN') {
      // Path labels are not allowed on LAN interfaces
      if (ifc.pathlabels.length !== 0) {
        return {
          valid: false,
          err: 'Path Labels are not allowed on LAN interfaces'
        };
      }

      // LAN interfaces are not allowed to have a default GW
      if (ifc.dhcp !== 'yes' && ifc.gateway !== '') {
        return {
          valid: false,
          err: 'LAN interfaces should not be assigned a default GW'
        };
      }

      // DHCP client is not allowed on LAN interface
      if (ifc.dhcp === 'yes' && device.dhcp?.find(d => d.interface === ifc.devId)) {
        return {
          valid: false,
          err: `Configure DHCP server on interface ${ifc.name} is not allowed \
          while the interface configured with DHCP client`
        };
      }
    }

    if (ifc.type === 'WAN') {
      // OSPF is not allowed on WAN interfaces
      if (ifc.routing === 'OSPF') {
        return {
          valid: false,
          err: 'OSPF should not be configured on WAN interface'
        };
      }
      // WAN interfaces must have default GW assigned to them
      if (ifc.dhcp !== 'yes' && !net.isIPv4(ifc.gateway)) {
        return {
          valid: false,
          err: 'All WAN interfaces should be assigned a default GW'
        };
      }
    }
  }

  // Assigned interfaces must not be on the same subnet
  const assignedNotEmptyIfs = assignedIfs.filter(i => i.IPv4);
  for (const ifc1 of assignedNotEmptyIfs) {
    for (const ifc2 of assignedNotEmptyIfs.filter(i => i.devId !== ifc1.devId)) {
      const ifc1Subnet = `${ifc1.IPv4}/${ifc1.IPv4Mask}`;
      const ifc2Subnet = `${ifc2.IPv4}/${ifc2.IPv4Mask}`;

      // Allow only LANs with the same IP on the same device for the LAN bridge feature.
      // Note, for the LAN bridge feature, we allow only the same IP on multiple LANs,
      // but overlapping is not allowed.
      if (ifc1.type === 'LAN' && ifc2.type === 'LAN' && ifc1Subnet === ifc2Subnet) {
        continue;
      }

      if (cidr.overlap(ifc1Subnet, ifc2Subnet)) {
        return {
          valid: false,
          err: 'IP addresses of the assigned interfaces have an overlap'
        };
      }
      // prevent Public IP / WAN overlap
      if (ifc1.type === 'WAN' && ifc1.PublicIP &&
        cidr.overlap(ifc2Subnet, `${ifc1.PublicIP}/32`)) {
        return {
          valid: false,
          err: `IP address of [${ifc2.name}] has an overlap with Public IP of [${ifc1.name}]`
        };
      }
    }
  }

  // Assuming unassigned interface is WAN if gateway is set
  const uniqMetricsOfUnassigned = [...new Set(
    interfaces.filter(i => !i.isAssigned && i.gateway).map(i => +i.metric)
  )];

  // Checks if all assigned WAN interfaces metrics are different
  const { metricsArray, pathLabels } = wanIfcs.reduce((a, v) => {
    a.metricsArray.push(Number(v.metric));
    a.pathLabels = a.pathLabels.concat(v.pathlabels.map((p) => p._id));
    return a;
  }, { metricsArray: uniqMetricsOfUnassigned, pathLabels: [] });

  const hasDuplicates = metricsArray.length !== new Set(metricsArray).size;
  if (hasDuplicates) {
    return {
      valid: false,
      err: 'Duplicated metrics are not allowed on WAN interfaces'
    };
  }
  const hasPathLabelsDuplicates = pathLabels.length !== new Set(pathLabels).size;
  if (hasPathLabelsDuplicates) {
    return {
      valid: false,
      err: 'Setting the same path label on multiple WAN interfaces is not allowed'
    };
  }

  // VLAN validation
  const interfacesByDevId = keyBy(interfaces, 'devId');
  for (const ifc of interfaces) {
    if (ifc.vlanTag) {
      if (!ifc.parentDevId) {
        return {
          valid: false,
          err: `VLAN ${ifc.name} must belong to some parent interface`
        };
      }
      if (!interfacesByDevId[ifc.parentDevId]) {
        return {
          valid: false,
          err: 'Wrong parent interface for VLAN ' + ifc.name
        };
      }
      const idParts = ifc.devId.split('.');
      let vlanTagInId = '';
      if (idParts.length > 2 && idParts[0] === 'vlan' && idParts[1]) {
        vlanTagInId = idParts[1];
      }
      if (ifc.vlanTag !== vlanTagInId) {
        return {
          valid: false,
          err: `Wrong VLAN ${ifc.name} identifier`
        };
      }
    }
  }

  if (configs.get('forbidLanSubnetOverlaps', 'boolean')) {
    const subnetsToCheck = [];
    if (origDevice) {
      // to optimize the heavy query, we check only subnets that changed

      // first take assigned interface before the change
      const origInterfacesByDevId = {};
      for (const origIfc of origDevice.interfaces) {
        if (origIfc.isAssigned) {
          origInterfacesByDevId[origIfc.devId] = origIfc;
        }
      }

      // loop on the updated assigned and check if subnet is changed
      for (const lanIfc of lanIfcs) {
        const subnet = lanIfc.IPv4 + '/' + lanIfc.IPv4Mask;
        if (subnet === '/') {
          continue;
        }

        const orig = origInterfacesByDevId[lanIfc.devId];
        const origSubnet = orig.IPv4 + '/' + orig.IPv4Mask;
        if (origSubnet === '/') {
          continue;
        }

        if (subnet === origSubnet) {
          continue;
        }

        subnetsToCheck.push(subnet);
      }
    } else {
      // check all LAN interface that have IP
      for (const lanIfc of lanIfcs) {
        const subnet = lanIfc.IPv4 + '/' + lanIfc.IPv4Mask;
        if (subnet !== '/') {
          subnetsToCheck.push(subnet);
        }
      }
    }

    const overlappingSubnets = await validateOverlappingSubnets(device.org, subnetsToCheck);
    for (const overlappingSubnet of overlappingSubnets) {
      const { type, subnet, overlappingWith, meta } = overlappingSubnet;

      let errMsg = `The interface network ${subnet} overlaps with `;

      if (type === 'lanInterface') {
        // Don't check interface overlapping with same device
        if (meta.deviceId === device._id.toString()) {
          continue;
        };

        // Allow only subnets overlapping but do not
        // allow same IP in two devices
        if (subnet === overlappingWith) {
          return {
            valid: false,
            err: `The IP address ${subnet} already exists in device ` +
            `${meta.deviceName} (${meta.interfaceName}) `
          };
        }

        if (allowOverlapping) {
          continue;
        }

        // With user approval, we permit overlapping LAN interfaces.
        // If the user approves it, the "allowOverlapping" is set to true.
        // If it is set to "false", we must determine if the overlapping was previously allowed.
        // To do so, we check if it is already overlapped in "origDevice".
        // If it is, we can conclude that it is allowed.
        // Otherwise, it cannot be saved in the database.
        const updatedIfcDevId = lanIfcs.find(i => i.IPv4 + '/' + i.IPv4Mask === subnet).devId;
        const origIfc = origDevice?.interfaces?.find(i => i.devId === updatedIfcDevId);
        if (origIfc?.IPv4) {
          const origIfcSubnet = `${origIfc.IPv4}/${origIfc.IPv4Mask}`;
          if (origIfcSubnet !== '/' && cidr.overlap(origIfcSubnet, subnet)) {
            continue;
          }
        }

        errMsg += `address ${overlappingWith} of the LAN interface `;
        errMsg += `${meta.interfaceName} in device ${meta.deviceName}`;
        return { valid: false, err: errMsg, errCode: 'LAN_OVERLAPPING' };
      }

      if (type === 'tunnel') {
        errMsg += `flexiWAN tunnel range (${overlappingWith})`;
        return { valid: false, err: errMsg, errCode: 'TUNNEL_OVERLAPPING' };
      }

      if (type === 'application') {
        errMsg += `address ${overlappingWith} of the application `;
        errMsg += `${meta.appName} in device ${meta.deviceName}`;
        return { valid: false, err: errMsg, errCode: 'APPLICATION_OVERLAPPING' };
      }
    }
  }

  const lteInterface = assignedIfs.find(i => i.deviceType === 'lte');
  if (lteInterface) {
    const isEnabled = lteInterface.configuration && lteInterface.configuration.enable;
    if (!isEnabled) {
      return {
        valid: false,
        err: 'LTE interface is assigned but not enabled. Please enable or unassign it'
      };
    }
  }

  const wifiInterface = assignedIfs.find(i => i.deviceType === 'wifi');
  if (wifiInterface) {
    const band2Enable = wifiInterface.configuration['2.4GHz'] &&
      wifiInterface.configuration['2.4GHz'].enable;
    const band5Enable = wifiInterface.configuration['5GHz'] &&
      wifiInterface.configuration['5GHz'].enable;

    if (band2Enable && band5Enable) {
      return {
        valid: false, err: 'Dual band at the same time is not supported. Please enable one of them'
      };
    } ;

    if (!band2Enable && !band5Enable) {
      return {
        valid: false, err: 'Wifi access point must be enabled'
      };
    } ;
  }

  // Firewall rules validation
  if (device.firewall) {
    const { interfaces, firewall, policies } = device;
    const globalRules = policies?.firewall?.policy &&
      policies?.firewall?.status?.startsWith('install') ? policies.firewall.policy.rules : [];
    const { valid, err } = validateFirewallRules(
      [...globalRules, ...firewall.rules],
      org,
      interfaces
    );
    if (!valid) {
      return { valid, err };
    }
  }

  // routing filters validation
  if (device.routingFilters) {
    const isOverlappingAllowed = major > 6 || (major === 6 && minor >= 2);

    for (const filter of device.routingFilters) {
      const name = filter.name;
      const duplicateName = device.routingFilters.filter(l => l.name === name).length > 1;
      if (duplicateName) {
        return {
          valid: false,
          err: 'Routing filters with the same name are not allowed'
        };
      }

      const usedRuleRoutes = new Set();
      const usedRulePriorities = new Set();
      for (const rule of filter.rules) {
        // check route duplications
        const route = rule.route;
        if (usedRuleRoutes.has(route)) {
          return {
            valid: false,
            err: `Duplicate routes (${route}) in the "${name}" routing filter are not allowed`
          };
        }

        // if version less than 6.2, prevent overlapping routes
        if (!isOverlappingAllowed) {
          for (const usedRuleRoute of usedRuleRoutes) {
            if (usedRuleRoute === '0.0.0.0/0' || route === '0.0.0.0/0') continue;
            if (cidr.overlap(usedRuleRoute, route)) {
              return {
                valid: false,
                err: 'Device version 6.1.X and below doesn\'t support ' +
                `route overlapping (${usedRuleRoute}, ${route}) in routing filter (${name})`
              };
            }
          }
        }
        usedRuleRoutes.add(route);

        // check priority duplications
        const p = rule.priority;
        if (usedRulePriorities.has(p)) {
          return {
            valid: false,
            err: `Duplicate priority values (${p}) in the "${name}" routing filter are not allowed`
          };
        }
        usedRulePriorities.add(p);
      }

      if (!usedRuleRoutes.has('0.0.0.0/0')) {
        return {
          valid: false,
          err: `The routing filter "${name}" must include rule for 0.0.0.0/0 route`
        };
      }
    }
  }

  const routingFilterNames = keyBy(device.routingFilters, 'name');
  const usedNeighborIps = {};
  for (const bgpNeighbor of device.bgp?.neighbors ?? []) {
    const inboundFilter = bgpNeighbor.inboundFilter;
    const outboundFilter = bgpNeighbor.outboundFilter;
    if (inboundFilter && !(inboundFilter in routingFilterNames)) {
      return {
        valid: false,
        err: `BGP neighbor ${bgpNeighbor.ip} uses an  \
        unrecognized routing filter name ("${inboundFilter}")`
      };
    }

    if (outboundFilter && !(outboundFilter in routingFilterNames)) {
      return {
        valid: false,
        err: `BGP neighbor ${bgpNeighbor.ip} uses an \
        unrecognized routing filter name ("${outboundFilter}")`
      };
    }

    const neighborIp = bgpNeighbor.ip + '/32';
    if (cidr.overlap(neighborIp, `${org.tunnelRange}/${configs.get('tunnelRangeMask')}`)) {
      return {
        valid: false,
        err:
          `The BGP Neighbor ${bgpNeighbor.ip} ` +
          'overlaps with the flexiWAN tunnel loopback range ' +
          `(${org.tunnelRange}/${configs.get('tunnelRangeMask')})`
      };
    }

    if (bgpNeighbor.ip in usedNeighborIps) {
      return {
        valid: false,
        err: 'Duplication in BGP neighbor IP is not allowed'
      };
    } else {
      usedNeighborIps[bgpNeighbor.ip] = 1;
    }
  }

  if (device.bgp?.enable) {
    const routerId = device.bgp.routerId;
    const localASN = device.bgp.localASN;
    let errMsg = '';
    const orgBgp = await getAllOrganizationBGPDevices(device.org._id);
    const routerIdExists = orgBgp.find(d => {
      if (d._id.toString() === device._id.toString()) return false;

      if (d.bgp.localASN === localASN) {
        errMsg = `Device ${d.name} already configured the requests BGP local ASN`;
        return true;
      }

      if (!routerId || routerId === '') {
        // allow multiple routerIds to be empty string or undefined
        return;
      }

      if (d.bgp.routerId === routerId) {
        errMsg = `Device ${d.name} already configured the requests BGP router ID`;
        return true;
      }
    });

    if (routerIdExists) {
      return {
        valid: false,
        err: errMsg
      };
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
    if ((ifc.dhcp === 'yes' || ifc.type === 'TRUNK') && ifc.addr === '') {
      // allow empty IP on WAN with dhcp client
      continue;
    }

    if (ifc.deviceType === 'wifi') {
      // allow empty IP on wifi access point interface
      continue;
    }

    const [ip, mask] = (ifc.addr || '/').split('/');
    const validationResult = validateIPv4Address(ip, mask);
    if (!validationResult.valid) {
      return {
        valid: false,
        err: `Bad request: ${validationResult.err}`
      };
    }
  }
  return { valid: true, err: '' };
};

const validateIPv4Address = (ip, mask) => {
  if (!ip) {
    return {
      valid: false,
      err: 'Interface does not have an IPv4 address'
    };
  }
  if (!mask) {
    return {
      valid: false,
      err: 'Interface does not have an IPv4 mask'
    };
  }
  if (!net.isIPv4(ip)) {
    return {
      valid: false,
      err: `IPv4 address ${ip}/${mask} is not valid`
    };
  };
  if (!validateIPv4Mask(mask)) {
    return {
      valid: false,
      err: `IPv4 mask ${ip}/${mask} is not valid`
    };
  };
  if (mask < 31) {
    // Based on RFC-3021, /31 point-to-point network doesn't use local and broadcast addresses
    if (isLocalOrBroadcastAddress(ip, mask)) {
      return {
        valid: false,
        err: `IP (${ip}/${mask}) cannot be Local or Broadcast address`
      };
    }
  }
  return { valid: true, err: '' };
};

const isLocalOrBroadcastAddress = (ip, mask) => {
  const [start, end] = getStartEndIp(ip, mask);
  return ip === start || ip === end;
};

/**
 * Checks whether static route is valid
 * @param {Object} device - the device to validate
 * @param {List} tunnels - list of tunnels nums of the device
 * @param {Object} route - the added/modified route
 * @return {{valid: boolean, err: string}}  test result + error, if device is invalid
 */
const validateStaticRoute = (device, tunnels, route) => {
  const { ifname, gateway, isPending, redistributeViaBGP, onLink } = route;
  const gatewaySubnet = `${gateway}/32`;

  if (redistributeViaBGP && !device.bgp.enable) {
    return {
      valid: false,
      err: 'Cannot redistribute static route via BGP. Please enable BGP first'
    };
  }

  if (ifname) {
    const ifc = device.interfaces.find(i => i.devId === ifname);
    if (ifc === undefined) {
      return {
        valid: false,
        err: `Static route interface not found '${ifname}'`
      };
    };

    // check overlapping
    //
    // if route is pending, don't check
    if (!isPending) {
      // if specified interface does not have IP throw an error.
      //
      // Note! this is temporarily fix. The route should be pending,
      // but UI sends "isPending" with "false".
      // We need to move this route to pending on DeviceService.
      // After correct fix, the below "if" block should be removed.
      if (!ifc.IPv4) {
        return {
          valid: false,
          err: `The static route via interface ${ifc.name} cannot be installed. ` +
          'The interface does not have an IP Address'
        };
      }

      if (!cidr.overlap(`${ifc.IPv4}/${ifc.IPv4Mask}`, gatewaySubnet)) {
        if (onLink !== true) { // onlink doesn't must to overlap
          return {
            valid: false,
            err: `Interface IP ${ifc.IPv4} and gateway ${gateway} are not on the same subnet`
          };
        }
      }
    }

    // Don't allow putting static route on a bridged interface
    const anotherBridgedIfc = device.interfaces.some(i => {
      return i.devId !== ifc.devId && ifc.IPv4 && i.IPv4 === ifc.IPv4 && i.isAssigned;
    });
    if (anotherBridgedIfc) {
      return {
        valid: false,
        err: 'Specify interface in static route is not allowed on a bridged interface'
      };
    }
  } else {
    let valid = device.interfaces.filter(ifc => ifc.IPv4 && ifc.IPv4Mask).some(ifc =>
      cidr.overlap(`${ifc.IPv4}/${ifc.IPv4Mask}`, gatewaySubnet)
    );
    if (!valid) {
      valid = tunnels.some(tunnel => {
        const { ip1 } = generateTunnelParams(tunnel.num, device.org.tunnelRange);
        return cidr.overlap(`${ip1}/31`, gatewaySubnet);
      });
    }
    if (!valid && !isPending) { // A pending route may not overlap with an interface
      return {
        valid: false,
        err: `Static route gateway ${gateway} not overlapped with any interface or tunnel`
      };
    }
  }
  return { valid: true, err: '' };
};

/**
 * Checks whether multilink policy device specific rules are valid
 * @param {Object} policy     - a multilink policy to validate
 * @param {Array}  devices    - an array of devices
 * @return {{valid: boolean, err: string}}  test result + error, if invalid
 */
const validateMultilinkPolicy = (policy, devices) => {
  // link-quality is supported from version 5 only
  if (devices.some(device => getMajorVersion(device.versions.agent) < 5)) {
    if (policy.rules.some(rule => {
      return (rule.action.links.some(link => {
        return link.order === 'link-quality';
      }));
    })) {
      return {
        valid: false,
        err: 'Link-quality is supported from version 5.1.X.' +
          ' Some devices have lower version'
      };
    }
  }
  return { valid: true, err: '' };
};

/**
 * Checks whether QoS policy is valid on devices
 * @param {Array}  devices    - an array of devices
 * @return {{valid: boolean, err: string}}  test result + error, if invalid
 */
const validateQOSPolicy = (devices) => {
  // QoS is supported from version 6
  if (devices.some(device => getMajorVersion(device.versions.agent) < 6)) {
    return {
      valid: false,
      err: 'QoS is supported from version 6'
    };
  }

  // QoS requires multi-core
  if (devices.some(device => getCpuInfo(device.cpuInfo).vppCores < 2)) {
    return {
      valid: false,
      err: 'QoS feature requires 3 or more CPU cores and at least 2 vRouter cores'
    };
  }

  return { valid: true, err: '' };
};

const validateOverlappingSubnets = async (org, subnets) => {
  const overlappingSubnets = [];

  if (subnets.length === 0) {
    return overlappingSubnets;
  }

  const lanOverlappingSubnets = await checkLanOverlappingWith([org._id], subnets);
  overlappingSubnets.push(...lanOverlappingSubnets.map(o => ({
    type: 'lanInterface',
    subnet: o.isOverlappingWith,
    overlappingWith: o.interfaceSubnet,
    meta: {
      interfaceName: o.interfaceName,
      deviceName: o.deviceName,
      deviceId: o._id.toString(),
      interfaceDevId: o.interfaceDevId
    }
  })));

  const tunnelRange = `${org.tunnelRange}/${configs.get('tunnelRangeMask')}`;
  const tunnelOverlappingSubnets = subnets.find(s => cidr.overlap(s, tunnelRange));
  if (tunnelOverlappingSubnets) {
    overlappingSubnets.push({
      type: 'tunnel',
      subnet: tunnelOverlappingSubnets,
      overlappingWith: tunnelRange,
      meta: {}
    });
  }

  const applicationSubnets = await appsLogic.getApplicationSubnets(org._id);
  for (const subnet of subnets) {
    for (const applicationSubnet of applicationSubnets) {
      if (cidr.overlap(subnet, applicationSubnet.subnet)) {
        overlappingSubnets.push({
          type: 'application',
          subnet: subnet,
          overlappingWith: applicationSubnet.subnet,
          meta: {
            appId: applicationSubnet._id.toString(),
            appName: applicationSubnet.name,
            deviceId: applicationSubnet.deviceId.toString(),
            deviceName: applicationSubnet.deviceName
          }
        });
      }
    }
  }

  return overlappingSubnets;
};

module.exports = {
  validateIPv4Address,
  validateDevice,
  validateDhcpConfig,
  validateStaticRoute,
  validateModifyDeviceMsg,
  validateMultilinkPolicy,
  validateQOSPolicy,
  validateOverlappingSubnets,
  validateFirewallRules,
  isLocalOrBroadcastAddress
};
