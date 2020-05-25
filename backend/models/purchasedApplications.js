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

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const mongoConns = require('../mongoConns.js')();

/**
 * Purchased Applications Database Schema
 *
 * A schema for the documents that stores all organization applications
 */
const purchasedApplicationSchema = new Schema({
  app: {
    type: Schema.Types.ObjectId,
    ref: 'applications'
  },
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations'
  },
  installedVersion: {
    type: String,
    required: true,
    minlength: [2, 'Installed version must be at least 2'],
    maxlength: [30, 'Installed version must be at most 30']
  },
  // created date on repository
  purchasedDate: {
    type: Date,
    required: true
  },
  removed: {
    type: Boolean,
    default: false
  },
  configuration: {
    type: Object
  }
}, {
  timestamps: true
});

// Default exports
module.exports = mongoConns.getMainDB().model('purchasedApplications', purchasedApplicationSchema);
