/**
 * This module sends info to web hooks
 */
const fetch = require('fetch-with-proxy').default;
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});

class WebHooks {
  constructor () {
    this.sendToWebHook = this.sendToWebHook.bind(this);
  }

  /**
     * Sends a POST request to web hooks.
     * @async
     * @param  {string}         url     url to send the message to
     * @param  {Object}         message JSON object to send in body
     * @param  {string}         secret  secret key to send in the message (secret field)
     * @param  {string}         msgTitle A string describing the type of the message,
     * such as notification, user invitation, etc.
     * @return {boolean|Object}         false if send failed, response object otherwise
     */
  async sendToWebHook (url, message, secret, msgTitle) {
    // For an empty url (development), return true
    if (url === '') return Promise.resolve(true);
    let data;

    // Check if the URL belongs to Slack or MS Teams
    if (url.includes('hooks.slack.com')) {
    // Format the message for Slack
      const formattedMessage = msgTitle + Object.keys(message).map(
        key => `${key}: ${message[key]}`).join('\n');
      const slackMessage = { text: formattedMessage };
      data = JSON.stringify({ ...slackMessage, secret });
    } else if (url.includes('.office.com')) {
    // Format the message for MS teams
    // TODO identify MS teams in a more specific way since this check is not specific enough
      const teamsMessage = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: msgTitle,
        sections: [{
          text: msgTitle + JSON.stringify(message, null, 2)
        }]
      };
      data = JSON.stringify({ ...teamsMessage, secret });
    } else {
    // Default formatting with identifier for other webhooks
      data = JSON.stringify({ msgTitle, ...message, secret });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'User-Agent': 'flexiWAN webhook plugin'
    };

    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: data
    })
      .then(response => {
        return response.json()
          .then(json => {
            response.message = json;
            return response;
          },
          error => {
            throw error;
          });
      },
      error => {
        throw error;
      })
      .then(response => {
        if (response.ok) {
          // Success handling
          if (response.message === 1 || response.message.status === 'success') return true;
          return false;
        } else return false;
      })
      .catch((error) => {
        logger.error('Failed to send webhook', { params: { url, error } });
        // General error handling
        return false;
      });
  }
}

let webHooksHandler = null;
module.exports = function (secretKey) {
  if (webHooksHandler) return webHooksHandler;
  else {
    webHooksHandler = new WebHooks();
    return webHooksHandler;
  }
};
