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
 * This module allows to send email from the webserver
 * It users sendMail as mail server connected as SMTP
 */
const nodemailer = require('nodemailer');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

class Mailer {
  /**
     * Initialize mailer class
     * @param {string} host               smtp hostname
     * @param {number} port               smtp port
     * @param {boolean} bypassCertificate true = bypass, false = don't bypass (default: false)
     *                                    Sometimes need to disable certificate validation for
     *                                    some anti-virus with MITM
     */
  constructor (host, port, bypassCertificate = false) {
    this.sendMailHTML = this.sendMailHTML.bind(this);

    const transportOptions = {
      service: 'local',
      host: host,
      port: port,
      logger: logger,
      debug: true
    };
    if (bypassCertificate) transportOptions.tls = { rejectUnauthorized: false };
    this.smtpTransport = nodemailer.createTransport(transportOptions);
  }

  /**
     * Sends email with html body.
     * @param  {string}  from    From user
     * @param  {string}  to      To users
     * @param  {string}  subject Subject of email
     * @param  {string}  html    HTML to embed in the mail
     * @return {Promise}
     */
  sendMailHTML (from, to, subject, html) {
    const mailOptions = {
      from: from,
      to: to,
      subject: subject,
      generateTextFromHTML: true,
      html: html
    };

    const p = new Promise((resolve, reject) => {
      this.smtpTransport.sendMail(mailOptions, (error, response) => {
        let success = true;
        if (error) {
          logger.error('Send mail error', { params: { mailOptions: mailOptions, error: error } });
          success = false;
        }
        this.smtpTransport.close();
        if (success) resolve();
        else reject(error);
      });
    });
    return p;
  }
}

let mailerHandler = null;
module.exports = function (host, port, bypassCertificate) {
  if (mailerHandler) return mailerHandler;
  else {
    mailerHandler = new Mailer(host, port, bypassCertificate);
    return mailerHandler;
  }
};
