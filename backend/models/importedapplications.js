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
 * Rules Database Schema (TBD)
 * TODO: This is draft, needs discussion about the right schema.
 */
const rulesSchema1 = new Schema({
  // IP
  // TODO: add validator
  ip: {
    type: String,
    required: true
  },
  // IP Prefix
  // TODO: add validator
  ipPrefix: {
    type: String,
    required: true
  },
  // Port Range Low
  // TODO: add validator
  portRangeLow: {
    type: String,
    required: true
  },
  // Port Range High
  // TODO: add validator
  portRangeHigh: {
    type: String,
    required: true
  },
  // Protocol
  protocol: {
    type: String,
    enum: ['TCP', 'UDP'],
    required: true
  }
});

/**
 * Application Database Default Schema (TBD)
 * Main difference from the main schema - not tied to organisation
 * TODO: This is draft, needs discussion about the right schema.
 */
const importedapplicationsSchema = new Schema({
  // Application id
  appId: {
    type: Number,
    required: true,
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer value'
    }
  },
  // Application name
  app: {
    type: String,
    required: true
  },
  // Category name
  category: {
    type: String,
    required: true,
    maxlength: [128, 'Category name must be at most 128']
  },
  // Sub-category name
  subcategory: {
    type: String,
    required: true,
    maxlength: [128, 'Sub-category name must be at most 128']
  },
  // Importance
  importance: {
    type: String,
    enum: ['1', '2', '3'],
    required: true,
    maxlength: [1, 'Sub-category name must be at most 1']
  },
  // List of rules
  rules: [rulesSchema1]
}, {
  timestamps: true
});

// indexing
importedapplicationsSchema.index({ app: 1 }, { unique: true });

// Default exports
module.exports =
{
  importedapplications: mongoConns.getMainDB().model(
    'importedapplications', importedapplicationsSchema)
};
