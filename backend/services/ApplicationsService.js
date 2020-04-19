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

class ApplicationsService {
  static async applicationsGET ({ org }, { user }) {
    console.log('Inside applicationsGET');
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const result = await Applications.applications.find({ org: { $in: orgList } });

      if (result.length === 0) {
        return Service.successResponse([]);
      }

      const applications = result[0].applications.map(item => {
        return {
          id: item.id,
          app: item.app,
          category: item.category,
          serviceClass: item.serviceClass,
          importance: item.importance,
          rules: item.rules
        };
      });

      return Service.successResponse(applications);
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
      const result = await Applications.applications.find({ org: { $in: orgList } });
      if (result.length > 0) {
        result[0].applications.push({ ...applicationRequest, appId: 1 });
        const updateResult = await Applications.applications.update(result[0]);
        if (updateResult.nModified === 1) {
          return Service.successResponse({
            app: applicationRequest.app
          }, 201);
        }
        return Service.rejectResponse(
          'Failed to add application', 500);
      }

      const applicationBody = {
        org: orgList[0].toString(),
        applications: []
      };
      applicationBody.applications.push({ ...applicationRequest, appId: 1 });

      const _applicationList = await Applications.applications.create([applicationBody]);
      const applicationItem = _applicationList[0];
      return Service.successResponse({
        _id: applicationItem.id,
        org: applicationItem.org.toString(),
        app: applicationItem.app
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

      const result = await Applications.applications.find({ org: { $in: orgList } });
      const appName = result[0].applications.find(item => item._id.toString() === id).app;
      if (result.length > 0) {
        result[0].applications = result[0].applications.filter(item => item._id.toString() !== id);
        const updateResult = await Applications.applications.update(result[0]);
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

  static async importedapplicationsGET () {
    console.log('Inside importedapplicationsGET');
    try {
      const result = await ImportedApplications.importedapplications.find();

      const applications = result[0].rules.map(item => {
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

      return Service.successResponse(applications);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = ApplicationsService;
