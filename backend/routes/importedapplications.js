// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2020  flexiWAN Ltd.

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

const express = require('express');
const bodyParser = require('body-parser');
const importedapplications = require('../models/importedapplications');
const wrapper = require('./wrapper');
const importedapplicationsRouter = express.Router();
importedapplicationsRouter.use(bodyParser.json());

// Error formatter
const formatErr = (err, msg) => {
  // Check for unique error
  if (err.name === 'MongoError' && err.code === 11000) {
    return ({ status: 500, error: 'Application ' + msg.name + ' already exists' });
  } else if (err.message) {
    return ({ status: 500, error: err.message });
  } else {
    return ({ status: 500, error: 'Unable to format error' });
  }
};

// check update
const checkUpdReq = (qtype, req) => new Promise(function (resolve, reject) {
  resolve({ ok: 1 });
});

// wrapper
wrapper.assignRoutes(importedapplicationsRouter,
  'importedapplications', '/', importedapplications, formatErr, checkUpdReq);

// Default exports
module.exports = importedapplicationsRouter;
