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

// const fetchUtils = require('../utils/fetchUtils');
const logger = require('../logging/logging')({ module: module.filename, type: 'periodic' });
const configs = require('../configs')();
const library = require('../models/library');
const applications = require('../models/applications');
const organizations = require('../models/organizations');
const { membership } = require('../models/membership');
const ObjectId = require('mongoose').Types.ObjectId;
const notificationsMgr = require('../notifications/notifications')();
const mailer = require('../utils/mailer')(
  configs.get('mailerHost'),
  configs.get('mailerPort'),
  configs.get('mailerBypassCert')
);

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
    * Check on which devices installed older version of application
    * If found - send notification to the users
    * @async
    * @param {application} libraryApp
    * @param {Boolean}
    * @return {void}
    */
  async checkDevicesUpgrade (libraryApp) {
    // check if orgs have lower version - if yes notify
    const oldVersions = await applications.aggregate([
      {
        $match: {
          app: ObjectId(libraryApp._id),
          removed: false,
          installedVersion: { $ne: libraryApp.latestVersion },
          $or: [{ pendingToUpgrade: { $exists: false } }, { pendingToUpgrade: false }]
        }
      },
      {
        $lookup: {
          from: 'devices',
          localField: '_id',
          foreignField: 'applications.app',
          as: 'devices'
        }
      },
      {
        $project: {
          installedVersion: 1,
          org: 1,
          'devices._id': 1,
          'devices.machineId': 1
        }
      }
    ]);

    if (oldVersions.length > 0) {
      const notifications = [];

      for (let i = 0; i < oldVersions.length; i++) {
        const installedApp = oldVersions[i];
        const devices = installedApp.devices;

        if (devices.length) {
          const oldVersion = installedApp.installedVersion;
          const newVersion = libraryApp.latestVersion;

          devices.forEach(device => {
            notifications.push({
              org: installedApp.org,
              title: `Application ${libraryApp.name} upgrade`,
              time: new Date(),
              device: device._id,
              machineId: device.machineId,
              details:
              `This application requires upgrade from version ${oldVersion} to ${newVersion}`
            });
          });

          // mark as sent upgrade message
          await applications.updateOne(
            { _id: installedApp._id },
            { $set: { pendingToUpgrade: true } }
          );

          const organization = await organizations.findOne({ _id: installedApp.org });

          const memberships = await membership.find({
            account: organization.account,
            to: 'account',
            role: 'owner'
          },
          'user')
            .populate('user');

          const emailAddresses = memberships.map(doc => { return doc.user.email; });

          // TODO: fix email template
          await mailer.sendMailHTML(
            configs.get('mailerFromAddress'),
            emailAddresses,
            `Upgrade Your ${libraryApp.name} Application`,
            `<h2>Your application need to upgrade</h2><br>
            <b>Click below to upgrade your application:</b>
            <p><a href="${configs.get('uiServerUrl')}/applications">
            <button style="color:#fff;background-color:#F99E5B;
            border-color:#F99E5B;font-weight:400;text-align:center;
            vertical-align:middle;border:1px solid transparent;
            padding:.375rem .75rem;font-size:1rem;line-height:1.5;
            border-radius:.25rem;
            cursor:pointer">Upgrade Application</button></a></p>
            <p>Yours,<br>
            The flexiWAN team</p>`
          );
        }
      }

      notificationsMgr.sendNotifications(notifications);
    }
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

      // TODO: think on removed applications from repositroy

      const fs = require('fs');
      const result = fs.readFileSync(this.applicationsUri);
      const body = JSON.parse(result);
      logger.debug('Imported applications response received', {
        params: { time: body.meta.time, rulesCount: body.applications.length }
      });

      const appList = body.applications || [];

      const options = {
        upsert: true,
        setDefaultsOnInsert: true,
        useFindAndModify: false,
        new: true
      };

      let isUpdated = false;

      for (let i = 0; i < appList.length; i++) {
        // if app is not changed on repository
        let app = await library.findOne({ name: appList[i].name });
        if (app && app.repositoryTime === body.meta.time) {
          continue;
        }

        isUpdated = true;

        const set = { $set: { repositoryTime: body.meta.time, ...appList[i] } };
        app = await library.findOneAndUpdate({ name: appList[i].name }, set, options);

        // check if devices needs to upgrade
        await this.checkDevicesUpgrade(app);
      }

      if (isUpdated) {
        logger.info('Library database updated', {
          params: { time: body.meta.time, appsCount: appList.length }
        });
      }
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
