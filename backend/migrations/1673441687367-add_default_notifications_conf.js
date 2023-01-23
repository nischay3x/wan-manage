// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2022  flexiWAN Ltd.

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

const notificationConfModel = require('../models/notificationsConf');
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });

async function up () {
  try {
    // Create default Notifications settings (factory default)
    await notificationConfModel.create([{
      name: 'Default notifications settings',
      rules: [
        {
          event: 'Device connection',
          warningThreshold: null,
          criticalThreshold: null,
          thresholdUnit: null,
          severity: 'critical',
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Running router',
          warningThreshold: null,
          criticalThreshold: null,
          thresholdUnit: null,
          severity: 'critical',
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          rowKey: 3,
          event: 'Link/Tunnel round trip time',
          warningThreshold: 300,
          criticalThreshold: 600,
          thresholdUnit: 'ms',
          severity: null,
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Link/Tunnel default drop rate',
          warningThreshold: 5,
          criticalThreshold: 20,
          thresholdUnit: '%',
          severity: null,
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Device memory usage',
          warningThreshold: 85,
          criticalThreshold: 95,
          thresholdUnit: '%',
          severity: null,
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Hard drive usage',
          warningThreshold: 85,
          criticalThreshold: 95,
          thresholdUnit: '%',
          severity: null,
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Temperature',
          warningThreshold: null,
          criticalThreshold: null,
          thresholdUnit: 'C°',
          severity: 'critical',
          immediateEmail: false,
          resolvedAlert: true
        },
        {
          event: 'Policy change',
          warningThreshold: null,
          criticalThreshold: null,
          thresholdUnit: null,
          severity: 'warning',
          immediateEmail: false,
          resolvedAlert: null
        },
        {
          event: 'Software update',
          warningThreshold: null,
          criticalThreshold: null,
          thresholdUnit: null,
          severity: 'warning',
          immediateEmail: false,
          resolvedAlert: null
        }]
    }]);
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['notifications'], operation: 'up', err: err.message }
    });
  }
}

async function down () {
}

module.exports = { up, down };
