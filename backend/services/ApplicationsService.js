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
// const configs = require('../configs')();
const applications = require('../models/applications');
const { devices } = require('../models/devices');
const purchasedApplications = require('../models/purchasedApplications');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
// const { devices } = require('../models/devices');
// const { getAccessTokenOrgList } = require('../utils/membershipUtils');
// var mongoose = require('mongoose');
// const find = require('lodash/find');
// const remove = require('lodash/remove');

class ApplicationsService {
  static async applicationsLibraryGET ({}, { user }) {
    try {
      const appsList = await applications.find();

      if (appsList) {
        return Service.successResponse({ applications: appsList });
      }

      return Service.successResponse({ applications: [] });
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
   * @param {*} { org }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsGET ({ org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const installedApps = await purchasedApplications
        .find({
          org: { $in: orgList },
          removed: false
        })
        .populate('app')
        .populate('org');

      return Service.successResponse({ applications: installedApps });
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
   * @param {*} { org, application }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsPOST ({ org, application }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      // check if app already installed
      let appAlreadyInstalled = await purchasedApplications.findOne({
        org: { $in: orgList },
        app: application._id
      });

      if (appAlreadyInstalled && !appAlreadyInstalled.removed) {
        return Service.rejectResponse(
          'This Application is already purchased',
          500
        );
      }

      // if this app installed in the past - we store the configuration
      if (appAlreadyInstalled && appAlreadyInstalled.removed) {
        appAlreadyInstalled.removed = false;
        appAlreadyInstalled.purchasedDate = Date.now();
        appAlreadyInstalled.save();

        // TODO: need to think on upgrade..

        appAlreadyInstalled = await appAlreadyInstalled
          .populate('app')
          .populate('org')
          .execPopulate();

        return Service.successResponse(appAlreadyInstalled);
      }

      // create app
      let installedApp = await purchasedApplications.create({
        app: application._id.toString(),
        org: orgList[0].toString(),
        installedVersion: application.latestVersion,
        purchasedDate: Date.now(),
        configuration: {}
      });

      // return populated document
      installedApp = await installedApp
        .populate('app')
        .populate('org')
        .execPopulate();

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
   * @param {*} { org, application }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsDELETE ({ org, id }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      await purchasedApplications.updateOne(
        { _id: id },
        { $set: { removed: true } },
        { upsert: false }
      );

      // TODO: send jobs to remove from devices

      // remove this app from all devices
      await devices.updateMany(
        { org: { $in: orgList } },
        { $pull: { applications: { app: id } } }
      );

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
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
  static async applicationsConfigurationPUT ({ id, application, org }, { user }) {
    try {
      await purchasedApplications.updateOne(
        { _id: id },
        { $set: { configuration: application.configuration } }
      );

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
