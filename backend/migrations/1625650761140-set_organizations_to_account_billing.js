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
const flexibilling = require('../flexibilling');
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });
const orgModel = require('../models/organizations');
const { devices } = require('../models/devices');
/**
 * Make any changes you need to make to the database here
 */
async function up () {
  return new Promise((resolve, reject) => {
    logger.info('Wait few seconds to billing database to completely load');
    try {
      // wait for billing database to load
      setTimeout(async () => {
        const accountsSummery = await flexibilling.getBillingAccountsSummary();

        for (const summery of accountsSummery) {
          // if billing database is updated, for some reason, *before* this migration,
          // empty organization array is created automatically. If not, we create it
          if (!summery.organizations) {
            summery.organizations = [];
          }

          // update org array if empty
          if (summery.organizations.length === 0) {
            const orgs = await orgModel.find({ account: summery.account }).lean();
            for (const org of orgs) {
              const devicesCount = await devices.countDocuments({
                account: summery.account, org: org._id
              });

              if (devicesCount > 0) {
                summery.organizations.push({
                  org: org._id,
                  current: devicesCount,
                  max: devicesCount
                });
              }
            }
            await flexibilling.updateAccountOrganizations(summery._id, summery.organizations);
          }
        }

        return resolve();
      }, 8000); // it takes time to billing database to loaded
    } catch (err) {
      logger.error('Database migration failed', {
        params: { collections: ['devices'], operation: 'up', err: err.message }
      });
      return reject(err);
    }
  });
}

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
async function down () {
  return true;
}

module.exports = { up, down };
