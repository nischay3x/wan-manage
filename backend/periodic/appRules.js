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

const periodic = require('./periodic')();
const AppRulesUpdater = require('../deviceLogic/AppRulesUpdateManager');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });

/***
 * This class periodically checks if the latest application rules were changed
 * and if so, updates the database with the new latest version
 ***/
class AppRules {
  /**
    * Creates an instance of the AppRules class
    */
  constructor () {
    this.appRulesUpdater = null;
    this.start = this.start.bind(this);
    this.periodicCheckAppRules = this.periodicCheckAppRules.bind(this);

    this.taskInfo = {
      name: 'check_app_rules',
      func: this.periodicCheckAppRules,
      handle: null,
      period: (1000 * 60 * 60 * 24) // Runs once an day
    };
  }

  /**
    * Starts the check_app_rules periodic task.
    * @return {void}
    */
  async start () {
    try {
      this.appRulesUpdater = await AppRulesUpdater.getAppRulesUpdaterInstance();
    } catch (err) {
      logger.error('Application rules periodic task failed to start', {
        params: { err: err.message },
        periodic: { task: this.taskInfo }
      });
      return;
    }

    // Get the version upon starting up
    this.periodicCheckAppRules();

    // Runs once every hour
    const { name, func, period } = this.taskInfo;
    periodic.registerTask(name, func, period);
    periodic.startTask(name);
  }

  /**
    * Polls app rules repository to check if
    * a rules file has been released.
    * @return {void}
    */
  periodicCheckAppRules () {
    this.appRulesUpdater.pollAppRules();
  }
}

let appRules = null;
module.exports = function () {
  if (appRules) return appRules;
  appRules = new AppRules();
  return appRules;
};
