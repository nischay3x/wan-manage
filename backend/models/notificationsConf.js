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

const ruleSchema = new Schema({
  event: {
    type: String,
    required: true,
    enum: ['Device connection',
      'Running router',
      'Link/Tunnel round trip time',
      'Link/Tunnel default drop rate',
      'Device memory usage',
      'Hard drive usage',
      'Temperature',
      'Policy change',
      'Software update']
  },
  warningThreshold: { type: Number, default: null },
  criticalThreshold: { type: Number, default: null },
  thresholdUnit: { type: String, default: null, enum: ['%', 'ms', 'C°'] },
  severity: { type: String, default: null, enum: ['critical', 'warning'] },
  immediateEmail: { type: Boolean, default: false },
  resolvedAlert: { type: Boolean, default: true }
});

/**
 * Notifications configuration Database Schema
 */
const notificationsConfSchema = new Schema({
  name: {
    type: String
  },
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations'
  },
  account: {
    type: Schema.Types.ObjectId,
    ref: 'accounts'
  },
  rules: [ruleSchema],
  signedToCritical:
  [
    { type: mongoose.Schema.Types.ObjectId, ref: 'users' }
  ],
  signedToWarning:
  [
    { type: mongoose.Schema.Types.ObjectId, ref: 'users' }
  ],
  signedToDaily:
  [
    { type: mongoose.Schema.Types.ObjectId, ref: 'users' }
  ]
});

notificationsConfSchema.index({ org: 1 }, { unique: true, sparse: true });
notificationsConfSchema.index({ account: 1 }, { unique: true, sparse: true });

// Default exports
module.exports = mongoConns.getMainDB().model('notifications', notificationsConfSchema);
