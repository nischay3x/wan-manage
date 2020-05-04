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
const Applications = require('../models/applications');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
var mongoose = require('mongoose');
const { find, remove } = require('lodash');

class ApplicationsService {
  static async applicationsGET ({ org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const response = await Applications.getAllApplications(orgList);
      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async applicationsIdGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const response = await Applications.getApplicationById(orgList, id);
      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  };

  static async applicationsCustomIdGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const applicationsResult =
        await Applications.applications.findOne({ 'meta.org': { $in: orgList } });
      const applicationResult = find(applicationsResult.applications, { id: id });
      return Service.successResponse(applicationResult);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  };

  static async applicationsCustomIdPUT ({ id, org, applicationRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const applicationsResult =
        await Applications.applications.findOne({ 'meta.org': { $in: orgList } });

      // if organization document already exists
      if (applicationsResult) {
        applicationsResult.applications = applicationsResult.applications
          .filter(item => item.id !== id);
        applicationsResult.applications.push(applicationRequest);
        const updateResult = await Applications.applications.updateOne(applicationsResult);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            name: applicationRequest.name
          }, 201);
        }
        return Service.rejectResponse(
          'Failed to add application', 500);
      }

      return Service.successResponse({
        name: applicationRequest.name
      }, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Add new application
   *
   * applicationRequest ApplicationRequest
   * returns Application
   **/
  static async applicationsPOST ({ org, applicationRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const result = await Applications.applications.findOne({ 'meta.org': { $in: orgList } });
      applicationRequest.rules = applicationRequest.rules
        .map(rule => { return { ...rule, _id: mongoose.Types.ObjectId() }; });
      const objectId = mongoose.Types.ObjectId();
      // TODO: The redundancy with the ids is in order to keep consistency with the imported
      // TODO: list. Maybe we could get rid of the id in the imported list and use _id in both
      // TODO: tables.
      const newApplication = { ...applicationRequest, _id: objectId, id: objectId.toString() };

      // if organization document already exists
      if (result !== null) {
        result.applications.push(newApplication);
        const updateResult = await Applications.applications.updateOne(result);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            name: applicationRequest.name
          }, 201);
        }
        return Service.rejectResponse(
          'Failed to add application', 500);
      }

      // create new organization document and add to collection
      const applicationBody = {
        meta: {
          org: orgList[0].toString()
        },
        applications: []
      };
      applicationBody.applications.push(newApplication);

      await Applications.applications.create([applicationBody]);
      return Service.successResponse({
        name: applicationRequest.name
      }, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Reset imported application to default settings
   *
   * @static
   * @param {*} { id, org, applicationRequest }
   * @param {*} { user }
   * @returns
   * @memberof ApplicationsService
   */
  static async applicationsIdResetPUT ({ id, org, applicationRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const result = await Applications.applications.findOne({ 'meta.org': { $in: orgList } });

      // if organization document already exists
      if (result !== null) {
        if (!result.imported) {
          result.imported = [];
        }

        remove(result.imported, (item) => item.id === id);

        const updateResult = await Applications.applications.updateOne(result);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            name: applicationRequest.name
          }, 201);
        }
        return Service.rejectResponse(
          'Failed to add application', 500);
      }

      return Service.successResponse({
        name: applicationRequest.name
      }, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify an application
   *
   * id String Numeric ID of the Application to modify
   * applicationRequest applicationRequest  (optional)
   * returns
   * TODO: possibly need to merge with the custom application update
   * TODO: (currently implemented for customization of imported applications)
   **/
  static async applicationsIdPUT ({ id, org, applicationRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const result = await Applications.applications.findOne({ 'meta.org': { $in: orgList } });
      const objectId = mongoose.Types.ObjectId();
      // TODO: no need new object id, and then new application too ??
      const newApplication = { ...applicationRequest, _id: objectId, id: id };

      // if organization document already exists
      if (result !== null) {
        if (!result.imported) {
          result.imported = [];
        }

        const projection = {
          'applications.id': 1,
          'applications.category': 1,
          'applications.serviceClass': 1,
          'applications.importance': 1
        };

        // if updated application has same updated values as original one,
        // remove it from customized imported array, as it is no longer
        // considered modified
        const importedApplicationsResult =
        await Applications.importedapplications.findOne({}, projection);
        const originalApplication = find(importedApplicationsResult.applications, { id: id });
        if (originalApplication) {
          if (
            originalApplication.category === newApplication.category &&
            originalApplication.serviceClass === newApplication.serviceClass &&
            originalApplication.importance === newApplication.importance
          ) {
            await ApplicationsService
              .applicationsIdResetPUT({ id, org, applicationRequest }, { user });
            return Service.successResponse({
              name: applicationRequest.name
            }, 201);
          }
        }

        const oldApplication = find(result.imported, { id: id });
        if (oldApplication) {
          oldApplication.category = newApplication.category;
          oldApplication.serviceClass = newApplication.serviceClass;
          oldApplication.importance = newApplication.importance;
        } else {
          result.imported.push(newApplication);
        }
        const updateResult = await Applications.applications.updateOne(result);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            name: applicationRequest.name
          }, 201);
        }
        return Service.rejectResponse(
          'Failed to add application', 500);
      }

      // create new organization document and add to collection
      const applicationBody = {
        meta: {
          org: orgList[0].toString()
        },
        applications: [],
        imported: []
      };
      applicationBody.imported.push(newApplication);
      await Applications.applications.create([applicationBody]);
      return Service.successResponse({
        name: applicationRequest.name
      }, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete application
   *
   * id String Numeric ID of the Application to delete
   * no response value expected for this operation
   **/
  static async applicationsIdDELETE ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const result = await Applications.applications.findOne({ 'meta.org': { $in: orgList } });
      if (result !== null) {
        const appName = result.applications.find(item => item._id.toString() === id).name;
        result.applications = result.applications.filter(item => item._id.toString() !== id);
        const updateResult = await Applications.applications.updateOne(result);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            app: appName
          }, 204);
        }
        return Service.rejectResponse(
          'Failed to delete application', 500);
      }

      await Applications.applications.deleteOne({
        _id: id,
        org: { $in: orgList }
      });

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async applicationsInstalledGET ({ org, offset, limit }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const response = await Applications.getApplicationUpdateAt(orgList);
      const updateAt = (response.importedUpdatedAt >= response.customUpdatedAt)
        ? response.importedUpdatedAt : response.customUpdatedAt;

      const devicesPipeline = [
        {
          $project: {
            _id: { $toString: '$_id' },
            updatedAt: { $toString: { $ifNull: ['$appIdentification.lastUpdateTime', ''] } },
            clients: { $ifNull: ['$appIdentification.clients', []] },
            status: {
              $cond: {
                if: {
                  $and: [{
                    $and: [
                      { $ne: ['$appIdentification.clients', undefined] },
                      { $ne: ['$appIdentification.clients', []] }]
                  },
                  {
                    $or: [
                      { $eq: ['$appIdentification.lastUpdateTime', undefined] },
                      { $eq: ['$appIdentification.lastUpdateTime', null] },
                      { $lt: ['$appIdentification.lastUpdateTime', updateAt] }]
                  }]
                },
                then: 'install',
                else: {
                  $cond: {
                    if: {
                      $and: [{
                        $or: [
                          { $eq: ['$appIdentification.clients', undefined] },
                          { $eq: ['$appIdentification.clients', []] }]
                      },
                      { $ne: ['$appIdentification.lastUpdateTime', null] }]
                    },
                    then: 'uninstall',
                    else: 'ok'
                  }
                }
              }
            }
          }
        }
      ];
      if (offset) devicesPipeline.push({ $skip: offset });
      if (limit) devicesPipeline.push({ $limit: limit });

      const pipeline = [
        {
          $match: {
            org: mongoose.Types.ObjectId(orgList[0]),
            $or: [
              { 'appIdentification.clients': { $exists: true, $ne: [] } },
              { 'appIdentification.lastUpdateTime': { $ne: null } }
            ]
          }
        },
        {
          $facet: {
            count: [{
              $match: {
                $or: [
                  // have clients but not updated to latest
                  {
                    $and: [
                      { 'appIdentification.clients': { $exists: true, $ne: [] } },
                      {
                        $or: [
                          { 'appIdentification.lastUpdateTime': { $exists: false } },
                          { 'appIdentification.lastUpdateTime': null },
                          { 'appIdentification.lastUpdateTime': { $lt: updateAt } }]
                      }]
                  },
                  // have no clients and updated is not null
                  {
                    $and: [
                      {
                        $or: [
                          { 'appIdentification.clients': { $exists: false } },
                          { 'appIdentification.clients': [] }]
                      },
                      { 'appIdentification.lastUpdateTime': { $ne: null } }]
                  }]
              }
            }, { $count: 'numDevices' }],
            devices: devicesPipeline
          }
        }
      ];

      const result = await devices.aggregate(pipeline).allowDiskUse(true);

      return Service.successResponse({
        totalNotUpdated: (
          result && result.length > 0 && result[0].count &&
          result[0].count.length > 0)
          ? result[0].count[0].numDevices
          : 0,
        devices: (result && result[0].devices) ? result[0].devices : 0
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
