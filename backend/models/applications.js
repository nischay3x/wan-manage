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

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const mongoConns = require('../mongoConns.js')();

// ! TODO: Unit tests

/**
 * Rules Database Schema (TBD)
 * TODO: This is draft, needs discussion about the right schema.
 */
const rulesSchema = new Schema({
  // IP
  // TODO: add validator
  ip: {
    type: String,
    required: false
  },
  // Ports
  // TODO: add validator
  ports: {
    type: String,
    required: false
  },
  // Protocol
  protocol: {
    type: String,
    enum: ['tcp', 'udp', ''],
    required: false
  }
});

/**
 * Application Database Default Schema (TBD)
 * Main difference from the main schema - not tied to organisation
 * TODO: This is draft, needs discussion about the right schema.
 */
const applicationSchema = new Schema({
  // Application id
  id: {
    type: String,
    required: true
  },
  // Application name
  name: {
    type: String,
    required: true
  },
  // Category name
  category: {
    type: String,
    required: true,
    maxlength: [20, 'Category name must be at most 20']
  },
  // Service Class name
  serviceClass: {
    type: String,
    required: true,
    maxlength: [20, 'Service Class name must be at most 20']
  },
  // Importance
  importance: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true
  },
  // Description
  description: {
    type: String,
    maxlength: [128, 'Description must be at most 128']
  },
  // List of rules
  rules: [rulesSchema]
}, {
  timestamps: true
});

const metaSchema = new Schema({
  // Update timw
  time: {
    type: Number
  },
  // Organization
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations'
  }
});

/**
 * Application Database Schema (TBD)
 * TODO: This is draft, needs discussion about the right schema.
 */
const applicationsSchema = new Schema({
  // meta
  meta: {
    type: metaSchema,
    required: true
  },
  applications: [applicationSchema]
}, {
  timestamps: true
});

// indexing
applicationsSchema.index({ name: 1, org: 1 }, { unique: true });

// Default exports
module.exports =
{
  applicationsSchema,
  applications: mongoConns.getMainDB().model('applications', applicationsSchema),
  rules: mongoConns.getMainDB().model('rules', rulesSchema)
};
