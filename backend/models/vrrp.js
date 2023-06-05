// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2023  flexiWAN Ltd.

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
const mongoConns = require('../mongoConns.js')();
const Schema = mongoose.Schema;
const { validateIPv4 } = require('./validators.js');

// Define a getter on object ID that
// converts it to a string
Schema.ObjectId.get(v => v ? v.toString() : v);

const vrrpDeviceSchema = new Schema({
  device: {
    type: Schema.Types.ObjectId,
    ref: 'devices',
    required: true
  },
  interface: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  priority: {
    type: Number,
    required: true,
    min: [0, 'priority should be a number between 1-255'],
    max: [255, 'priority should be a number between 1-255']
  },
  trackInterfaces: {
    type: [mongoose.Schema.Types.ObjectId],
    required: false,
    default: []
  },
  status: {
    type: String,
    enum: ['installed', 'pending', 'failed', 'removed']
  }
}, {
  timestamps: false
});

const statusSchema = new Schema({
  installed: {
    type: Number,
    default: 0
  },
  pending: {
    type: Number,
    default: 0
  },
  failed: {
    type: Number,
    default: 0
  }
},
{
  _id: false,
  timestamps: false
});

/**
 * VRRP Schema
 */

const vrrpSchema = new Schema({
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations',
    required: true
  },
  name: {
    type: String,
    required: false
  },
  virtualRouterId: {
    type: Number,
    required: true,
    min: [1, 'virtualRouterId should be a number between 1-255'],
    max: [255, 'virtualRouterId should be a number between 1-255']
  },
  virtualIp: {
    type: String,
    maxlength: [20, 'virtualIp length must be at most 20'],
    validate: {
      validator: validateIPv4,
      message: 'virtualIp should be a valid ip address'
    }
  },
  preemption: {
    type: Boolean,
    default: true,
    required: true
  },
  acceptMode: {
    type: Boolean,
    default: false,
    required: true
  },
  devices: [vrrpDeviceSchema],
  status: {
    type: statusSchema,
    default: statusSchema
  }
}, {
  timestamps: true
});

module.exports = mongoConns.getMainDB().model('vrrp', vrrpSchema);
