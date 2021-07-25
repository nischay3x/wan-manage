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
const useFlexiBilling = require('../configs')().get('useFlexiBilling', 'boolean');

const sleep = (time) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      return resolve();
    }, time);
  });
};
/**
 * Make any changes you need to make to the database here
 */
async function up () {
  // no need to merge on server that doesn't work with our billing system
  if (!useFlexiBilling) {
    return true;
  }

  // It takes time for the billing database to load
  let count = 0;
  do {
    console.log('waiting to flexiBilling database to load');
    await sleep(2000);
    if (count < 10) {
      count++;
    } else {
      const errMsg = 'The billing database was not initialized after 20 seconds';
      logger.error(errMsg, { params: { collections: ['devices'], operation: 'up' } });
      throw new Error(errMsg);
    }
  } while (flexibilling.isDbConnected() === false);

  // The billing database initialized, we can start the migration
  try {
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

    return true;
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['devices'], operation: 'up', err: err.message }
    });
    throw new Error(err);
  }
};

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
async function down () {
  return true;
}

module.exports = { up, down };
