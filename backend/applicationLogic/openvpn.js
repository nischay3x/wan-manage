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
const applications = require('../models/applications');
const devices = require('../models/devices');
const createError = require('http-errors');

const {
  generateKeys,
  generateCA,
  generateTlsKey,
  generateDhKeys
} = require('../utils/certificates');
const diffieHellmans = require('../models/diffieHellmans');

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

const isVpn = applicationName => {
  return applicationName === 'Open VPN';
};

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

  // check subnets
  if (configurationRequest.subnets) {
    const installedDevices = await devices.find({
      org: { $in: orgList },
      'applications.applicationInfo': applicationId,
      $or: [
        { 'applications.status': 'installed' },
        { 'applications.status': 'installing' }
      ]
    });

    if (installedDevices.length > configurationRequest.subnets.length) {
      return {
        valid: false,
        err: 'There is more installed devices then subnets. Please increase your subnets'
      };
    }
  }

  return { valid: true, err: '' };
};

const getDeviceSubnet = (subnets, deviceId) => {
  // if subnet already assigned to this device, return the subnet
  const exists = subnets.find(
    s => s.device && (s.device.toString() === deviceId)
  );

  if (exists) return exists;
  else return subnets.find(s => s.device === null);
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
    {
      org: org,
      _id: appId,
      'configuration.subnets.device': ObjectId(deviceId)
    },
    { $set: { 'configuration.subnets.$.device': null } }
  );
};

const validateVpnApplication = (app, op, deviceIds) => {
  if (op === 'deploy') {
    // prevent installation if there are missing required configurations
    if (!app.configuration.remoteClientIp || !app.configuration.connectionsPerDevice) {
      return {
        valid: false,
        err: 'Required configurations is missing, please check again the configurations'
      };
    }

    // prevent installation if all the subnets is already taken by other devices
    // or if the user selected multiple devices to install
    // but there is not enoughs subnets
    const freeSubnets = app.configuration.subnets.filter(s => {
      if (s.device === null) return true;
      const isCurrentDevice = deviceIds.map(d => d.toString()).includes(s.device.toString());
      return isCurrentDevice;
    });

    if (freeSubnets.length === 0 || freeSubnets.length < deviceIds.length) {
      return {
        valid: false,
        err: 'There is no subnets remaining, please check again the configurations'
      };
    }
  }

  return { valid: true, err: '' };
};

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
    const deviceSubnet = getDeviceSubnet(config.subnets, _id.toString());

    // deviceSubnet equal to null means
    // that vpn installed on more devices then assigned subnets
    if (!deviceSubnet) {
      const msg = 'You don\'t have enoughs subnets to all devices';
      throw createError(500, msg);
    }

    const update = {
      'configuration.subnets.$.device': _id
    };

    const {
      isNew, caPrivateKey, caPublicKey,
      serverKey, serverCrt, tlsKey, dhKey
    } = await getDeviceKeys(application);

    // if is new keys, save them on db
    if (isNew) {
      update['configuration.keys.caKey'] = caPrivateKey;
      update['configuration.keys.caCrt'] = caPublicKey;
      update['configuration.keys.serverKey'] = serverKey;
      update['configuration.keys.serverCrt'] = serverCrt;
      update['configuration.keys.tlsKey'] = tlsKey;
      update['configuration.keys.dhKey'] = dhKey;
    }

    // set subnet to device to prevent same subnet on multiple devices
    await applications.updateOne(
      {
        _id: application._id,
        'configuration.subnets.subnet': deviceSubnet.subnet
      },
      { $set: update }
    );

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
  getDeviceSubnet,
  onVpnJobComplete,
  onVpnJobRemoved,
  onVpnJobFailed,
  validateVpnApplication,
  getOpenVpnParams
};
