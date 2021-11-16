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
  getOpenVpnParams,
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
  if (isVpn(application.appStoreApp.identifier)) {
    return {
      type: 'open-vpn',
      name: application.appStoreApp.name,
      config: await getOpenVpnParams(device, application._id, op)
    };
  }

  return {};
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
