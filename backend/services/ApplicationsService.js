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
// const {
//   appIdentifications,
//   importedAppIdentifications,
//   getAllAppIdentifications,
//   getAppIdentificationById,
//   getAppIdentificationUpdateAt
// } = require('../models/appIdentifications');
// const { devices } = require('../models/devices');
// const { getAccessTokenOrgList } = require('../utils/membershipUtils');
// var mongoose = require('mongoose');
// const find = require('lodash/find');
// const remove = require('lodash/remove');

class ApplicationsService {
  static async applicationsGET ({ limit, org, offset }, { user }) {
    return Service.successResponse({ data: ['a', 'b', 'c'] });
  }
}

module.exports = ApplicationsService;
