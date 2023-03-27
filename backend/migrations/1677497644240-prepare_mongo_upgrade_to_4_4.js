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

const mongoConns = require('../mongoConns.js')();

const logger = require('../logging/logging')({
  module: module.filename,
  type: 'migration'
});

const sleep = () => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 1000);
  });
};

async function up () {
  try {
    let isConnected = false;
    for (let i = 0; i < 10; i++) {
      if (mongoConns.getMainDB().readyState === 1) {
        isConnected = true;
        break;
      }
      await sleep();
    }

    if (!isConnected) {
      throw new Error('Failed to connect to mongodb within 10 seconds');
    }

    const currentVal = await mongoConns.getMainDB().db.admin().command({
      getParameter: 1, featureCompatibilityVersion: 1
    });

    if (currentVal.featureCompatibilityVersion.version !== '4.2') {
      await mongoConns.getMainDB().db.admin().command({
        setFeatureCompatibilityVersion: '4.2'
      });

      logger.info('Database migration succeeded', {
        params: { collections: ['admin'], operation: 'up' }
      });
    }
  } catch (err) {
    logger.error('Database migration failed', {
      params: {
        collections: ['admin'],
        operation: 'up',
        err: err.message
      }
    });
    throw new Error(err.message);
  }
}

async function down () {

}

module.exports = { up, down };
