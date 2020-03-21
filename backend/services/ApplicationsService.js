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

class ApplicationsService {
  static async applicationsGET ({ org, offset, limit }, { user }) {
    try {
      console.log('Inside applicationsGET');
      // TODO: currently returns hard-coded data, needs to be
      // TODO: retrieved from DB
      const applications = [{
        app: 'google-dns',
        _id: '5e72f859a7bb9d2c5305aa86',
        category: 'network',
        subcategory: 'dns',
        importance: 3,
        rules: [{
          ip: '8.8.8.8',
          ipPrefix: 32,
          portRangeLow: 53,
          portRangeHigh: 53,
          protocol: 'TCP'
        },
        {
          ip: '8.8.4.4',
          ipPrefix: 32,
          portRangeLow: 53,
          portRangeHigh: 53,
          protocol: 'UDP'
        }]
      }, {
        app: 'youtube',
        _id: '5e72ff44e6f2e6bbb5aee422',
        category: 'network',
        subcategory: 'video',
        importance: 2,
        rules: [{
          ip: '4.4.8.8',
          ipPrefix: 32,
          portRangeLow: 53,
          portRangeHigh: 53,
          protocol: 'UDP'
        },
        {
          ip: '8.8.8.8',
          ipPrefix: 32,
          portRangeLow: 2072,
          portRangeHigh: 2074,
          protocol: 'TCP'
        }]
      }];
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
