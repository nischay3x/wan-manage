// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const ObjectId = require('mongoose').Types.ObjectId;
const cidrTools = require('cidr-tools');
const applications = require('../models/applications');
const { devices } = require('../models/devices');
const diffieHellmans = require('../models/diffieHellmans');

const {
  getAvailableIps,
  getSubnetMask
} = require('../utils/networks');

const {
  generateKeys,
  generateCA,
  generateTlsKey,
  generateDhKeys
} = require('../utils/certificates');

/**
 * Get initial configuration object for VPN application
 * @return {object}
 */
const getOpenVpnInitialConfiguration = () => {
  return {
    authentications: [
      {
        type: 'G-Suite',
        enabled: false,
        domainName: '',
        group: ''
      },
      {
        type: 'Office365',
        enabled: false,
        domainName: '',
        group: ''
      }
    ]
  };
};

/**
 * Indicate if application is open vpn
 * @param {string} applicationName
 * @return {boolean}
 */
const isVpn = applicationName => {
  return applicationName === 'Open VPN';
};

/**
 * Validate vpn configurations. called when a user update the configurations
 * @param {object} configurationRequest
 * @param {objectId} applicationId
 * @param {[orgList]} orgList array of organizations
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateVpnConfiguration = async (configurationRequest, applicationId, orgList) => {
  // check if subdomain already taken
  const organization = configurationRequest.organization;
  const organizationExists = await applications.findOne(
    {
      _id: { $ne: applicationId },
      configuration: { $exists: 1 },
      'configuration.organization': organization
    }
  );

  if (organizationExists) {
    return {
      valid: false,
      err: 'This organization already taken. please choose other'
    };
  }

  // validate subnets
  if (configurationRequest.remoteClientIp && configurationRequest.connectionsPerDevice) {
    const subnetsCount = getTotalSubnets(
      configurationRequest.remoteClientIp, configurationRequest.connectionsPerDevice
    ).length;

    const installedDevices = await devices.find({
      org: { $in: orgList },
      'applications.applicationInfo': applicationId,
      $or: [
        { 'applications.status': 'installed' },
        { 'applications.status': 'installing' }
      ]
    });

    if (installedDevices.length > subnetsCount) {
      return {
        valid: false,
        err: 'There is more installed devices then subnets. Please increase your subnets'
      };
    }
  }

  return { valid: true, err: '' };
};

/**
 * Calculate the entire subnets configure by the user
 * @param {string} remoteClientIp
 * @param {string} connectionsPerDevice
 * @return {[string]}  array of all subnets
 */
const getTotalSubnets = (remoteClientIp, connectionsPerDevice) => {
  const mask = remoteClientIp.split('/').pop();

  // get the new subnets mask for splitted subnets
  const deviceMask = getSubnetMask(connectionsPerDevice);

  // get ip range for this mask
  const availableIpsCount = getAvailableIps(mask);

  // get subnets count for this org
  const subnetsCount = availableIpsCount / connectionsPerDevice;

  const ips = cidrTools.expand(remoteClientIp);

  const subnets = [];
  for (let i = 0; i < subnetsCount; i++) {
    subnets.push(`${ips[i * connectionsPerDevice]}/${deviceMask}`);
  };

  return subnets;
};

/**
 * Get the subnet that will be assigned to the device
 * @param {object} config configuration object
 * @param {ObjectID} deviceId the if of the device to be assigned
 * @return {{device: ObjectID, subnet: string}}  object of subnet to be assigned
 */
const getFreeSubnet = (config, deviceId = '') => {
  // check if has available subnet to assign
  const totalSubnets = getTotalSubnets(config.remoteClientIp, config.connectionsPerDevice);

  const assignedSubnets = config.subnets || [];

  // if subnet already assigned to this device, return the subnet
  const exists = assignedSubnets.find(
    s => s.device && (s.device.toString() === deviceId)
  );
  if (exists) return exists;

  // get the first subnet that not exists in assignedSubnets
  const freeSubnet = totalSubnets.find(s => {
    return assignedSubnets.findIndex(as => as.subnet === s) === -1;
  });

  return {
    device: ObjectId(deviceId),
    subnet: freeSubnet
  };
};

const onVpnJobComplete = async (org, app, op, deviceId) => {
  if (op === 'uninstall') {
    // release the subnet if deploy job removed
    await releaseSubnetForDevice(org, app._id, ObjectId(deviceId));
  }
};

const onVpnJobRemoved = async (org, app, op, deviceId) => {
  if (op === 'deploy') {
    // release the subnet if deploy job removed
    await releaseSubnetForDevice(org, app._id, ObjectId(deviceId));
  }
};

const onVpnJobFailed = async (org, app, op, deviceId) => {
  if (op === 'deploy') {
    // release the subnet if deploy job removed
    await releaseSubnetForDevice(org, app._id, ObjectId(deviceId));
  }
};

/**
 * Release subnet assigned to device
 * @async
 * @param  {ObjectId} org org id to filter by
 * @param  {ObjectId} appId app id to filter by
 * @param  {ObjectId} deviceId device to release
 * @return {void}
 */
const releaseSubnetForDevice = async (org, appId, deviceId) => {
  await applications.updateOne(
    { org: org, _id: appId },
    { $pull: { 'configuration.subnets': { device: ObjectId(deviceId) } } }
  );
};

