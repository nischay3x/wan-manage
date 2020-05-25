// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const fetchUtils = require('../utils/fetchUtils');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });
const configs = require('../configs')();
const applications = require('../models/applications');

/***
 * This class serves as the applications update manager, responsible for
 * polling the repository for applications file and replacement of the
 * file in the database when remote update time has changed.
 ***/
class ApplicationsUpdateManager {
  /**
    * Creates a ApplicationsUpdateManager instance
    */
  constructor () {
    this.applicationsUri = configs.get('applicationsUrl');
  }

  /**
    * A static singleton that creates an ApplicationsManagerInstance.
    *
    * @static
    * @return an instance of an ApplicationsUpdateManager class
    */
  static getApplicationsManagerInstance () {
    if (applicationsUpdater) return applicationsUpdater;
    applicationsUpdater = new ApplicationsUpdateManager();
    return applicationsUpdater;
  }

  /**
    * Polls the applications file.
    * @async
    * @return {void}
    */
  async pollApplications () {
    logger.info('Begin fetching global applications file', {
      params: { applicationsUri: this.applicationsUri }
    });
    try {
      // TODO: fetch from url
      // const result = await fetchUtils.fetchWithRetry(this.applicationsUri, 3);
      // const body = await result.json();
      const fs = require('fs');
      const result = fs.readFileSync(this.applicationsUri);
      const body = JSON.parse(result);
      logger.debug('Imported applications response received', {
        params: { time: body.meta.time, rulesCount: body.applications.length }
      });

      // check stored time against received one. If same, do not update
      const applicationsResult =
        await applications.findOne();
      if (applicationsResult) {
        const { meta } = applicationsResult;
        if (meta.time === body.meta.time) {
          return;
        }
      }

      const set = { $set: { meta: body.meta, applications: body.applications } };
      const options = {
        upsert: true,
        setDefaultsOnInsert: true,
        useFindAndModify: false
      };
      await applications.findOneAndUpdate({}, set, options);
      logger.info('Applications database updated', {
        params: { time: body.meta.time, rulesCount: body.applications.length }
      });
    } catch (err) {
      logger.error('Failed to query applications file', {
        params: { err: err.message }
      });
    }
  }
}

let applicationsUpdater = null;
module.exports = {
  getApplicationsManagerInstance: ApplicationsUpdateManager.getApplicationsManagerInstance
};
