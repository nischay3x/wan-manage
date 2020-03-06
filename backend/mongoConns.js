// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

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

const configs = require('./configs')();
const mongoose = require('mongoose');
const logger = require('./logging/logging')({ module: module.filename, type: 'mongodb' });

class MongoConns {
  constructor () {
    this.getMainDB = this.getMainDB.bind(this);
    this.getAnalyticsDB = this.getAnalyticsDB.bind(this);

    this.mainDB = mongoose.createConnection(configs.get('mongoUrl'), {
      useNewUrlParser: true,
      useCreateIndex: true
    });
    this.mainDB.then((db) => {
      logger.info('Connected to MongoDB mainDB');
    }, (err) => { logger.error('Failed to connect to mainDB', { params: { err: err.message } }); });

    this.analyticsDB = mongoose.createConnection(configs.get('mongoAnalyticsUrl'), {
      useNewUrlParser: true,
      useCreateIndex: true
    });
    this.analyticsDB.then((db) => {
      logger.info('Connected to MongoDB analyticsDB');
    }, (err) => {
      logger.error('Failed to connect to analyticsDB', { params: { err: err.message } });
    });
  }

  getMainDB () {
    return this.mainDB;
  }

  getAnalyticsDB () {
    return this.analyticsDB;
  }
}

var mongoConns = null;
module.exports = function () {
  if (mongoConns) return mongoConns;
  else {
    mongoConns = new MongoConns();
    return mongoConns;
  }
};
