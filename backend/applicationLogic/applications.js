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

const applications = require('../models/applications');

const {
  isVpn,
  validateVpnConfiguration,
  validateVpnDeviceConfigurationRequest,
  validateVPNUninstallRequest,
  getRemoteVpnParams,
  pickOnlyVpnAllowedFields,
  needToUpdatedVpnServers,
  getVpnDeviceSpecificConfiguration,
  updateVpnBilling,
  getVpnSubnets,
  selectVpnConfigurationParams,
  getVpnStatus
} = require('./remotevpn');

/**
 * Pick the allowed fields only from client request.
 *
 * Since the configuration in our database is a mixed object,
 * We give the app developer the option to choose which data he wants to save.
 * If this function is not implemented,
 * all information sent from the user will be stored in the database.
 * @param  {object}  configurationRequest  user configuration request
 * @param  {object}  app application object
 * @return {object}  object with allowed fields only.
 */
const pickAllowedFieldsOnly = (configurationRequest, app) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return pickOnlyVpnAllowedFields(configurationRequest, app);
  } else {
    return configurationRequest;
  }
};

/**
 * Validate the global application configuration request sent by the user.
 *
 * @param  {object} configurationRequest  user request for global configuration
 * @param  {object} app application object
 * @param  {object} account account object
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateConfiguration = async (configurationRequest, app, account) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return await validateVpnConfiguration(configurationRequest, app, account);
  } else {
    return { valid: false, err: 'Invalid application' };
  }
};

/**
 * Validate the device specific application configuration request that sent by the user.
 *
 * @param  {object}     app application object
 * @param  {object}     deviceConfiguration  user request for device configuration
 * @param  {[objectId]} deviceList the devices ids list, that application should installed on them
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateDeviceConfigurationRequest = async (app, deviceConfiguration, deviceList) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return validateVpnDeviceConfigurationRequest(app, deviceConfiguration, deviceList);
  };

  return { valid: false, err: 'Invalid application' };
};

/**
 * Validate uninstall request.
 *
 * @param  {object}   app application object
 * @param  {[objectId]} deviceList the devices ids list, that application should installed on them
 * @return {{valid: boolean, err: string}}  test result + error if message is invalid
 */
const validateUninstallRequest = async (app, deviceList) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return validateVPNUninstallRequest(app, deviceList);
  };

  return { valid: false, err: 'Invalid application' };
};

const getDeviceSpecificConfiguration = (app, device, deviceConfiguration, idx) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return getVpnDeviceSpecificConfiguration(app, device, deviceConfiguration, idx);
  }
  return null;
};

const updateApplicationBilling = async (app) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return updateVpnBilling(app);
  }
  return null;
};

const getAppAdditionsQuery = (app, device, op) => {
  const _getVal = val => {
    if (typeof val !== 'string') return val;
    // variable is text within ${}, e.g. ${serverPort}
    // we are taking this text and replace it with the same key in the app configuration object
    const matches = val.match(/\${.+?}/g);
    if (matches) {
      for (const match of matches) {
        const confKey = match.match(/(?<=\${).+?(?=})/);
        val = val.replace(match, app.configuration[confKey]);
      }
    }
    return val;
  };

  const query = {};

  const version = app.appStoreApp.versions.find(v => {
    return v.version === app.installedVersion;
  });

  if (!('installWith' in version)) return query;

  if ('firewallRules' in version.installWith) {
    const requestedRules = version.installWith.firewallRules;

    // take out the related firewall rules
    const updatedFirewallRules = device.firewall.rules.filter(r => {
      if (!r.reference) return true; // keep non-referenced rules
      return r.reference.toString() !== app._id.toString();
    });

    // in add operation - add the needed firewall rules
    if (op === 'install' || op === 'config') {
      const lastSysRule = updatedFirewallRules
        .filter(r => r.system)
        .sort((a, b) => b.priority - a.priority).pop();

      let initialPriority = -1;
      if (lastSysRule) {
        initialPriority = lastSysRule.priority - 1;
      }

      for (const rule of requestedRules) {
        updatedFirewallRules.push({
          system: true,
          reference: app._id,
          referenceModel: 'applications',
          description: _getVal(rule.description),
          priority: initialPriority,
          direction: _getVal(rule.direction),
          interfaces: _getVal(rule.interfaces),
          inbound: _getVal(rule.inbound),
          classification: {
            destination: {
              ipProtoPort: {
                ports: _getVal(rule.destination.ports),
                protocols: _getVal(rule.destination.protocols)
              }
            }
          }
        });

        initialPriority--;
      }
    }

    query['firewall.rules'] = updatedFirewallRules;
  }

  return query;
};

