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
const ImportedApplications = require('../models/importedapplications');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const concat = require('lodash/concat');
var mongoose = require('mongoose');

class ApplicationsService {
  static async applicationsGET ({ org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);

      // it is expected that custom applications are stored as single document per
      // organization in the collection
      const customApplicationsResult =
        await Applications.applications.findOne({ 'meta.org': { $in: orgList } });
      const customApplications =
        (customApplicationsResult === null || customApplicationsResult.applications === null)
          ? []
          : customApplicationsResult.applications.map(item => {
            return {
              id: item.id,
              name: item.name,
              category: item.category,
              serviceClass: item.serviceClass,
              importance: item.importance,
              rules: item.rules
            };
          });

      // it is expected that imported applications are stored as single document
      // in the collection
      const importantApplicationsResult = await ImportedApplications.importedapplications.findOne();
      const importedApplications =
        (importantApplicationsResult === null || importantApplicationsResult.applications === null)
          ? []
          : importantApplicationsResult.applications.map(item => {
            return {
              id: item.id,
              name: item.name,
              category: item.category,
              serviceClass: item.serviceClass,
              importance: item.importance,
              rules: item.rules.map(rulesItem => {
                return {
                  id: rulesItem.id,
                  protocol: rulesItem.protocol,
                  ports: rulesItem.ports,
                  ip: rulesItem.ip
                };
              })
            };
          });

      const mergedList = concat(customApplications, importedApplications);

      return Service.successResponse(mergedList);
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

  // TODO: remove
  static async importedapplicationsGET () {
    try {
      const importantApplicationsResult = await ImportedApplications.importedapplications.find();

      const importedApplications = importantApplicationsResult[0].rules.map(item => {
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          serviceClass: item.serviceClass,
          importance: item.importance,
          rules: item.rules.map(rulesItem => {
            return {
              id: rulesItem.id,
              protocol: rulesItem.protocol,
              ports: rulesItem.ports,
              ip: rulesItem.ip
            };
          })
        };
      });

      return Service.successResponse(importedApplications);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
