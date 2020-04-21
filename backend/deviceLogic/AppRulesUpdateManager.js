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

const fetch = require('node-fetch');
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
    * Fetches a uri. Tries up to numOfTrials before giving up.
    * @async
    * @param  {string}   uri         the uri to fetch
    * @param  {number}   numOfTrials the max number of trials
    * @return {Promise}              the response from the uri
    */
  async fetchWithRetry (uri, numOfTrials) {
    let res;
    for (let trial = 0; trial < numOfTrials; trial++) {
      res = await fetch(uri);
      if (res.ok) return res;
      throw (new Error(res.statusText));
    }
  }

  /**
    * Polls the app rules file.
    * @async
    * @return {void}
    */
  async pollAppRules () {
    logger.debug('Begin fetching application rules');
    try {
      const res = await this.fetchWithRetry(this.appRulesUri, 3);
      const body = await res.json();
      const metaTime = new Date(body.meta.time);
      logger.info('Got response meta time', {
        params: { metaTime: metaTime, rules: body.applications.length }
      });
      // drop existing collection
      ImportedApplications.importedapplications.deleteMany({}, async function (err, result) {
        if (err) {
          logger.warn('Delete documents failed', {
            params: { err: err.message }
          });
          return;
        }
        logger.debug('Delete documents success', {
          params: { count: result.deletedCount }
        });
        // add updated entry
        logger.info('Updating importedapplications collection');
        await ImportedApplications.importedapplications.create([body]);
      });
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