/**
 * Creates the job parameters based on application name.
 * @async
 * @param  {Object}   device      device to be modified
 * @param  {Object}   application application object
 * @param  {String}   op          operation type
 * @return {Object}               parameters object
 */
const getJobParams = async (device, application, op) => {
  let params = {
    name: application.appStoreApp.name,
    identifier: application.appStoreApp.identifier
  };

  const version = application.appStoreApp.versions.find(v => {
    return v.version === application.installedVersion;
  });

  if (!version) {
    throw new Error('Invalid installed version');
  }

  if (isVpn(application.appStoreApp.identifier)) {
    const vpnParams = await getRemoteVpnParams(device, application, op);
    if (op === 'install') {
      params = { ...params, ...vpnParams };

      // for install job, we passed the config parameters as well
      const vpnConfigParams = await getRemoteVpnParams(device, application, 'config');
      vpnConfigParams.identifier = application.appStoreApp.identifier;
      params = { ...params, configParams: vpnConfigParams };
    } else {
      params = { ...params, ...vpnParams };
    }
  }

  return params;
};

const saveConfiguration = async (application, updatedConfig, isNeedToUpdatedDevices) => {
  const updatedApp = await applications.findOneAndUpdate(
    { _id: application._id },
    { $set: { configuration: updatedConfig } },
    { new: true, upsert: false, runValidators: true }
  ).populate('appStoreApp').lean();

  await updateApplicationBilling(updatedApp);

  return updatedApp;
};

const needToUpdatedDevices = (application, oldConfig, newConfig) => {
  if (isVpn(application.appStoreApp.identifier)) {
    return needToUpdatedVpnServers(oldConfig, newConfig);
  } else {
    return true;
  };
};

const getApplicationSubnet = async application => {
  if (isVpn(application.appStoreApp.identifier)) {
    return getVpnSubnets(application);
  } else {
    return [];
  };
};

const getApplicationSubnets = async orgId => {
  const apps = await applications.find({ org: orgId }).populate('appStoreApp').lean();
  const subnets = [];
  for (const app of apps) {
    const appSubnet = await getApplicationSubnet(app);
    const parsed = appSubnet.map(s => {
      return {
        _id: app._id,
        deviceId: s.deviceId,
        type: 'application',
        deviceName: s.deviceName,
        name: app.appStoreApp.name,
        subnet: s.subnet
      };
    });
    subnets.push(...parsed);
  }

  return subnets;
};

const selectConfigurationParams = (identifier, configuration) => {
  if (isVpn(identifier)) {
    return selectVpnConfigurationParams(configuration);
  } else {
    return true;
  };
};

const getApplicationStatus = (identifier, account, org) => {
  if (isVpn(identifier)) {
    return getVpnStatus(account, org);
  } else {
    return {};
  };
};

module.exports = {
  validateConfiguration,
  pickAllowedFieldsOnly,
  validateDeviceConfigurationRequest,
  validateUninstallRequest,
  getJobParams,
  saveConfiguration,
  needToUpdatedDevices,
  getAppAdditionsQuery,
  getDeviceSpecificConfiguration,
  getApplicationSubnets,
  selectConfigurationParams,
  updateApplicationBilling,
  getApplicationStatus
};
