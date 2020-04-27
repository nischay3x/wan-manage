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
const ImportedApplications = require('../models/importedapplications');

/***
 * This class serves as the application rules update manager, responsible for
 * polling the repository for application rules file and replacement of the
 * file in the database.
 ***/
class AppRulesUpdateManager {
  /**
    * Creates a AppRulesUpdateManager instance
    */
  constructor () {
    this.appRulesUri = configs.get('appRulesUrl');
  }

  /**
    * A static factory method that creates and initializes the
    * AppRulesUpdateManager instance.
    * @static
    * @async
    * @return {Promise} an instance of AppRulesUpdateManager class
    */
  static async createAppRulesUpdateManager () {
    return new AppRulesUpdateManager();
  }

  /**
    * A static singleton that creates a AppRulesUpdateManager.
    *
    * @static
    * @return {Promise} an instance of AppRulesUpdateManager class
    */
  static getAppRulesManagerInstance () {
    if (appRulesUpdater) return appRulesUpdater;
    appRulesUpdater = AppRulesUpdateManager.createAppRulesUpdateManager();
    return appRulesUpdater;
  }

  /**
    * Polls the app rules file.
    * @async
    * @return {void}
    */
  async pollAppRules () {
    logger.debug('Begin fetching application rules');
    try {
      const result = await fetchUtils.fetchWithRetry(this.appRulesUri, 3);
      const body = await result.json();
      logger.info('Got response', {
        params: { time: body.meta.time, rulesCount: body.applications.length }
      });

      // check stored time against received one. If same, do not update
      const importedApplicationsResult = await ImportedApplications.importedapplications.findOne();
      if (importedApplicationsResult && importedApplicationsResult.meta.time === body.meta.time) {
        logger.debug('application rules update time unchanged, returning...');
        return;
      }

      logger.debug('Updating imported applications database...');
      const query = {};
      const set = { $set: { meta: body.meta, applications: body.applications } };
      const options = {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        useFindAndModify: false
      };
      await ImportedApplications.importedapplications.findOneAndUpdate(query, set, options);
    } catch (err) {
      logger.error('Failed to query app rules', {
        params: { err: err.message }
      });
    }
  }
}

let appRulesUpdater = null;
module.exports = {
  getAppRulesUpdaterInstance: AppRulesUpdateManager.getAppRulesManagerInstance
};
