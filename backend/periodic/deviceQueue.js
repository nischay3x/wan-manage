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
const ha = require('../utils/highAvailability')(configs.get('redisUrl'));
const deviceQueues = require('../utils/deviceQueue')(
  configs.get('kuePrefix'),
  configs.get('redisUrl')
);

/***
 * This class runs once a day and to checks
 * device jobs and delete more than a week old jobs
 ***/
class DeviceQueues {
  /**
    * Creates a DeviceQueues instance
    */
  constructor () {
    this.start = this.start.bind(this);
    this.periodicCheckJobs = this.periodicCheckJobs.bind(this);
  }

  /**
     * Starts the check_deviceJobs periodic task
     * @return {void}
     */
  start () {
    periodic.registerTask('check_deviceJobs', this.periodicCheckJobs, 86400000); // run once a day
    periodic.startTask('check_deviceJobs');
  }

  /**
     * Removes completed/failed/inactive jobs that
     * are more than a week old
     * @return {void}
     */
  periodicCheckJobs () {
    ha.runIfActive(() => {
      // Delete 7 days old jobs
      deviceQueues.removeJobs('complete', 604800000);
      deviceQueues.removeJobs('failed', 604800000);
      deviceQueues.removeJobs('inactive', 604800000);
    });
  }
}

var checkjobs = null;
module.exports = function () {
  if (checkjobs) return checkjobs;
  else {
    checkjobs = new DeviceQueues();
    return checkjobs;
  }
};
