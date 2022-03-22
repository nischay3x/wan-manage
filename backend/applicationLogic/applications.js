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

const applicationsModel = require('../models/applications');
const fs = require('fs');
const path = require('path');
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});

class ApplicationLogic {
  constructor () {
    this.apps = {};
    this.utilFuncs = {};
    this.buildApps();
  }

  registerUtilFunc (key, func) {
    this.utilFuncs[key] = func;

    // register the func with all installed applications
    for (const app in this.apps) {
      this.apps[app][key] = func;
    }
  }

  buildApps () {
    const appDirectory = path.join(__dirname, 'apps');
    const appFiles = fs.readdirSync(appDirectory);

    for (const appFile of appFiles) {
      if (!appFile.endsWith('.js')) {
        continue;
      }
      const identifier = appFile.split('.js')[0];
      const appFullPath = path.join(appDirectory, appFile);
      const appClass = require(appFullPath);
      this.register(identifier, appClass);
    }
  }

  register (identifier, AppClass) {
    this.apps[identifier] = new AppClass();

    // register the funcs with the install application
    for (const utilFunc in this.utilFuncs) {
      this.apps[identifier][utilFunc] = this.utilFuncs[utilFunc];
    }
  }

  remove (identifier, obj) {
    if (identifier in this.apps) {
      delete this.apps[identifier];
    }
  }

  async call (identifier, func, defaultRet, ...params) {
    try {
      if (!(identifier in this.apps)) {
        return defaultRet;
      }

      if (!this.apps[identifier][func]) {
        return defaultRet;
      }

      return await this.apps[identifier][func](...params);
    } catch (err) {
      logger.error('failed to call application func', {
        params: { identifier, func, defaultRet, ...params }
      });
      throw err;
    }
  }

  /**
   * Validate the global application configuration request sent by the user.
   *
   * @param  {object} configurationRequest  user request for global configuration
   * @param  {object} app application object
   * @param  {object} account account object
   * @return {{valid: boolean, err: string}}  test result + error if message is invalid
  */
  async validateConfiguration (identifier, configurationRequest, app, account) {
    const defaultRet = { valid: false, err: 'Invalid application' };
    return this.call(
      identifier, 'validateConfiguration',
      defaultRet, configurationRequest, app, account);
  };

  async selectConfigurationParams (identifier, configuration) {
    return this.call(identifier, 'selectConfigurationParams', true, configuration);
  };

  /**
 * Update billing stuff for application
 *
 * @param  {object} app application object
 * @return void
 */
  async updateApplicationBilling (app) {
    return this.callAsync(app.appStoreApp.identifier, 'updateApplicationBilling', null, app);
  };

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
  async pickAllowedFieldsOnly (identifier, configurationRequest) {
    const defaultRet = configurationRequest;
    return this.call(identifier, 'pickAllowedFieldsOnly', defaultRet, configurationRequest);
  };

  async needToUpdatedDevices (identifier, oldConfig, newConfig) {
    const defaultRet = true;
    return this.call(identifier, 'needToUpdatedDevices', defaultRet, oldConfig, newConfig);
  };

  async saveConfiguration (identifier, application, updatedConfig) {
    const updatedApp = await applicationsModel.findOneAndUpdate(
      { _id: application._id },
      { $set: { configuration: updatedConfig } },
      { new: true, upsert: false, runValidators: true }
    ).populate('appStoreApp').lean();

    await this.call(identifier, 'updateApplicationBilling', true, updatedApp);
    return updatedApp;
  };

  async getApplicationStatus (identifier, account, org) {
    return this.call(identifier, 'getApplicationStatus', true, account, org);
  };

  /**
   * Validate the device specific application configuration request that sent by the user.
   *
   * @param  {object}     app application object
   * @param  {object}     deviceConfiguration  user request for device configuration
   * @param  {[objectId]} deviceList the devices ids list, that application should installed on them
   * @return {{valid: boolean, err: string}}  test result + error if message is invalid
   */
  async validateDeviceConfigurationRequest (identifier, app, deviceConfiguration, deviceList) {
    const defaultRet = { valid: false, err: 'Invalid application' };
    return this.call(
      identifier,
      'validateDeviceConfigurationRequest',
      defaultRet,
      app,
      deviceConfiguration,
      deviceList
    );
  }

  async getApplicationSubnets (orgId) {
    const apps = await applicationsModel.find({ org: orgId }).populate('appStoreApp').lean();
    const subnets = [];
    for (const app of apps) {
      const appSubnet = await this.getApplicationSubnet(app.appStoreApp.identifier, app);
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

  /**
   * Validate uninstall request.
   *
   * @param  {object}   app application object
   * @param  {[objectId]} deviceList the devices ids list, that application should installed on them
   * @return {{valid: boolean, err: string}}  test result + error if message is invalid
   */
  async validateUninstallRequest (identifier, app, deviceList) {
    const defaultRet = { valid: false, err: 'Invalid application' };
    return this.call(identifier, 'validateUninstallRequest', defaultRet, app, deviceList);
  };

  /**
   * Get application configuration for specific device
   *
   * @param  {object} app application object
   * @param  {object} device the device object to be configured
   * @return {object} object of device configurations
   */
  async getDeviceSpecificConfiguration (identifier, app, device, deviceConfiguration, idx) {
    return this.call(
      identifier, 'getDeviceSpecificConfiguration', null, app, device, deviceConfiguration, idx);
  };

  /**
   * Returns database query of application's "installWith" parameter.
   *
   * This function takes the "installWith" value (see applications.json)
   * and parses it into mongo query. This query will be run on the device.
   *
   * @param  {object} app     application object
   * @param  {object} device  the device object to be configured
   * @param  {string} op      operation type
   * @return void
   */
  async getAppInstallWithAsQuery (app, device, op) {
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
   * @param  {object}   device      device to be modified
   * @param  {object}   application application object
   * @param  {string}   op          operation type
   * @return {object}               parameters object
   */
  async getJobParams (device, application, op) {
    const params = {
      name: application.appStoreApp.name,
      identifier: application.appStoreApp.identifier
    };

    const version = application.appStoreApp.versions.find(v => {
      return v.version === application.installedVersion;
    });

    if (!version) {
      throw new Error('Invalid installed version');
    }

    params.applicationParams = await this.call(
      params.identifier, 'getJobParams', {}, device, application, op);
    return params;
  };

  /**
   * Creates the application tasks ta based on application name.
   * @async
   * @param  {object}   device      device to be modified
   * @param  {object}   application application object
   * @param  {string}   op          operation type
   * @return {array}               parameters object
   */
  async getTasks (device, application, op) {
    const params = {
      name: application.appStoreApp.name,
      identifier: application.appStoreApp.identifier
    };

    return this.call(params.identifier, 'getTasks', [], device, application, op, params);
  };

  async getApplicationSubnet (identifier, application) {
    return this.call(identifier, 'getApplicationSubnet', [], application);
  };

  async isReadyForDeviceInstallation (identifier, application) {
    return this.call(identifier, 'isReadyForDeviceInstallation', true, application);
  }
}

var applicationLogic = null;
module.exports = function () {
  if (applicationLogic) return applicationLogic;
  else {
    applicationLogic = new ApplicationLogic();
    return applicationLogic;
  };
};
