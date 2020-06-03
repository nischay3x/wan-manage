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
const library = require('../models/library');
const { devices } = require('../models/devices');
const applications = require('../models/applications');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');

// const { devices } = require('../models/devices');
// const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const ObjectId = require('mongoose').Types.ObjectId;
// const find = require('lodash/find');
// const remove = require('lodash/remove');

class ApplicationsService {
  static async applicationsLibraryGET ({ user }) {
    try {
      const appsList = await library.find();

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

  static async applicationGET ({ org, id }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const installedApp = await applications
        .findOne({
          org: { $in: orgList },
          removed: false,
          _id: id
        })
        .populate('app')
        .populate('org');

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
      const orgList = await getAccessTokenOrgList(user, org, true);

      // TODO: continue implement below to calculate statuses
      const installed = await applications.aggregate([
        { $match: { org: { $in: orgList.map(o => ObjectId(o)) } } },
        {
          $lookup: {
            from: 'devices',
            let: { id: '$_id' },
            pipeline: [
              { $unwind: '$applications' },
              { $match: { $expr: { $eq: ['$applications.app', '$$id'] } } },
              { $project: { 'applications.status': 1 } },
              { $group: { _id: '$applications.status', v: { $sum: 1 } } },
              { $project: { _id: false, k: '$_id', v: '$v' } }
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
            statuses: { $arrayToObject: '$statuses' }
          }
        }
      ]).allowDiskUse(true);

      await applications.populate(installed, { path: 'app' });
      await applications.populate(installed, { path: 'org' });

      // console.log("installed", installed[0]);

      return Service.successResponse({ applications: installed });
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
      let appAlreadyInstalled = await applications.findOne({
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
      let installedApp = await applications.create({
        app: application._id, // .toString(),
        org: orgList[0], // .toString(),
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

      await applications.updateOne(
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
      // check if subdomain already taken
      const domain = application.configuration.domainName;
      const domainExists = await applications.findOne(
        {
          _id: { $ne: id },
          configuration: { $exists: 1 },
          'configuration.domainName': domain
        }
      );

      if (domainExists) {
        return Service.rejectResponse(
          'This domain already taken. please choose other',
          500
        );
      }

      // prevent multi authentications methods enabled
      console.log(application.configuration);
      console.log(application.configuration);
      if (application.configuration && application.configuration.authentications) {
        const enabledCount = application.configuration.authentications.filter(a => a.enabled);
        if (enabledCount.length > 1) {
          return Service.rejectResponse(
            'Cannot enabled multiple authentication methods',
            500
          );
        }
      }

      const updated = await applications.findOneAndUpdate(
        { _id: id },
        { $set: { configuration: application.configuration } },
        {
          new: true
        }
      );

      await updated.populate('app')
        .populate('org')
        .execPopulate();

      // TODO: update application on devices if needed

      return Service.successResponse({ application: updated });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