/**
 * Validate application. called before starting to install application on the devices
 * @param {object} app the application will be installed
 * @param {string} op the operation of the job (deploy, config, etc.)
 * @param {[ObjectID]} deviceIds the devices id, that application should installed on them
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateVpnApplication = (app, op, deviceIds) => {
  if (op === 'deploy') {
    // prevent installation if there are missing required configurations
    if (!app.configuration.remoteClientIp || !app.configuration.connectionsPerDevice) {
      return {
        valid: false,
        err: 'Required configurations is missing, please check again the configurations'
      };
    }

    // prevent installation if selected more devices then subnets
    const takenSubnets = app.configuration.subnets ? app.configuration.subnets.length : 0;
    const freeSubnets = getTotalSubnets(
      app.configuration.remoteClientIp,
      app.configuration.connectionsPerDevice
    ).length - takenSubnets;

    // create a new devicesIds array without subnet
    const deviceWithoutSubnets = deviceIds.filter(d => {
      return app.configuration.subnets.findIndex(s => s.device.toString() === d.toString()) === -1;
    });

    const isMoreDevicesThenSubnets = freeSubnets < deviceWithoutSubnets.length;

    if (isMoreDevicesThenSubnets) {
      return {
        valid: false,
        err: 'There is no subnets remaining. Please check again the configurations'
      };
    }
  }

  return { valid: true, err: '' };
};

/**
 * Generate key for vpn server
 * @param {object} application the application to generate for
 * @return {{
    isNew: boolean
    caPrivateKey: string
    caPublicKey: string
    serverKey: string
    serverCrt: string
    tlsKey: string
    dhKey: string
  }}  the keys to send to device
 */
const getDeviceKeys = async application => {
  let isNew = false;
  let caPrivateKey;
  let caPublicKey;
  let serverKey;
  let serverCrt;
  let tlsKey;
  let dhKey;

  if (!application.configuration.keys) {
    isNew = true;
    const ca = generateCA();
    const server = generateKeys(ca.privateKey);
    tlsKey = generateTlsKey();
    caPrivateKey = ca.privateKey;
    caPublicKey = ca.publicKey;
    serverKey = server.privateKey;
    serverCrt = server.publicKey;

    const dhKeyDoc = await diffieHellmans.findOneAndRemove();
    if (!dhKeyDoc) dhKey = generateDhKeys();
    else dhKey = dhKeyDoc.key;
  } else {
    caPrivateKey = application.configuration.keys.caKey;
    caPublicKey = application.configuration.keys.caCrt;
    serverKey = application.configuration.keys.serverKey;
    serverCrt = application.configuration.keys.serverCrt;
    tlsKey = application.configuration.keys.tlsKey;
    dhKey = application.configuration.keys.dhKey;
  }

  return {
    isNew: isNew,
    caPrivateKey,
    caPublicKey,
    serverKey,
    serverCrt,
    tlsKey,
    dhKey
  };
};

/**
 * Generate params object to be sent to the device
 * @param {object} device the device to get params for
 * @param {string} applicationId the application id to be installed
 * @param {string} op the operation of the job (deploy, config, etc.)
 * @return {object} params to be sent to device
*/
const getOpenVpnParams = async (device, applicationId, op) => {
  const params = {};
  const { _id, interfaces } = device;

  const application = await applications.findOne({ _id: applicationId })
    .populate('libraryApp').lean();
  const config = application.configuration;

  if (op === 'deploy' || op === 'config' || op === 'upgrade') {
    // get the WanIp to be used by open vpn server to listen
    const wanIp = interfaces.find(ifc => ifc.type === 'WAN' && ifc.isAssigned).IPv4;

    // get new subnet only if there is no subnet connect with current device
    const deviceSubnet = getFreeSubnet(config, _id.toString());

    const update = {
      $set: {},
      $addToSet: {
        'configuration.subnets': deviceSubnet
      }
    };

    const {
      isNew, caPrivateKey, caPublicKey,
      serverKey, serverCrt, tlsKey, dhKey
    } = await getDeviceKeys(application);

    // if is new keys, save them on db
    if (isNew) {
      update.$set['configuration.keys.caKey'] = caPrivateKey;
      update.$set['configuration.keys.caCrt'] = caPublicKey;
      update.$set['configuration.keys.serverKey'] = serverKey;
      update.$set['configuration.keys.serverCrt'] = serverCrt;
      update.$set['configuration.keys.tlsKey'] = tlsKey;
      update.$set['configuration.keys.dhKey'] = dhKey;
    }

    // set subnet to device to prevent same subnet on multiple devices
    await applications.updateOne({ _id: application._id }, update);

    let version = application.installedVersion;
    if (op === 'upgrade') {
      version = application.app.latestVersion;
    }

    const dnsIp = config.dnsIp && config.dnsIp !== ''
      ? config.dnsIp.split(';') : [];

    const dnsDomain = config.dnsDomain && config.dnsDomain !== ''
      ? config.dnsDomain.split(';') : [];

    params.version = version;
    params.routeAllOverVpn = config.routeAllOverVpn || false;
    params.remoteClientIp = deviceSubnet.subnet;
    params.deviceWANIp = wanIp;
    params.caKey = caPrivateKey;
    params.caCrt = caPublicKey;
    params.serverKey = serverKey;
    params.serverCrt = serverCrt;
    params.tlsKey = tlsKey;
    params.dnsIp = dnsIp;
    params.dnsName = dnsDomain;
    params.dhKey = dhKey;
  }

  return params;
};

module.exports = {
  isVpn,
  getOpenVpnInitialConfiguration,
  validateVpnConfiguration,
  getFreeSubnet,
  onVpnJobComplete,
  onVpnJobRemoved,
  onVpnJobFailed,
  validateVpnApplication,
  getOpenVpnParams
};
