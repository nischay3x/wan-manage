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
  onVpnJobComplete,
  onVpnJobRemoved,
  onVpnJobFailed,
  validateVpnApplication,
  getRemoteVpnParams,
  pickOnlyVpnAllowedFields,
  needToUpdatedVpnServers
} = require('./remotevpn');

const pickAllowedFieldsOnly = (configurationRequest, app) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return pickOnlyVpnAllowedFields(configurationRequest, app);
  } else {
    return configurationRequest;
  }
};

const validateConfiguration = async (configurationRequest, app, orgList) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return await validateVpnConfiguration(configurationRequest, app, orgList);
  } else {
    return { valid: false, err: 'Invalid application' };
  }
};

const validateApplication = (app, op, deviceIds) => {
  if (isVpn(app.appStoreApp.identifier)) {
    return validateVpnApplication(app, op, deviceIds);
  };

  return { valid: false, err: 'Invalid application' };
};

const onJobComplete = async (org, app, op, deviceId) => {
  if (isVpn(app.appStoreApp.identifier)) {
    await onVpnJobComplete(org, app, op, deviceId);
  }
};

const onJobFailed = async (org, app, op, deviceId) => {
  if (isVpn(app.appStoreApp.identifier)) {
    await onVpnJobFailed(org, app, op, deviceId);
  }
};

const onJobRemoved = async (org, app, op, deviceId) => {
  if (isVpn(app.appStoreApp.identifier)) {
    await onVpnJobRemoved(org, app, op, deviceId);
  }
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

  if (op === 'install') {
    params.installationFilePath = version.components.agent.installationPath;
    params.installationPathType = version.components.agent.installationPathType;
    params.startOnInstallation = version.components.agent.startOnInstallation;
  }

  if (isVpn(application.appStoreApp.identifier)) {
    const vpnParams = await getRemoteVpnParams(device, application._id, op);
    if (op === 'install') {
      params = { ...params, ...vpnParams };

      // for install job, we passed the config parameters as well
      const vpnConfigParams = await getRemoteVpnParams(device, application._id, 'config');
      vpnConfigParams.identifier = application.appStoreApp.identifier;
      params = { ...params, configParams: vpnConfigParams };
    } else {
      params = { ...params, ...vpnParams };
    }
  }

  return params;
};

const saveConfiguration = async (application, updatedConfig) => {
  if (isVpn(application.appStoreApp.identifier)) {
    // reset the subnets array
    // in the jobs logic, new subnets will be allocated
    updatedConfig.subnets = [];
  }

  const updatedApp = await applications.findOneAndUpdate(
    { _id: application._id },
    { $set: { configuration: updatedConfig } },
    { new: true, upsert: false, runValidators: true }
  ).populate('appStoreApp').lean();

  return updatedApp;
};
const needToUpdatedDevices = (application, oldConfig, newConfig) => {
  if (isVpn(application.appStoreApp.identifier)) {
    return needToUpdatedVpnServers(oldConfig, newConfig);
  } else {
    return true;
  };
};

module.exports = {
  validateConfiguration,
  pickAllowedFieldsOnly,
  validateApplication,
  onJobComplete,
  onJobFailed,
  onJobRemoved,
  getJobParams,
  saveConfiguration,
  needToUpdatedDevices
};
