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

/**
 * This module takes a decision whether this instance of flexiManage is active
 * or standby. It relies on redis semaphore used by redis-leader
 */
const configs = require('../configs')();
const redis = require('redis');
const Leader = require('./redis-leader');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });

class HighAvailability {
  /**
   * Constructor
   * @param {String} redisUrl - redis URL
   */
  constructor (redisUrl) {
    // Create a redisClient based on the redis URL
    this.redis = redis.createClient({ url: configs.get('redisUrl') });
    // Create a leader
    const options = {
      key: 'haleaderselect',
      ttl: 2000,
      wait: 1000
    };
    this.leader = new Leader(this.redis, options);
    logger.info('HighAvailability init', { params: { redisUrl: redisUrl, options: options } });

    // Callback functions
    this.callbacks = {
      elected: {},
      revoked: {},
      error: {}
    };

    this.leader.on('error', (err) => {
      logger.error('HighAvailability error', { params: { redisUrl: redisUrl, err: err.message } });
      this.callRegisteredCallbacks('error');
    });
    this.leader.on('elected', () => {
      logger.info('HighAvailability elected', { params: { redisUrl: redisUrl } });
      this.callRegisteredCallbacks('elected');
    });
    this.leader.on('revoked', () => {
      logger.info('HighAvailability revoked', { params: { redisUrl: redisUrl } });
      this.callRegisteredCallbacks('revoked');
    });

    // Try to elect this as active
    this.leader.elect();

    // Bind class functions
    this.runIfActive = this.runIfActive.bind(this);
    this.registerCallback = this.registerCallback.bind(this);
    this.unregisterCallback = this.registerCallback.bind(this);
    this.callRegisteredCallbacks = this.callRegisteredCallbacks.bind(this);
  }

  runIfActive (func) {
    this.leader.isLeader((err, isLeader) => {
      if (err) {
        logger.error('HighAvailability isLeader error', {
          params: { err: err.message }
        });
      } else {
        if (isLeader) {
          func();
        }
      }
    });
  }

  /**
   * Registers a callback function for a module that
   * @param  {string}   event    the name of the event to run the callback
   * @param  {string}   name     the name of the module that registers the callback
   * @param  {Callback} callback the callback to be registered
   * @return {void}
   */
  registerCallback (event, name, callback) {
    if (this.callbacks[event] && name && typeof callback === 'function') {
      this.callbacks[event][name] = callback;
    }
  }

  /**
   * Removes a previously registered callback functions.
   * @param  {string} event    the name of the event to run the callback
   * @param  {string} name the name of the module that registers the callback
   * @return {void}
   */
  unregisterCallback (event, name) {
    if (this.callbacks[event] && this.callbacks[event].hasOwnProperty(name)) {
      delete this.callbacks[event][name];
    }
  }

  /**
   * Calls all registered callback for the provided event
   * @param  {string} event the name of the event to run the callbacks
   * @return {void}
   */
  callRegisteredCallbacks (event) {
    if (this.callbacks[event]) {
      for (const moduleName in this.callbacks[event]) {
        const callback = this.callbacks[event][moduleName];
        if (typeof callback === 'function') {
          callback();
        }
      }
    }
  }
}

var highAvailabilityHandler = null;
module.exports = function (redisUrl) {
  if (highAvailabilityHandler) return highAvailabilityHandler;
  else {
    highAvailabilityHandler = new HighAvailability(redisUrl);
    return highAvailabilityHandler;
  }
};
