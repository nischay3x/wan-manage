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

/**
 * This module contains fetch helper functions to be used with
 * device logic classes.
 */

// const fetch = require('node-fetch');
const request = require('request');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });

/**
    * Fetches a uri. Tries up to numOfTrials before giving up.
    * @async
    * @param  {string}   uri         the uri to fetch
    * @param  {number}   numOfTrials the max number of trials
    * @return {Promise}              the response from the uri
    */

const requestPromise = uri => {
  return new Promise((resolve, reject) => {
    request(uri, function (error, response, body) {
      if (error) {
        return reject(error);
      } else {
        return resolve(body);
      }
    });
  });
};

const fetchWithRetry = async (uri, numOfTrials) => {
  logger.debug('Fetching uri', {
    params: { uri, numOfTrials }
  });
  let res;

  for (let trial = 0; trial < numOfTrials; trial++) {
    try {
      res = await requestPromise(uri);
      return JSON.parse(res);
    } catch (e) {
      throw (new Error(e));
    }
  }
};

module.exports = {
  fetchWithRetry
};
