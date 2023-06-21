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
const notificationsDb = require('../models/notifications');
const organizations = require('../models/organizations');
const tunnels = require('../models/tunnels');
const devicesModel = require('../models/devices').devices;
const notificationsConf = require('../models/notificationsConf');
const users = require('../models/users');
const logger = require('../logging/logging')({ module: module.filename, type: 'notifications' });
const mailer = require('../utils/mailer')(
  configs.get('mailerHost'),
  configs.get('mailerPort'),
  configs.get('mailerBypassCert', 'boolean')
);
const mongoose = require('mongoose');
const webHooks = require('../utils/webhooks')();

/**
 * Notification events hierarchy class
 */
// Initialize the events hierarchy
const hierarchyMap = {};

class Event {
  constructor (eventName, parents) {
    this.eventName = eventName;
    this.parents = parents;

    hierarchyMap[eventName] = this;
  }

  getAllParents () {
    const parentNames = [];
    for (const parent of this.parents) {
      parentNames.push(parent.eventName, ...parent.getAllParents());
    }
    return parentNames;
  }

  async getTarget (deviceId, interfaceId, tunnelId) {
    // MUST BE IMPLEMENTED IN CHILD CLASSES
  }

  async getQuery (deviceId, interfaceId, tunnelId) {
    const query = [];
    const parentNames = this.getAllParents();
    if (parentNames.length === 0) {
      query.push(await this.getTarget(deviceId, interfaceId, tunnelId));
    }
    for (const parentName of parentNames) {
      const parent = hierarchyMap[parentName]; // Get the instance of the parent event
      query.push(await parent.getTarget(deviceId, interfaceId, tunnelId));
    }
    return query;
  }
}

class DeviceConnectionEventClass extends Event {
  async getTarget (deviceId, interfaceId, tunnelId) {
    return {
      eventType: this.eventName,
      'targets.deviceId': deviceId,
      resolved: false
    };
  }
}
class RunningRouterEventClass extends Event {
  async getTarget (deviceId, interfaceId, tunnelId) {
    return {
      eventType: this.eventName,
      'targets.deviceId': deviceId,
      resolved: false
    };
  }
}

class InterfaceConnectionEventClass extends Event {
  async getTarget (deviceId, interfaceId, tunnelId) {
    return {
      eventType: this.eventName,
      'targets.deviceId': deviceId,
      'targets.interfaceId': interfaceId,
      resolved: false
    };
  }
}

class MissingInterfaceIPEventClass extends Event {
  async getTarget (deviceId, interfaceId, tunnelId) {
    return {
      eventType: this.eventName,
      'targets.deviceId': deviceId,
      'targets.interfaceId': interfaceId,
      resolved: false
    };
  }
}

class LinkStatusEventClass extends Event {
  async getTarget (deviceId, interfaceId, tunnelId) {
    return {
      eventType: this.eventName,
      'targets.deviceId': deviceId,
      'targets.interfaceId': interfaceId,
      resolved: false
    };
  }
}

const DeviceConnectionEvent = new DeviceConnectionEventClass('Device connection', []);
const RunningRouterEvent = new RunningRouterEventClass('Running router', [DeviceConnectionEvent]);
const LinkStatusEvent = new LinkStatusEventClass('Link status', [
  RunningRouterEvent
]);
const InterfaceConnectionEvent = new InterfaceConnectionEventClass('Interface connection', [
  LinkStatusEvent
]);
const InterfaceIpChangeEvent = new MissingInterfaceIPEventClass('Interface ip', [
  LinkStatusEvent
]);
// eslint-disable-next-line no-unused-vars
const RttEvent = new Event('Link/Tunnel round trip time',
  [InterfaceConnectionEvent, InterfaceIpChangeEvent]);
// eslint-disable-next-line no-unused-vars
const DropRateEvent = new Event('Link/Tunnel default drop rate',
  [InterfaceConnectionEvent, InterfaceIpChangeEvent]);

/**
 * Notification Manager class
 */
class NotificationsManager {
  /**
     * Saves notifications in the database
     * @async
     * @param  {Array} notifications an array of notification objects
     * @return {void}
     */

  async getUserEmail (userIds) {
    const userEmails = [];
    for (const userId of userIds) {
      const userData = await users.findOne({ _id: userId });
      if (userData) {
        userEmails.push(userData.email);
      }
    }
    return userEmails;
  };

