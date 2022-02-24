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

const Joi = require('joi');
const pick = require('lodash/pick');
const omit = require('lodash/omit');
const cidr = require('cidr-tools');
const applications = require('../models/applications');
const vpnUniqueUsers = require('../models/vpnUniqueUsers');
const organizations = require('../models/organizations');
const { devices } = require('../models/devices');
const diffieHellmans = require('../models/diffieHellmans');
const {
  validateFQDN
} = require('../models/validators');
const configs = require('../configs')();
const {
  getAvailableIps,
  getSubnetMask,
  getStartIp
} = require('../utils/networks');

const {
  getAllOrganizationSubnets
} = require('../utils/orgUtils');

const {
  generateRemoteVpnPKI,
  generateTlsKey
} = require('../utils/certificates');

const flexibilling = require('../flexibilling');

const vpnIdentifier = 'com.flexiwan.remotevpn';
/**
 * Indicate if application is remote worker vpn
 * @param {string} applicationName
 * @return {boolean}
 */
const isVpn = applicationIdentifier => {
  return applicationIdentifier === vpnIdentifier;
};

const allowedFields = [
  'networkId',
  'serverPort',
  'routeAllTrafficOverVpn',
  'dnsIps',
  'dnsDomains',
  'authentications',
  'allowedPortalUsers'
];

const secretFields = [
  'keys'
  // TODO: what about private key of gsuite service account?
];

const pickOnlyVpnAllowedFields = configurationRequest => {
  return pick(configurationRequest, allowedFields);
};

const vpnConfigSchema = Joi.object().keys({
  networkId: Joi.string().pattern(/^[A-Za-z0-9]+$/).min(3).max(20).required(),
  serverPort: Joi.number().port().required(),
  routeAllTrafficOverVpn: Joi.boolean().required(),
  allowedPortalUsers: Joi.number().min(1).required(),
  dnsIps: Joi.string().custom((val, helpers) => {
    const domainList = val.split(/\s*,\s*/);

    const ipSchema = Joi.string().ip({ version: ['ipv4'], cidr: 'forbidden' });

    const valid = domainList.every(d => {
      const res = ipSchema.validate(d);
      return res.error === undefined;
    });

    if (valid) {
      return val;
    } else {
      return helpers.message('dnsIps is not valid');
    }
  }).allow('').optional(),
  dnsDomains: Joi.string().custom((val, helpers) => {
    const domainList = val.split(/\s*,\s*/);
    const valid = domainList.every(d => validateFQDN(d));
    if (!valid) {
      return helpers.message('dnsDomains is not valid');
    };

    return val;
  }).allow('').optional(),
  authentications: Joi.object({
    gsuite: Joi.object().keys({
      enabled: Joi.boolean().required(),
      domains: Joi.array().items(Joi.object().keys({
        domain: Joi.string().required().pattern(/^\S+$/, 'domain without whitespace'),
        groups: Joi.string().required().allow(''),
        clientEmail: Joi.string().when('groups', {
          is: '',
          then: Joi.allow(''),
          otherwise: Joi.string().email()
        }).required(),
        privateKey: Joi.string().when('groups', {
          is: '',
          then: Joi.allow(''),
          otherwise: Joi.string()
        }).required(),
        impersonateEmail: Joi.string().when('groups', {
          is: '',
          then: Joi.allow(''),
          otherwise: Joi.string().email()
        }).required()
      })).required().when('enabled', { is: true, then: Joi.array().min(1) })
    }).required(),
    office365: Joi.object().keys({
      enabled: Joi.boolean().required(),
      domains: Joi.array().items(Joi.object().keys({
        domain: Joi.string().required().pattern(/^\S+$/, 'domain without whitespace'),
        groups: Joi.string().required().allow('')
      })).required().when('enabled', { is: true, then: Joi.array().min(1) })
    }).required(),
    flexiManage: Joi.object().keys({
      enabled: Joi.boolean().required()
    }).required()
  })
});

