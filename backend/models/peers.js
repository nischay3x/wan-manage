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
const validators = require('./validators');

/**
 * Peers Database Schema
 */
const peerSchema = new Schema({
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations',
    required: true
  },
  // Name of the peer configuration - for UI purpose only
  name: {
    type: String,
    required: [true, 'Name must be set']
  },
  localFQDN: {
    type: String,
    required: [true, 'Local FQDN must be set'],
    validate: {
      validator: validators.validateStringNoSpaces,
      message: 'Local FQDN cannot include spaces'
    }
  },
  remoteFQDN: {
    type: String,
    required: [true, 'Remote FQDN must be set'],
    validate: {
      validator: validators.validateStringNoSpaces,
      message: 'Remote FQDN cannot include spaces'
    }
  },
  psk: {
    type: String,
    required: [true, 'PSK must be set'],
    validate: {
      validator: validators.validateStringNoSpaces,
      message: 'PSK cannot include spaces'
    }
  },
  remoteIP: {
    type: String,
    required: [true, 'Remote IP must be set'],
    validate: {
      validator: validators.validateIPv4,
      message: 'Remote IP should be a valid ipv4 address'
    }
  },
  urls: {
    type: [{
      type: String,
      required: true,
      validate: {
        validator: validators.validateFQDN,
        message: 'URL should be a valid FQDN'
      }
    }],
    validate: {
      validator: val => val.length > 0,
      message: 'urls should be a list of URLs'
    }
  },
  ips: {
    type: [{
      type: String,
      required: true,
      validate: {
        validator: validators.validateIPv4,
        message: 'IP should be a valid ip address'
      }
    }],
    validate: {
      validator: val => val.length > 0,
      message: 'ips should be a list of IP addresses'
    }
  }
}, {
  timestamps: true
});

// Peer name per org must be unique
peerSchema.index({ name: 1, org: 1 }, { unique: true });

// Default exports
module.exports = mongoConns.getMainDB().model('peers', peerSchema);
