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
const { getOldInterfaceIdentification } = require('../deviceLogic/interfaces');
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });

async function up () {
  // Change all pci keys to devId for each interface
  try {
    await devices.aggregate([
      {
        $addFields: {
          interfaces: {
            $map: {
              input: '$interfaces',
              as: 'inter',
              in: {
                devId: { $concat: ['pci:', '$$inter.pciaddr'] },
                driver: '$$inter.driver',
                dhcp: '$$inter.dhcp',
                IPv4: '$$inter.IPv4',
                IPv6: '$$inter.IPv6',
                PublicIP: '$$inter.PublicIP',
                PublicPort: '$$inter.PublicPort',
                NatType: '$$inter.NatType',
                useStun: '$$inter.useStun',
                gateway: '$$inter.gateway',
                metric: '$$inter.metric',
                isAssigned: '$$inter.isAssigned',
                routing: '$$inter.routing',
                type: '$$inter.type',
                pathlabels: '$$inter.pathlabels',
                monitorInternet: '$$inter.monitorInternet',
                internetAccess: '$$inter.internetAccess',
                _id: '$$inter._id',
                MAC: '$$inter.MAC',
                name: '$$inter.name',
                IPv4Mask: '$$inter.IPv4Mask',
                updatedAt: '$$inter.updatedAt',
                createdAt: '$$inter.createdAt',
                IPv6Mask: '$$inter.IPv6Mask'
              }
            }
          }
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
    const devDocuments = await devices.find({}).lean();
    for (const deviceDoc of devDocuments) {
      const { interfaces } = deviceDoc;
      if (interfaces) {
        const updated = interfaces.map(i => {
          const pciaddr = i.devId ? getOldInterfaceIdentification(i.devId) : '';
          if (i.devId) {
            delete i.devId;
          }

          return { ...i, pciaddr: pciaddr };
        });

        await devices.updateOne(
          { _id: deviceDoc._id },
          { $set: { interfaces: updated } },
          { upsert: false, strict: false }
        );
      }
    }

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