/**
 * Validate vpn configurations. called when a user update the configurations
 * @param {object} configurationRequest
 * @param {objectId} application
 * @param {objectId} accountId accountId
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateVpnConfiguration = async (configurationRequest, application, account) => {
  // validate user inputs
  const result = vpnConfigSchema.validate(configurationRequest);
  if (result.error) {
    return { valid: false, err: `${result.error.details[0].message}` };
  }

  // check if unique networkId already taken
  const networkId = configurationRequest.networkId;
  const regex = new RegExp(`\\b${networkId}\\b`, 'i');
  const existsNetworkId = await applications.findOne(
    {
      _id: { $ne: application._id },
      configuration: { $exists: 1 },
      'configuration.networkId': { $regex: regex, $options: 'i' }
    }
  );

  if (existsNetworkId) {
    const err = 'This workspace name is already in use by another account or organization. ' +
    'Please choose another workspace name';
    return { valid: false, err: err };
  }

  // get users portal numbers configured for the entire account
  // *except* of the requested application
  const usedPortalUsers = await getConfiguredPortalUsers(account._id, null, [application.org]);

  // add to the updated value to the count number
  const requestedPortalUsers = parseInt(configurationRequest.allowedPortalUsers);
  const totalPortalUsers = usedPortalUsers + requestedPortalUsers;

  // check if the total is more than the allowed for this account
  const accountId = account._id.toString();
  const allowedPortalUsers = await flexibilling.getFeatureMax(accountId, 'vpn_portal_users');

  if (totalPortalUsers > allowedPortalUsers) {
    const err =
    `You reached the maximum number of allowed portal users included
    in your current plan for the entire account. ` +
    `Please contact us at ${configs.get('contactUsEmail')} to add more connections`;
    return { valid: false, err: err };
  }

  return { valid: true, err: '' };
};

/**
 * Get the closest number of IP addresses valid range
 * @param {string} connectionsPerDevice
 * @return {number}  number of splitted subnets
 */
const getClosestIpRangeNumber = number => {
  // The number of IP addresses in a subnet must be in the power of two.
  // That's why we need to get the closest number of IP addresses
  // out of the "connections" value.
  if (number > 8 && (Math.log(number) / Math.log(2)) % 1 === 0) {
    return number;
  }

  let p = 2;
  // eslint-disable-next-line no-cond-assign
  while (number >>= 1) {
    p <<= 1;
  }

  // vpn server range should be minimum /29 (8 ips)
  if (p < 8) {
    p = 8;
  }

  return p;
};

const vpnDeviceConfigSchema = Joi.object().keys({
  connectionsNumber: Joi.number().min(1).required(),
  networkStartIp: Joi.string().ip({ version: ['ipv4'] }).required()
});

const getVpnDeviceSpecificConfiguration = (app, device, deviceConfiguration, idx) => {
  const startIp = deviceConfiguration.networkStartIp;

  const addresses = getClosestIpRangeNumber(deviceConfiguration.connectionsNumber);
  const deviceMask = getSubnetMask(addresses);
  const range = getAvailableIps(deviceMask);

  const deviceStartIp = getStartIp(startIp, parseInt(deviceMask), range * idx);
  const subnet = `${deviceStartIp}/${deviceMask}`;

  return { subnet, connections: deviceConfiguration.connectionsNumber };
};

const validateVPNUninstallRequest = async (app, deviceList) => {
  // check if firewall rules applied on the application interface
  for (const dev of deviceList) {
    if (!dev.firewall) continue;
    if (!dev.firewall.rules) continue;
    const outbound = dev.firewall.rules.some(r => {
      return r.direction === 'outbound' &&
        r.interfaces.some(ri => `app_${app.appStoreApp.identifier}`);
    });

    if (outbound) {
      return {
        valid: false,
        err: `An outbound rule is configured for the application.
          Please remove it before uninstalling the application`
      };
    }
  }

  return { valid: true, err: '' };
};

