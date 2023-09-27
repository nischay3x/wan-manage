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
const Schema = mongoose.Schema;
const mongoConns = require('../mongoConns.js')();

/**
 * Locks Database Schema
 */
const tokenSchema = new Schema({
  // Tunnel num
  tunnelId: {
    type: String,
    required: true
  },
  // Organization id
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations',
    required: true
  },
  // The status of the lock for this tunnel
  status: {
    type: String,
    required: true,
    default: 'unlocked',
    enum: ['locked', 'unlocked']
  }
});

// indexing
tokenSchema.index({ tunnelId: 1, org: 1 }, { unique: true });

// Default exports
module.exports = mongoConns.getMainDB().model('tokens', tokenSchema);
