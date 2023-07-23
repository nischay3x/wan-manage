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
const Organizations = require('../models/organizations');
const { membership } = require('../models/membership');

const systemNotificationsConf = {
  'Device connection': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  },
  'Running router': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  },
  'Link/Tunnel round trip time': {
    warningThreshold: 300,
    criticalThreshold: 600,
    thresholdUnit: 'ms',
    severity: null,
    immediateEmail: false,
    resolvedAlert: false,
    type: 'tunnel'
  },
  'Link/Tunnel default drop rate': {
    warningThreshold: 5,
    criticalThreshold: 20,
    thresholdUnit: '%',
    severity: null,
    immediateEmail: false,
    resolvedAlert: false,
    type: 'tunnel'
  },
  'Device memory usage': {
    warningThreshold: 85,
    criticalThreshold: 95,
    thresholdUnit: '%',
    severity: null,
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  },
  'Hard drive usage': {
    warningThreshold: 85,
    criticalThreshold: 95,
    thresholdUnit: '%',
    severity: null,
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  },
  Temperature: {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: 'C°',
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  },
  'Policy change': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'warning',
    immediateEmail: false,
    resolvedAlert: null,
    type: 'policy'
  },
  'Software update': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'warning',
    immediateEmail: false,
    resolvedAlert: null,
    type: 'device'
  },
  'Internet connection': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'interface'
  },
  'Link status': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'interface'
  },
  'Missing interface ip': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'interface'
  },
  'Pending tunnel': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'tunnel'
  },
  'Tunnel connection': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'tunnel'
  },
  'Failed self-healing': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: null,
    type: 'device'
  },
  'Static route state': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: null,
    type: 'device'
  },
  'Synced device': {
    warningThreshold: null,
    criticalThreshold: null,
    thresholdUnit: null,
    severity: 'critical',
    immediateEmail: false,
    resolvedAlert: false,
    type: 'device'
  }
};

async function up () {
  try {
    // Create default Notifications settings (system default)
    await notificationConfModel.create([{
      name: 'Default notifications settings',
      rules: systemNotificationsConf
    }]);

    // Create default notification settings to any existing organization
    const organizations = await Organizations.find();
    organizations.forEach(async organization => {
      const orgExists = await notificationConfModel.findOne({ org: organization._id });
      if (!orgExists) {
        const ownerMembership = await membership.find({
          account: organization.account,
          to: 'account',
          role: 'owner'
        });
        const accountOwners = [];
        if (ownerMembership) {
          ownerMembership.forEach(owner => {
            accountOwners.push(owner.user);
          });
        }
        await notificationConfModel.create({
          org: organization._id,
          rules: systemNotificationsConf,
          signedToDaily: accountOwners,
          webHookSettings: { webhookURL: '', sendCriticalAlerts: false, sendWarningAlerts: false }
        });
      }
    });
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['notifications'], operation: 'up', err: err.message }
    });
  }
}

async function down () {
}

module.exports = { up, down };
