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

const configs = require('../configs')();
const periodic = require('./periodic')();
const diffieHellmans = require('../models/diffieHellmans');
const ha = require('../utils/highAvailability')(configs.get('redisUrl'));
const { generateDHKey } = require('../workers/main');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });

/***
 * This class runs every 3 minutes and checks if needed to generate new keys
 *
 ***/
class DiffieHellmanStack {
  /**
     * Creates an instance of the diffieHellmanStack class
     */
  constructor () {
    this.start = this.start.bind(this);
    this.periodicGenerateKeys = this.periodicGenerateKeys.bind(this);

    // Task information
    this.taskInfo = {
      name: 'generate_dh_keys',
      func: this.periodicGenerateKeys,
      handle: null,
      period: (1000 * 60 * 3) // Runs every 3 minutes
    };
  }

  /**
     * Starts the generate_dh_keys periodic task
     * @return {void}
     */
  start () {
    const { name, func, period } = this.taskInfo;
    periodic.registerTask(name, func, period);
    periodic.startTask(name);
  }

  /**
     * Check the Diffie-Hellman collection if has less than 50 keys
     * @return {void}
     */
  periodicGenerateKeys () {
    ha.runIfActive(async () => {
      const keys = await diffieHellmans.countDocuments();

      if (keys < 50) {
        const newKey = await generateDHKey();
        await diffieHellmans.create({
          key: newKey
        });

        logger.debug('Generated a Diffie-Hellman key', {
          params: { keys: keys + 1 },
          periodic: { task: this.taskInfo }
        });
      }
    });
  }
}

var diffieHellmanStack = null;
module.exports = function () {
  if (diffieHellmanStack) return diffieHellmanStack;
  diffieHellmanStack = new DiffieHellmanStack();
  return diffieHellmanStack;
};