/**
 * Validate device specific configuration request
 * @param {object} app the application will be installed
 * @param {string} op the operation of the job (install, config, etc.)
 * @param {[ObjectID]} deviceIds the devices id, that application should installed on them
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateVpnDeviceConfigurationRequest = async (app, deviceConfiguration, deviceList) => {
  // prevent installation if there are missing required configurations
  // validate user inputs
  const result = vpnDeviceConfigSchema.validate(deviceConfiguration);
  if (result.error) {
    return { valid: false, err: `${result.error.details[0].message}` };
  }

  // make sure that requested VPN network is not overlapped with other networks in the org
  const startIp = deviceConfiguration.networkStartIp;
  const addresses = getClosestIpRangeNumber(deviceConfiguration.connectionsNumber);
  const deviceMask = getSubnetMask(addresses);
  const range = getAvailableIps(deviceMask);

  const vpnServerNetworks = deviceList.map((dev, idx) => {
    const deviceStartIp = getStartIp(startIp, parseInt(deviceMask), range * idx);
    return `${deviceStartIp}/${deviceMask}`;
  });

  const orgSubnets = await getAllOrganizationSubnets(app.org);

  // we don't need to check of network is overlapping with the vpn networks of the selected device
  const orgToCheck = orgSubnets.filter(o => {
    if (o.type !== 'application') return true;
    if (o._id.toString() !== app._id.toString()) return true;

    const isSelectedDevice = deviceList.find(d => d._id.toString() === o.deviceId.toString());
    if (!isSelectedDevice) return true;

    return false;
  });

  for (const orgSubnet of orgToCheck) {
    for (const vpnServerNetwork of vpnServerNetworks) {
      if (cidr.overlap(orgSubnet.subnet, vpnServerNetwork)) {
        let overlapsWith = 'some network in your organization';
        if (orgSubnet.type === 'interface') {
          overlapsWith = `device ${orgSubnet.name}`;
        } else if (orgSubnet.type === 'tunnel') {
          overlapsWith = `tunnel #${orgSubnet.num}`;
        } else if (orgSubnet.type === 'application') {
          overlapsWith = `application ${orgSubnet.name} in device ${orgSubnet.deviceName}`;
        }

        return {
          valid: false,
          err: `VPN network ${vpnServerNetwork} overlaps
          with ${orgSubnet.subnet} defined on ${overlapsWith}`
        };
      }
    }
  }

  // Prevent setting LAN network that overlaps the network we are using for tunnels.
  for (const vpnServerNetwork of vpnServerNetworks) {
    if (cidr.overlap(vpnServerNetwork, '10.100.0.0/16')) {
      return {
        valid: false,
        err:
        `The subnet ${vpnServerNetwork} overlaps
        with the flexiWAN tunnel loopback range (10.100.0.0/16)`
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
    caKey: string
    caCrt: string
    serverKey: string
    serverCrt: string
    clientKey: string
    clientCrt: string
    tlsKey: string
    dhKey: string
  }}  the keys to send to device
 */
const getDeviceKeys = async application => {
  let isNew = false;
  let caKey;
  let caCrt;
  let serverKey;
  let serverCrt;
  let clientKey;
  let clientCrt;
  let tlsKey;
  let dhKey;

  if (!application.configuration.keys) {
    isNew = true;
    const pems = await generateRemoteVpnPKI(application.org.toString());

    caKey = pems.caKey;
    caCrt = pems.caCert;
    serverKey = pems.serverKey;
    serverCrt = pems.serverCert;
    clientKey = pems.clientKey;
    clientCrt = pems.clientCert;

    tlsKey = generateTlsKey();

    const dhKeyDoc = await diffieHellmans.findOne();
    if (!dhKeyDoc) {
      // DH stack should be fulfilled automatically in vpn portal server
      throw new Error(
        'An error occurred while creating a DH key for your organization. Please try again later');
    }

    dhKey = dhKeyDoc.key;
    await diffieHellmans.remove({ _id: dhKeyDoc._id });
  } else {
    caKey = application.configuration.keys.caKey;
    caCrt = application.configuration.keys.caCrt;
    serverKey = application.configuration.keys.serverKey;
    serverCrt = application.configuration.keys.serverCrt;
    clientKey = application.configuration.keys.clientKey;
    clientCrt = application.configuration.keys.clientCrt;
    tlsKey = application.configuration.keys.tlsKey;
    dhKey = application.configuration.keys.dhKey;
  }

  return {
    isNew: isNew,
    caKey,
    caCrt,
    serverKey,
    serverCrt,
    clientKey,
    clientCrt,
    tlsKey,
    dhKey
  };
};

/**
 * Generate params object to be sent to the device
 * @param {object} device the device to get params for
 * @param {object} application the application to be installed
 * @param {string} op the operation of the job (install, config, etc.)
 * @return {object} params to be sent to device
*/
const getRemoteVpnParams = async (device, application, op) => {
  const params = {};
  const config = application.configuration;

  if (op === 'config') {
    const {
      isNew, caKey, caCrt,
      serverKey, serverCrt, clientKey, clientCrt, tlsKey, dhKey
    } = await getDeviceKeys(application);

    // if is new keys, save them on db
    if (isNew) {
      const query = { _id: application._id };
      const update = {
        $set: {
          'configuration.keys.caKey': caKey,
          'configuration.keys.caCrt': caCrt,
          'configuration.keys.serverKey': serverKey,
          'configuration.keys.serverCrt': serverCrt,
          'configuration.keys.clientKey': clientKey,
          'configuration.keys.clientCrt': clientCrt,
          'configuration.keys.tlsKey': tlsKey,
          'configuration.keys.dhKey': dhKey
        }
      };
      await applications.updateOne(query, update);
    }

    const dnsIps = config.dnsIps && config.dnsIps !== ''
      ? config.dnsIps.split(/\s*,\s*/) : [];

    const dnsDomains = config.dnsDomains && config.dnsDomains !== ''
      ? config.dnsDomains.split(/\s*,\s*/) : [];

    params.routeAllTrafficOverVpn = config.routeAllTrafficOverVpn || false;
    params.port = config.serverPort ? config.serverPort : '';
    params.caKey = caKey;
    params.caCrt = caCrt;
    params.serverKey = serverKey;
    params.serverCrt = serverCrt;
    params.tlsKey = tlsKey;
    params.dnsIps = dnsIps;
    params.dnsDomains = dnsDomains;
    params.dhKey = dhKey;
    params.vpnPortalServer = configs.get('flexiVpnServer');

    // get per device configuration
    const deviceApplication = device.applications.find(
      a => a.app._id.toString() === application._id.toString());
    params.vpnNetwork = deviceApplication.configuration.subnet;
    params.connections = deviceApplication.configuration.connections;
  }

  return params;
};

