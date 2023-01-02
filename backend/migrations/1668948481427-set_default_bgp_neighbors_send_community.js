
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
const mongoose = require('mongoose');
const { devices } = require('../models/devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });

/**
 * Make any changes you need to make to the database here
 */
async function up () {
  try {
    const communityRes = await devices.updateMany(
      {
        'bgp.neighbors': { $exists: true, $not: { $size: 0 } },
        'bgp.neighbors.sendCommunity': { $ne: 'all' }
      },
      { $set: { 'bgp.neighbors.$[].sendCommunity': 'all' } },
      { upsert: false }
    );

    const operations = [];
    const devicesList = await devices.find(
      { routingFilters: { $exists: true, $not: { $size: 0 } } },
      { routingFilters: 1 }
    ).lean();

    for (const device of devicesList) {
      const routingFilters = device.routingFilters.map(r => {
        const defaultRule = {
          _id: mongoose.Types.ObjectId(),
          route: '0.0.0.0/0',
          action: r.defaultAction,
          nextHop: '',
          priority: 0
        };

        return {
          _id: mongoose.Types.ObjectId(r._id),
          name: r.name,
          description: r.description,
          rules: [
            defaultRule,
            ...r.rules.map((rule, idx) => {
              return {
                _id: mongoose.Types.ObjectId(rule._id),
                route: rule.network,
                action: r.defaultAction === 'allow' ? 'deny' : 'allow',
                nextHop: '',
                priority: idx + 1
              };
            })
          ]
        };
      });

      operations.push({
        updateOne: {
          filter: { _id: device._id },
          update: { $set: { routingFilters: routingFilters } },
          upsert: false
        }
      });
    }

    // write bulk
    const res = await devices.collection.bulkWrite(operations);

    logger.info('Device bgp.neighbors.sendCommunity and routingFilter migration succeeded', {
      params: { collections: ['devices'], operation: 'up', communityRes, res }
    });
  } catch (err) {
    logger.error('Device bgp.neighbors.sendCommunity and routingFilter migration failed', {
      params: { collections: ['devices'], operation: 'up', err: err.message }
    });
    throw new Error(err.message);
  }
}

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
async function down () {
  try {
    const communityRes = await devices.updateMany(
      { 'bgp.neighbors': { $exists: true, $not: { $size: 0 } } },
      { $unset: { 'bgp.neighbors.$[].sendCommunity': '' } },
      { upsert: false }
    );

    const operations = [];

    const devicesList = await devices.find(
      { routingFilters: { $exists: true, $not: { $size: 0 } } },
      { routingFilters: 1 }
    ).lean();

    for (const device of devicesList) {
      const routingFilters = device.routingFilters.map(r => {
        const ret = {
          _id: mongoose.Types.ObjectId(r._id),
          name: r.name,
          description: r.description
        };

        const defaultRule = r.rules.find(rule => rule.route === '0.0.0.0/0');
        ret.defaultAction = defaultRule?.action ?? 'allow'; // not clear what to put in this case

        const filtered = r.rules.filter(rule => rule.action !== ret.defaultAction);
        ret.rules = filtered.map(rule =>
          ({ _id: mongoose.Types.ObjectId(rule._id), network: rule.route })
        );
        return ret;
      });

      operations.push({
        updateOne: {
          filter: { _id: device._id },
          update: { $set: { routingFilters: routingFilters } },
          upsert: false
        }
      });
    }

    // write bulk
    const res = await devices.collection.bulkWrite(operations);

    logger.info('Device bgp.neighbors.sendCommunity and routingFilter migration succeeded', {
      params: { collections: ['devices'], operation: 'down', communityRes, res }
    });
  } catch (err) {
    logger.error('Device bgp.neighbors.sendCommunity and routingFilter migration failed', {
      params: { collections: ['devices'], operation: 'down', err: err.message }
    });
    throw new Error(err.message);
  }
}

module.exports = { up, down };
