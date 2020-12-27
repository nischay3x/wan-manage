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
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });

async function up () {
  // add device type field
  try {
    await devices.aggregate([
      {
        $addFields: {
          'interfaces.deviceType': ''
        }
      },
      { $out: 'devices' }
    ]);

    logger.info('Database migration done!', {
      params: { collections: ['devices'], operation: 'up' }
    });
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['devices'], operation: 'up', err: err.message }
    });
  }
}

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
async function down () {
  try {
    await devices.aggregate([
      {
        $unset: {
          'interfaces.deviceType': ''
        }
      },
      { $out: 'devices' }
    ]);

    logger.info('Database migration done!', {
      params: { collections: ['devices'], operation: 'down' }
    });
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['devices'], operation: 'down', err: err.message }
    });
  }
}

module.exports = { up, down };
