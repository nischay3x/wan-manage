// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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
const mapValues = require('lodash/mapValues');
const isPlainObject = require('lodash/isPlainObject');
const pick = require('lodash/pick');

/**
 * Convert a logging message intu pure javascript object
 * @param   {Object} obj (e.g. mongodb model)
 * @returns {Object} pure javascript object
 */
const deepObjectConvert = (obj) => {
  return (obj)
    ? (obj.toJSON)
      ? obj.toJSON()
      : isPlainObject(obj)
        ? mapValues(obj, deepObjectConvert)
        : (Array.isArray(obj))
          ? obj.map(deepObjectConvert)
          : obj
    : obj;
};

/**
 * Generate job logging info
 * @param   {Job Object} job
 * @returns {Object} javascript object for logging
 */
const jobLogger = (job) => {
  // Create a job logger object and limit tasks size
  const logJob = pick(job, [
    'id', 'type', 'data.message.title', 'data.metadata', 'priority', 'progress', 'state',
    'created_at', 'started_at', 'attempts'
  ]);
  if (job.data.message && job.data.message.tasks) {
    logJob.data.message.tasks = job.data.message.tasks.map(
      t => JSON.stringify(t).substring(0, 2048)
    );
  }
  if (job.data.response) logJob.data.response = deepObjectConvert(job.data.response);
  return logJob;
};

module.exports = {
  deepObjectConvert: deepObjectConvert,
  jobLogger: jobLogger
};