  async sendEmailNotification (
    title, orgNotificationsConf, severity, emailBody) {
    const userIds = severity === 'warning' ? orgNotificationsConf.signedToWarning
      : orgNotificationsConf.signedToCritical;
    const emailAddresses = await this.getUserEmail(userIds);
    if (emailAddresses.length > 0) {
      await mailer.sendMailHTML(
        configs.get('mailerEnvelopeFromAddress'),
        configs.get('mailerFromAddress'),
        emailAddresses,
        title,
        (`<p>Please be aware that ${emailBody.toLowerCase()}.</p>
        </p>To make changes to the notification settings in flexiManage, 
        please access the "Account -> Notifications" section</p>`)
      );
    }
  }

  async sendWebHook (title, details, severity) {
    const webHookMessage = {
      title,
      details,
      severity
    };
    if (!await webHooks.sendToWebHook('http://localhost:7000/webhook',
      webHookMessage,
      ''
    )) {
      logger.error('Web hook call failed', { params: { message: webHookMessage } });
    }
  }

  async sendNotifications (notifications) {
    try {
      // Get the accounts of the notifications by the organization
      // Since we can have notification with different organization IDs
      // We have to fist create a map that maps an organization to all
      // the notifications that belongs to it, which we'll use later
      // to add the proper account ID to each of the notifications.
      const orgsMap = new Map();
      for (const notification of notifications) {
        if (notification.orgNotificationsConf) {
          const {
            details, eventType, orgNotificationsConf, title, severity = null,
            targets, resolved
          } = notification;
          const event = hierarchyMap[eventType];
          const rules = orgNotificationsConf.rules;
          if (!severity) {
            const currentSeverity = rules[eventType].severity;
            notification.severity = currentSeverity;
          }
          // If the event exists in the hierarchy check if there is already a parent event in the db
          if (event && !resolved) {
            let interfaceId, deviceId;
            if (targets.tunnelId) {
              const tunnel = await tunnels.findOne({
                num: targets.tunnelId,
                $or: [
                  { deviceA: targets.deviceId },
                  { deviceB: targets.deviceId }
                ],
                isActive: true
              });
              const interfaces = [tunnel.interfaceA];
              if (!tunnel.peer) {
                interfaces.push(tunnel.interfaceB);
              }
              interfaceId = {
                $in: interfaces
              };
              const devices = [tunnel.deviceA, tunnel.deviceB];
              deviceId = {
                $in: devices
              };
            }
            const parentsQuery = await event.getQuery(
              deviceId || targets.deviceId,
              interfaceId || targets.interfaceId, targets.tunnelId);
            let foundParentNotification = false;
            for (const query of parentsQuery) {
              const result = await notificationsDb.findOne({
                resolved: false,
                org: notification.org,
                ...query
              });
              if (result) {
                foundParentNotification = true;
                break;
              }
            }
            if (foundParentNotification) {
              continue; // Ignore since there is a parent event
            }
          }
          // TODO only for flexiManage alerts: check if the alert exists and increase count
          if (rules[eventType].immediateEmail) {
            await this.sendEmailNotification(title, orgNotificationsConf,
              severity || notification.severity, details);
          }
          if (rules[eventType].sendWebHook) {
            await this.sendWebHook(title, details, severity || notification.severity);
          }
        }
        const key = notification.org.toString();
        const notificationList = orgsMap.get(key);
        if (!notificationList) orgsMap.set(key, []);
        orgsMap.get(key).push(notification);
      }
      // Create an array of org ID and account ID pairs
      const orgIDs = Array.from(orgsMap.keys()).map(key => {
        return mongoose.Types.ObjectId(key);
      });
      const accounts = await organizations.aggregate([
        { $match: { _id: { $in: orgIDs } } },
        {
          $group: {
            _id: '$_id',
            accountID: { $push: '$$ROOT.account' }
          }
        }
      ]);
      const bulkWriteOps = [];

      // Go over all accounts and update all notifications that
      // belong to the organization to which the account belongs.
      accounts.forEach(account => {
        const notificationList = orgsMap.get(account._id.toString());
        const currentTime = new Date();
        notificationList.forEach(notification => {
          notification.account = account.accountID;
          notification.time = currentTime;
          bulkWriteOps.push({ insertOne: { document: notification } });
        });
      });

      if (bulkWriteOps.length > 0) {
        await notificationsDb.bulkWrite(bulkWriteOps);
        // Log notification for logging systems
        logger.info('New notifications', { params: { notifications: notifications } });
      }
    } catch (err) {
      logger.warn('Failed to store notifications in database', {
        params: { notifications: notifications, err: err.message }
      });
    }
  }