const needToUpdatedVpnServers = (oldConfig, updatedConfig) => {
  if (oldConfig.serverPort !== updatedConfig.serverPort) return true;
  if (oldConfig.dnsIps !== updatedConfig.dnsIps) return true;
  if (oldConfig.dnsDomains !== updatedConfig.dnsDomains) return true;
  if (oldConfig.routeAllTrafficOverVpn !== updatedConfig.routeAllTrafficOverVpn) return true;
  return false;
};

const getVpnSubnets = async app => {
  const apps = await devices.aggregate([
    { $match: { org: app.org, 'applications.app': app._id } },
    {
      $project: {
        _id: 1,
        name: 1,
        applications: {
          $filter: { input: '$applications', cond: { $eq: ['$$this.app', app._id] } }
        }
      }
    },
    { $unwind: { path: '$applications' } },
    {
      $project: {
        subnet: '$applications.configuration.subnet',
        deviceName: '$name',
        deviceId: '$_id'
      }
    }
  ]).allowDiskUse(true);

  return apps;
};

const getConfiguredPortalUsers = async (account, org = null, exclude = null) => {
  const match = {
    account: account
  };

  if (org) match._id = org;
  if (exclude) match._id = { $nin: exclude };

  const pipeline = [
    { $match: match },
    { $project: { _id: 1 } },
    {
      $lookup: {
        from: 'applications',
        localField: '_id',
        foreignField: 'org',
        as: 'applications'
      }
    },
    { $unwind: { path: '$applications' } },
    {
      $lookup: {
        from: 'applicationStore',
        localField: 'applications.appStoreApp',
        foreignField: '_id',
        as: 'appStoreApp'
      }
    },
    { $unwind: { path: '$appStoreApp' } },
    { $match: { 'appStoreApp.identifier': vpnIdentifier } },
    { $project: { users: { $toInt: '$applications.configuration.allowedPortalUsers' } } },
    { $group: { _id: null, count: { $sum: '$users' } } }
  ];

  let portalUsers = await organizations.aggregate(pipeline).allowDiskUse(true);
  portalUsers = portalUsers.length > 0 ? portalUsers[0].count : 0;
  return portalUsers;
};

const updateVpnBilling = async (app) => {
  const org = await organizations.findOne({ _id: app.org }, 'account').lean();

  const { orgConnections, accountConnections } = await getVpnBillingData(org.account, app.org);

  await flexibilling.updateFeature(
    org.account, app.org, 'vpn_portal_users', accountConnections, orgConnections);
};

const selectVpnConfigurationParams = configuration => {
  const res = omit(configuration, secretFields);
  return res;
};

const getVpnBillingData = async (account, org) => {
  const orgConnections = await getConfiguredPortalUsers(account, org, null);
  const accountConnections = await getConfiguredPortalUsers(account, null, null);
  return { orgConnections, accountConnections };
};

const getVpnStatus = async (account, org) => {
  const status = {};
  const { orgConnections, accountConnections } = await getVpnBillingData(account, org);
  status.orgConnections = orgConnections;
  status.accountConnections = accountConnections;

  const uniqueUsers = await vpnUniqueUsers.findOne({ organizationId: org });
  status.actualConnections = uniqueUsers ? uniqueUsers.uniqueUsers : [];

  return status;
};

module.exports = {
  isVpn,
  validateVpnConfiguration,
  validateVpnDeviceConfigurationRequest,
  validateVPNUninstallRequest,
  pickOnlyVpnAllowedFields,
  getRemoteVpnParams,
  needToUpdatedVpnServers,
  getVpnDeviceSpecificConfiguration,
  updateVpnBilling,
  getVpnSubnets,
  selectVpnConfigurationParams,
  getVpnStatus
};
