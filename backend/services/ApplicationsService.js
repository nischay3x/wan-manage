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

const Service = require('./Service');
const applicationsLibrary = require('../models/applicationsLibrary');
const { devices } = require('../models/devices');
const applications = require('../models/applications');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const dispatcher = require('../deviceLogic/dispatcher');
const ObjectId = require('mongoose').Types.ObjectId;
const cidrTools = require('cidr-tools');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const {
  getAvailableIps,
  getSubnetMask
} = require('../utils/networks');
const { isVpn } = require('../deviceLogic/validators');

class ApplicationsService {
  /**
   * get all applications in our applications library
   *
   * @static
   * @param {*} { user }
   * @returns {Object} object with applications array
   * @memberof ApplicationsService
   */
  static async applicationsLibraryGET ({ user }) {
    try {
      const appsList = await applicationsLibrary.find();
      return Service.successResponse({ applications: appsList });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * get purchased application by id
   *
   * @static
   * @param {*} { org, id } org id and application id
   * @param {*} { user }
   * @returns {Object} object with applications array
   * @memberof ApplicationsService
   */
  static async applicationGET ({ org, id }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      const installedApp = await applications
        .findOne({ org: { $in: orgList }, removed: false, _id: id })
        .populate('app').populate('org');

      return Service.successResponse({ application: installedApp });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * get all purchased applications
   *
   * @static
   * @param {*} { org }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsGET ({ org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const installed = await applications.aggregate([
        { $match: { org: { $in: orgList.map(o => ObjectId(o)) }, removed: false } },
        {
          $lookup: {
            from: 'devices',
            let: { id: '$_id' },
            pipeline: [
              { $unwind: '$applications' },
              { $match: { $expr: { $eq: ['$applications.app', '$$id'] } } },
              { $project: { 'applications.status': 1 } },
              { $group: { _id: '$applications.status', count: { $sum: 1 } } }
            ],
            as: 'statuses'
          }
        },
        {
          $project: {
            _id: 1,
            app: 1,
            org: 1,
            installedVersion: 1,
            pendingToUpgrade: 1,
            statuses: 1
          }
        }
      ]).allowDiskUse(true);

      await applications.populate(installed, { path: 'app' });
      await applications.populate(installed, { path: 'org' });

      const response = installed.map(app => {
        const statusesTotal = {
          installed: 0,
          pending: 0,
          failed: 0,
          deleted: 0
        };
        app.statuses.forEach(appStatus => {
          if (appStatus._id === 'installed') {
            statusesTotal.installed += appStatus.count;
          } else if (['installing', 'uninstalling'].includes(appStatus._id)) {
            statusesTotal.pending += appStatus.count;
          } else if (appStatus._id.includes('fail')) {
            statusesTotal.failed += appStatus.count;
          } else if (appStatus._id.includes('deleted')) {
            statusesTotal.deleted += appStatus.count;
          }
        });
        const { ...rest } = app;
        return {
          ...rest,
          statuses: statusesTotal
        };
      });

      return Service.successResponse({ applications: response });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * purchase new application
   *
   * @static
   * @param {*} { org, id }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationPOST ({ org, id }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      // check if application._id is an application in library
      const libraryApp = await applicationsLibrary.findOne({ _id: id });
      if (!libraryApp) {
        return Service.rejectResponse('Application id is not known', 500);
      }

      // check if app already installed
      let appExists = await applications.findOne({
        org: { $in: orgList }, app: id
      });

      if (appExists && !appExists.removed) {
        return Service.rejectResponse('This Application is already purchased', 500);
      }

      // don't create new app if this app installed in the past but removed
      if (appExists && appExists.removed) {
        appExists.removed = false;
        appExists.purchasedDate = Date.now();
        appExists.save();

        appExists = await appExists.populate('app').populate('org').execPopulate();

        return Service.successResponse(appExists);
      }

      // create app
      let installedApp = await applications.create({
        app: libraryApp._id,
        org: orgList[0],
        installedVersion: libraryApp.latestVersion,
        purchasedDate: Date.now(),
        configuration: {
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
        }
      });

      // return populated document
      installedApp = await installedApp.populate('app').populate('org').execPopulate();

      return Service.successResponse(installedApp);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * uninstall application
   *
   * @static
   * @param {*} { org, id }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationDELETE ({ org, id }, { user }, response) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      await applications.updateOne(
        { _id: id, org: { $in: orgList }, removed: false },
        { $set: { removed: true } },
        { upsert: false }
      );

      // send jobs to device that installed open vpn
      const opDevices = await devices.find({
        org: { $in: orgList },
        'applications.app': id,
        'applications.status': 'installed'
      });

      if (opDevices.length) {
        await dispatcher.apply(opDevices, 'application',
          user, { org: orgList[0], meta: { op: 'uninstall', id: id } });
      }

      return Service.successResponse({ data: 'ok' });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async validateVpnConfiguration (configurationRequest, applicationId, orgList) {
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
        'applications.app': applicationId,
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
  }

  static async validateConfiguration (configurationRequest, app, orgList) {
    if (isVpn(app.app.name)) {
      return ApplicationsService.validateVpnConfiguration(configurationRequest, app._id, orgList);
    }

    return { valid: true, err: '' };
  }

  /**
   * update application
   *
   * @static
   * @param {*} { org, id }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsConfigurationPUT ({ id, configurationRequest, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      const app = await applications
        .findOne({ org: { $in: orgList }, removed: false, _id: id })
        .populate('app').populate('org').lean();

      if (!app) return Service.rejectResponse('Invalid application id', 500);

      if (isVpn(app.app.name)) {
        // Calculate subnets to entire org
        const subnets = [];
        const totalPool = configurationRequest.remoteClientIp;
        const perDevice = configurationRequest.connectionsPerDevice;
        if (totalPool && perDevice) {
          const mask = totalPool.split('/')[1];

          // get ip range for this mask
          const availableIps = getAvailableIps(mask);

          // get subnets count for this org
          const subnetsCount = availableIps / perDevice;

          // get the new subnets mask for splitted subnets
          const newMask = getSubnetMask(perDevice);

          // get all ips in entire network
          const ips = cidrTools.expand(totalPool);

          for (let i = 0; i < subnetsCount; i++) {
            subnets.push({ device: null, subnet: `${ips[i * perDevice]}/${newMask}` });
          }
        }

        configurationRequest.subnets = subnets;
      }

      const {
        valid, err
      } = await ApplicationsService.validateConfiguration(configurationRequest, app, orgList);

      if (!valid) {
        logger.warn('Application update failed',
          {
            params: { config: configurationRequest, err: err }
          });
        return Service.rejectResponse(err, 500);
      }

      // update old configuration object with new one
      const combinedConfig = { ...app.configuration, ...configurationRequest };

      const updated = await applications.findOneAndUpdate(
        { _id: id },
        { $set: { configuration: combinedConfig } },
        { new: true, upsert: false }
      );

      await updated.populate('app').populate('org').execPopulate();

      // Update devices that installed vpn
      const opDevices = await devices.find({
        org: { $in: orgList },
        'applications.app': id,
        'applications.status': { $in: ['installed', 'installing'] }
      });

      if (opDevices.length) {
        await dispatcher.apply(opDevices, 'application',
          user, { org: orgList[0], meta: { op: 'config', id: id } });
      }

      return Service.successResponse({ application: updated });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * upgrade application
   *
   * @static
   * @param {*} { org, id }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsUpgradePOST ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      const app = await applications.findOne(
        { _id: id }
      ).populate('app').lean();

      const currentVersion = app.installedVersion;
      const newVersion = app.app.latestVersion;

      if (currentVersion === newVersion) {
        return Service.rejectResponse(
          'This application is already updated with latest version',
          500
        );
      }

      // send jobs to device
      const opDevices = await devices.find({ org: { $in: orgList }, 'applications.app': id });
      await dispatcher.apply(opDevices, 'application',
        user, { org: orgList[0], meta: { op: 'upgrade', id: id, newVersion: newVersion } });

      return Service.successResponse({ data: 'ok' });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async applicationStatusGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);

      // check if user didn't pass request body or if app id is invalid
      if (!ObjectId.isValid(id)) {
        return Service.rejectResponse('Invalid request', 500);
      }

      const devicesList = await devices.aggregate([
        { $match: { org: { $in: orgList.map(o => ObjectId(o)) } } },
        { $unwind: '$applications' },
        { $match: { 'applications.app': ObjectId(id) } },
        {
          $lookup: {
            from: 'applications',
            let: { appId: '$applications.app', deviceId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$appId'] } } },
              { $unwind: '$configuration.subnets' },
              { $match: { $expr: { $eq: ['$configuration.subnets.device', '$$deviceId'] } } },
              { $project: { subnet: '$configuration.subnets.subnet' } }
            ],
            as: 'subnet'
          }
        },
        {
          $project: {
            name: 1,
            subnet: { $arrayElemAt: ['$subnet', 0] },
            status: '$applications.status'
          }
        }
      ]).allowDiskUse(true);

      return Service.successResponse({ data: devicesList });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
