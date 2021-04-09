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

const { Schema } = require('mongoose');
const {
  validateRuleName,
  validateIPv4WithMask,
  validatePortRange
} = require('./validators');

// Source classification schema
const sourceClassificationSchema = new Schema({
  ipPort: {
    ip: {
      type: String,
      maxlength: [20, 'ip length must be at most 20'],
      validate: {
        validator: validateIPv4WithMask,
        message: 'IPv4 should be a valid ip address'
      }
    },
    ports: {
      type: String,
      validate: {
        validator: validatePortRange,
        message: 'ports should be a valid ports range'
      }
    }
  },
  trafficId: {
    type: String,
    maxlength: [25, 'trafficId must be at most 25']
  }
});

// Destination classification schema
const destinationClassificationSchema = new Schema({
  ipProtoPort: {
    ip: {
      type: String,
      maxlength: [20, 'ip length must be at most 20'],
      validate: {
        validator: validateIPv4WithMask,
        message: 'IPv4 should be a valid ip address'
      }
    },
    ports: {
      type: String,
      validate: {
        validator: validatePortRange,
        message: 'ports should be a valid ports range'
      }
    },
    protocols: [{
      type: String,
      enum: ['tcp', 'udp', 'icmp']
    }],
    interface: {
      type: String,
      maxlength: [25, 'interface must be at most 25']
    }
  },
  trafficId: {
    type: String,
    maxlength: [25, 'trafficId must be at most 25']
  },
  trafficTags: {
    category: {
      type: String,
      maxlength: [20, 'category must be at most 20']
    },
    serviceClass: {
      type: String,
      maxlength: [20, 'service class must be at most 20']
    },
    importance: {
      type: String,
      enum: ['', 'high', 'medium', 'low']
    }
  }
});

// Rule schema
const firewallRuleSchema = new Schema({
  name: {
    type: String,
    required: true,
    validate: {
      validator: validateRuleName,
      message: 'Firewall rule name format is invalid'
    }
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    default: 'inbound',
    required: true
  },
  inbound: {
    type: String,
    enum: ['edgeAccess', 'portForward', 'nat1to1'],
    default: 'edgeAccess',
    required: true
  },
  internalIP: {
    type: String,
    required: false
  },
  internalPortStart: {
    type: String,
    required: false
  },
  priority: {
    type: Number,
    min: [0, 'priority should be a number between 0-1000'],
    max: [1000, 'priority should be a number between 0-1000'],
    required: true
  },
  status: {
    type: String,
    enum: ['enabled', 'disabled'],
    default: 'enabled',
    required: true
  },
  classification: {
    source: sourceClassificationSchema,
    destination: destinationClassificationSchema
  },
  action: {
    type: String,
    enum: ['allow', 'deny'],
    default: 'allow',
    required: true
  },
  interfaces: [{
    type: String
  }]
});

module.exports = { firewallRuleSchema };