  /**
     * Sends emails to notify users with
     * pending unread notifications.
     * @async
     * @return {void}
     */
  async notifyUsersByEmail () {
    // Extract email addresses of users with pending unread notifications.
    // This has to be done in two phases, as mongodb does not
    // support the 'lookup' command across different databases:
    // 1. Get the list of account IDs with pending notifications.
    // 2. Go over the list, populate the users and send them emails.
    let orgIDs = [];
    try {
      orgIDs = await notificationsDb.distinct('org', { status: 'unread' });
    } catch (err) {
      logger.warn('Failed to get account IDs with pending notifications', {
        params: { err: err.message }
      });
    }
    // Notify users only if there are unread notifications
    for (const orgID of orgIDs) {
      try {
        const orgNotificationsConf = await notificationsConf.findOne({ org: orgID });
        const emailAddresses = await this.getUserEmail(orgNotificationsConf.signedToDaily);
        if (emailAddresses.length > 0) {
          const organization = await organizations.findOne({ _id: orgID }, { account: 1 });
          const messages = await notificationsDb.find(
            { org: orgID, status: 'unread' },
            'time device details machineId'
          ).sort({ time: -1 })
            .limit(configs.get('unreadNotificationsMaxSent', 'number'))
            .populate('device', 'name -_id', devicesModel).lean();

          const uiServerUrl = configs.get('uiServerUrl', 'list');
          await mailer.sendMailHTML(
            configs.get('mailerEnvelopeFromAddress'),
            configs.get('mailerFromAddress'),
            emailAddresses,
            'Pending unread notifications',
            `<h2>${configs.get('companyName')} Notification Reminder</h2>
            <p style="font-size:16px">This email was sent to you since you have pending
             unread notifications in the organization
             "${organization ? organization.name : 'Deleted'} : 
             ${orgID.toString().substring(0, 13)}".</p>
             <i><small>
             <ul>
              ${messages.map(message => `
              <li>
                ${message.time.toISOString().replace(/T/, ' ').replace(/\..+/, '')}
                device ${message.device ? message.device.name : 'Deleted'}
                (ID: ${message.machineId})
                - ${message.details}
              </li>
              `).join('')}
            </ul>
            </small></i>
            <p style="font-size:16px"> Further to this email,
            all Notifications in your Account have been set to status Read.
            <br>To view the notifications, please check the
            ${uiServerUrl.length > 1
              ? ' Notifications '
              : `<a href="${uiServerUrl[0]}/notifications">Notifications</a>`
            }
             page in your flexiMange account.</br>
            </p>
            <p style="font-size:16px;color:gray">Note: Unread notification email alerts
             are sent to Account owners (not Users in Organization level).
              You can disable these emails in the
              ${uiServerUrl.length > 1
                ? ' Account profile '
                : `<a href="${uiServerUrl[0]}/accounts/update">Account profile</a>`
              }
               page in your flexiManage account. Alerts on new flexiEdge software versions
               or billing information are always sent, regardless of the notifications settings.
               More about notifications
               <a href="https://docs.flexiwan.com/troubleshoot/notifications.html">here</a>.</p>
            <p style="font-size:16px">Your friends @ ${configs.get('companyName')}</p>`
          );

          logger.info('User notifications reminder email sent', {
            params: { emailAddresses: emailAddresses }
          });
        }
      } catch (err) {
        logger.warn('Failed to notify users about pending notifications', {
          params: { err: err.message, organization: orgID }
        });
      }
    }
    try {
      // Set status 'read' to all notifications
      await notificationsDb.updateMany(
        { status: 'unread' },
        { $set: { status: 'read' } }
      );
    } catch (err) {
      logger.warn('Failed to set status read to all notifications', {
        params: { err: err.message }
      });
    }
  }
}

let notificationsMgr = null;
module.exports = function () {
  if (notificationsMgr) return notificationsMgr;
  notificationsMgr = new NotificationsManager();
  return notificationsMgr;
};
