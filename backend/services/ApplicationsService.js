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
const mongoose = require('mongoose');

class ApplicationsService {
  static async applicationsGET ({ org, offset, limit }, { user }) {
    console.log('Inside applicationsGET');
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const result = await Applications.applications.find({ org: { $in: orgList } });

      const applications = result.map(item => {
        return {
          id: item.id,
          org: item.org.toString(),
          app: item.app,
          category: item.category,
          serviceClass: item.serviceClass,
          importance: item.importance,
          rules: item.rules,
          createdAt: item.createdAt.toISOString()
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
  static async applicationsPOST ({ org, applicationRequest }, { user }, response) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const applicationBody = { ...applicationRequest, account: user.defaultAccount };
      // TODO: move next 3 rows to spread operator above
      applicationBody.org = orgList[0].toString();
      applicationBody.appId = 1;
      applicationBody._id = mongoose.Types.ObjectId(32000); // TODO: needs discussion
      const _applicationList = await Applications.applications.create([applicationBody]);
      const applicationItem = _applicationList[0];
      return Service.successResponse({
        _id: applicationItem.id,
        org: applicationItem.org.toString(),
        app: applicationItem.app,
        createdAt: applicationItem.createdAt.toISOString()
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
      await Applications.applications.remove({
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

  static async importedapplicationsGET ({ offset, limit }, { user }) {
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
