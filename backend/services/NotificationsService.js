/* eslint-disable max-len */
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

const Service = require('./Service');

const notificationsDb = require('../models/notifications');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const { getUserOrganizations } = require('../utils/membershipUtils');
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getMatchFilters } = require('../utils/filterUtils');
const notificationsConf = require('../models/notificationsConf');
const { membership } = require('../models/membership');
const Organizations = require('../models/organizations');
const users = require('../models/users');
const { ObjectId } = require('mongodb');
const { apply } = require('../deviceLogic/deviceNotifications');
const keyBy = require('lodash/keyBy');
const notificationsMgr = require('../notifications/notifications')();
const { validateNotificationsSettings, validateNotificationsEventTypes, validateEmailNotifications, validateWebhookSettings } = require('../models/validators');
const mongoConns = require('../mongoConns.js')();

class CustomError extends Error {
  constructor ({ message, status, data }) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class NotificationsService {
  /**
   * Get all Notifications
   *
   * offset Integer The number of items to skip before starting to collect the result set
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async notificationsGET (requestParams, { user }, response) {
    const { org, op, status, offset, limit, sortField, sortOrder, filters } = requestParams;
    let orgList;
    try {
      orgList = await getAccessTokenOrgList(user, org, false);
      const query = { org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) } };
      if (status) {
        query.status = status;
      }
      const pipeline = op !== 'count' ? [
        {
          $match: query
        },
        {
          $project: {
            _id: { $toString: '$_id' },
            time: 1,
            title: 1,
            details: 1,
            targets: 1,
            agentAlertsInfo: 1,
            status: 1,
            severity: 1,
            count: 1,
            emailSent: 1,
            resolved: 1,
            org: 1
          }
        }
      ] : [];
      let devicesArray;
      if (filters) {
        const parsedFilters = JSON.parse(filters);
        const matchFilters = getMatchFilters(parsedFilters);
        if (matchFilters.length > 0) {
          // if there is a 'device.*' filter we need another query, $lookup will not work
          // because 'devices' and 'notifications' are in different databases
          const [deviceFilters, notificationFilters] = matchFilters.reduce((res, filter) => {
            for (const key in filter) {
              if (key.startsWith('targets.deviceId')) {
                res[0].push({ [key.replace('targets.deviceId.', '')]: filter[key] });
              } else {
                res[1].push(filter);
              }
            }
            return res;
          }, [[], []]);
          if (deviceFilters.length > 0) {
            devicesArray = await devices.find({
              $and: [...deviceFilters, {
                org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) }
              }]
            }, { name: 1 });
            notificationFilters.push({
              'targets.deviceId': { $in: devicesArray.map(d => d._id) }
            });
          };
          if (notificationFilters.length > 0) {
            pipeline.push({
              $match: { $and: notificationFilters }
            });
          }
        }
      }
      if (sortField) {
        const order = sortOrder.toLowerCase() === 'desc' ? -1 : 1;
        pipeline.push({
          $sort: { [sortField]: order }
        });
      };
      const paginationParams = [{
        $skip: offset > 0 ? +offset : 0
      }];
      if (limit !== undefined) {
        paginationParams.push({ $limit: +limit });
      };
      pipeline.push({
        $facet: {
          records: paginationParams,
          meta: [{ $count: 'total' }]
        }
      });

      // If operation is 'count', return the amount
      // of notifications for each device
      const notifications = (op === 'count')
        ? await notificationsDb.aggregate([{ $match: query },
          {
            $group: {
              _id: '$device',
              count: { $sum: 1 }
            }
          }
        ])
        : await notificationsDb.aggregate(pipeline).allowDiskUse(true);

      if (op !== 'count' && notifications[0].meta.length > 0) {
        response.setHeader('records-total', notifications[0].meta[0].total);
        if (!devicesArray) {
          // there was no 'device.*' filter
          devicesArray = await devices.find({
            _id: { $in: notifications[0].records.map(n => n.targets.deviceId) }
          }, { name: 1 });
        }
      };
      const devicesByDeviceId = keyBy(devicesArray, '_id');
      const result = (op === 'count')
        ? notifications.map(element => {
          return {
            _id: element._id.toString(),
            count: element.count
          };
        })
        : notifications[0].records.map(element => {
          const device = devicesByDeviceId[element.targets.deviceId];
          let interfaceObj = null;
          if (element.targets.interfaceId) {
            const ifc = device?.interfaces?.find(ifc => String(ifc._id) === String(element.targets.interfaceId));
            interfaceObj = {
              _id: element.targets.interfaceId,
              name: ifc?.name
            };
          }
          const deviceObj = {
            _id: element.targets.deviceId,
            name: device?.name
          };
          return {
            ...element,
            _id: element._id.toString(),
            time: element.time.toISOString(),
            targets: { ...element.targets, deviceId: deviceObj, interfaceId: interfaceObj }
          };
        });

      return Service.successResponse(result);
    } catch (e) {
      logger.warn('Failed to retrieve notifications', {
        params: {
          org: orgList,
          err: e.message
        }
      });
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify notification
   *
   * id String Numeric ID of the notification to modify
   * org String Organization to be filtered by (optional)
   * notificationsIDPutRequest NotificationsIDPutRequest
   * returns Notification
   **/
  static async notificationsIdPUT ({ id, org, ...notificationsIDPutRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const query = { org: { $in: orgList }, _id: id };
      const res = await notificationsDb.updateOne(
        query,
        { $set: { status: notificationsIDPutRequest.status } },
        { upsert: false }
      );
      if (res.n === 0) throw new Error('Failed to update notifications');

      const notifications = await notificationsDb.find(
        query,
        'time device title details status machineId'
      ).populate('device', 'name -_id', devices);

      const result = {
        _id: notifications[0]._id.toString(),
        status: notifications[0].status,
        details: notifications[0].details,
        title: notifications[0].title,
        targets: notifications[0].targets,
        time: notifications[0].time.toISOString()
      };

      return Service.successResponse(result, 200);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify notifications
   *
   * org String Organization to be filtered by (optional)
   * notificationsPutRequest NotificationsPutRequest
   * no response value expected for this operation
   **/
  static async notificationsPUT ({ org, ...notificationsPutRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const query = { org: { $in: orgList } };
      if (notificationsPutRequest.ids) query._id = { $in: notificationsPutRequest.ids };

      const res = await notificationsDb.updateMany(
        query,
        { $set: { status: notificationsPutRequest.status } },
        { upsert: false }
      );
      if (notificationsPutRequest.ids && res.n !== notificationsPutRequest.ids.length) {
        throw new Error('Some notification IDs were not found');
      }
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete all notifications matching the filters
   *
   * no response value expected for this operation
   **/
  static async notificationsDELETE ({ org, ...notificationsDeleteRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const query = { org: { $in: orgList.map(o => mongoose.Types.ObjectId(o)) } };
      const { filters } = notificationsDeleteRequest;
      if (filters) {
        const matchFilters = getMatchFilters(filters);
        if (matchFilters.length > 0) {
          query.$and = matchFilters;
        }
      }
      const { deletedCount } = await notificationsDb.deleteMany(query);
      if (deletedCount === 0) {
        return Service.rejectResponse('Not found', 404);
      }
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
  * Validate notifications conf request params and return the list of organizations according to the param
  * @param org String organization ID
  * @param account String account ID
  * @param group String group name (must be sent with account ID)
  * user: Object
  * returns Notification
  **/
  static async validateParams (org, account, group, user, setAsDefault = null, get = false) {
    if (setAsDefault) {
      if (!account) {
        return Service.rejectResponse('Please specify the account id', 400);
      }
      return [];
    } else {
    // Validate parameters
      if (!org && !account && !group) {
        return Service.rejectResponse('Missing parameter: org, account or group', 400);
      }
      // The request should contain only the necessary fields. orgId is unique so it should be sent alone
      if (org && (account || group)) {
        return Service.rejectResponse('Invalid parameter: org should be used alone', 400);
      }
      // Since the group name is not unique, it should always be sent with an account ID
      if (group && !account) {
        return Service.rejectResponse('Invalid parameter: group should be used with account', 400);
      }
      if (account && org) {
        return Service.rejectResponse('Invalid parameter: account should be used alone or with group(for modifying the group)', 400);
      }

      const orgList = await getUserOrganizations(user);
      let orgIds = [];
      if (org) {
        if (!orgList[org]) {
          return Service.rejectResponse('You do not have permission to access this organization', 403);
        }
        orgIds = [org];
      // At this point, we are working with either an account or a group.
      } else {
        // If this is a GET request anyone in the account/group can access the data so we don't check the user's membership
        if (get) {
          orgIds = Object.values(orgList)
            .filter(org => org.account.toString() === account && (!group || org.group === group))
            .map(org => org.id);
        // If this is not a get request we want the user to have account/group permissions
        } else {
          const membersOfAccountOrGroup = await membership.find({
            account: account,
            $or: [
              { $and: [{ to: 'group' }, { group: group }] },
              { $and: [{ to: 'account' }, { group: '' }] }
            ],
            role: { $ne: 'viewer' }
          });
          const membersIds = Object.values(membersOfAccountOrGroup).map(membership => membership.user.toString());
          if (membersIds.includes(user._id.toString())) {
            const filter = { account };
            if (group) filter.group = group;
            const orgs = await Organizations.find(filter).lean();
            orgIds = orgs.map(org => org._id.toString());
          } else {
            return Service.rejectResponse("You don't have a permission to modify the settings", 403);
          }
        }
      }
      if (!orgIds.length) {
        return Service.rejectResponse('No organizations found', 404);
      }
      return orgIds;
    }
  }

  /**
  * Get notifications settings for a given organization/account/group
  * @param org String organization ID
  * @param account String account ID
  * @param group String group name (must be sent with account ID)
  * user: Object
  * The request should contain one of the 3: org / account / account + group
   **/
  static async notificationsConfGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user, false, true);
      if (orgIds.error) {
        return orgIds;
      }
      const response = await notificationsConf.find({ org: { $in: orgIds.map(orgId => new ObjectId(orgId)) } }, { rules: 1, _id: 0 }).lean();
      if (org) {
        const sortedRules = Object.fromEntries(
          Object.entries(response[0].rules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        );
        return Service.successResponse(sortedRules);
      } else {
        const mergedRules = {};
        response.forEach(org => {
          Object.keys(org.rules).forEach(ruleName => {
            if (!mergedRules[ruleName]) {
              mergedRules[ruleName] = {};
              Object.keys(org.rules[ruleName]).forEach(settingName => {
                if (settingName !== '_id') {
                  mergedRules[ruleName][settingName] = org.rules[ruleName][settingName];
                }
              });
            } else {
              Object.keys(org.rules[ruleName]).forEach(settingName => {
                if (settingName !== '_id') {
                  if (mergedRules[ruleName][settingName] !== org.rules[ruleName][settingName]) {
                    mergedRules[ruleName][settingName] = 'varies';
                  }
                }
              });
            }
          });
        });
        const sortedMergedRules = Object.fromEntries(Object.entries(mergedRules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB)));
        return Service.successResponse(sortedMergedRules);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
  * Send the notifications settings of numeric fields to validation
  * If one of the new fields value is "varies" it means we should use the original value
  * in the validation in order to make sure that the other value is valid (bigger/smaller than the other)
  * @param newRulesEventSettings Object of a specific event type settings, sent by the user
  * @param currentRuleEventSettings Object of a specific event type settings, taken from the original organization settings
  **/
  static validateThresholds (newRulesEventSettings, currentRuleEventSettings, eventName) {
    let { warningThreshold, criticalThreshold } = newRulesEventSettings;
    if (warningThreshold === 'varies') {
      warningThreshold = currentRuleEventSettings.warningThreshold;
    }

    if (criticalThreshold === 'varies') {
      criticalThreshold = currentRuleEventSettings.criticalThreshold;
    }

    const validRule = validateNotificationsSettings({ [eventName]: { warningThreshold, criticalThreshold } });

    if (!validRule.valid) {
      throw new CustomError({
        status: 400,
        message: 'Invalid notification settings',
        data: validRule.errors
      });
    }
  }

  /**
  * Modify the notifications settings of a given organization/account/group
  * @param org String organization ID
  * @param account String account ID
  * @param group String group name (must be sent with account ID)
  * @param rules Object of notifications settings (each one is an object in which the event name is the key and the value
  * is the event settings)
  * user: Object
  **/
  static async notificationsConfPUT ({ org: orgId, account, group, rules: newRules, setAsDefault = false }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(orgId, account, group, user, setAsDefault);
      if (orgIds && orgIds.error) {
        return orgIds;
      }

      const areRulesFieldsMissing = validateNotificationsEventTypes(newRules);
      if (areRulesFieldsMissing) {
        throw new CustomError({
          status: 400,
          message: 'Missing notification rules',
          data: { error: areRulesFieldsMissing }
        });
      }

      // If we modify a single organization we can send the whole newRules object to validation as it is
      // Since it doesn't contain "varies" values when we expect numeric values
      if (orgIds.length === 1) {
        const validNotifications = validateNotificationsSettings(newRules);
        if (!validNotifications.valid) {
          throw new CustomError({
            status: 400,
            message: 'Invalid notification settings',
            data: validNotifications.errors
          });
        }
      }
      if (setAsDefault) {
        const accountOwners = await membership.find({
          account: user.defaultAccount._id,
          to: 'account',
          role: 'owner'
        });
        const accountOwnersIds = Object.values(accountOwners).map(membership => membership.user.toString());
        if (accountOwnersIds.includes(user._id.toString())) {
          await notificationsConf.update({ account: account }, { $set: { account: account, rules: newRules } }, { upsert: true });
        } else {
          return Service.rejectResponse(
            'Only account owners can set the account default settings', 403);
        }
        return Service.successResponse(
          { status: 'completed', message: 'Current settings successfully established as the default for new organizations' }, 202
        );
      } else {
        // A map to save the updated notifications for each organization in order to use it in the job
        // Note that the newRules input isn't always applicable as the updated settings since it may contain "varies" in some fields.
        // In this case the original setting for that specific field in the organization settings should be used instead
        const updatedNotificationsByOrg = new Map();

        await mongoConns.mainDBwithTransaction(async (session) => {
          let updatedNotifications;
          if (orgIds.length === 1) {
            updatedNotifications = await notificationsConf.findOneAndUpdate({ org: orgId }, { $set: { rules: newRules } }, { new: true, session: session }).lean();
            updatedNotificationsByOrg.set(orgId, updatedNotifications.rules);
          } else {
            const allCurrentRules = await notificationsConf.find({ org: { $in: orgIds } }).lean();
            const originalNotificationsByOrg = {};

            allCurrentRules.forEach(orgNotificationsSettings => {
              originalNotificationsByOrg[orgNotificationsSettings.org] = orgNotificationsSettings.rules;
            });

            for (const orgId of orgIds) {
              const currentRules = originalNotificationsByOrg[orgId];

              for (const event in newRules) {
                const { warningThreshold, criticalThreshold } = newRules[event];
                if (warningThreshold && criticalThreshold) {
                  NotificationsService.validateThresholds(
                    newRules[event],
                    currentRules[event],
                    event
                  );
                }

                Object.entries(newRules[event]).forEach(([field, value]) => {
                  if (value && value !== 'varies') {
                    currentRules[event][field] = value;
                  }
                });
              }
              updatedNotifications = await notificationsConf.findOneAndUpdate({ org: orgId }, { $set: { rules: currentRules } }, { new: true, session: session }).lean();
              updatedNotificationsByOrg.set(orgId, updatedNotifications.rules);
            }
          }
        });

        let devicesShouldReceiveJobs = 0;
        const applyPromises = [];
        let fulfilledJobs = 0;
        for (const [orgId, notificationsSettings] of updatedNotificationsByOrg.entries()) {
          const orgDevices = await devices.find({ org: orgId });
          devicesShouldReceiveJobs += orgDevices.length;
          const data = {
            rules: notificationsSettings,
            org: orgId
          };
          applyPromises.push(apply(orgDevices, user, data));
        }
        const promisesStatus = await Promise.allSettled(applyPromises);
        for (const promiseStatus of promisesStatus) {
          if (promiseStatus.status === 'fulfilled') {
            const { ids } = promiseStatus.value;
            fulfilledJobs += ids.length;
          }
        }
        const status = fulfilledJobs < devicesShouldReceiveJobs.length
          ? 'partially completed' : 'completed';
        const message = fulfilledJobs < devicesShouldReceiveJobs.length
          ? `Warning: ${fulfilledJobs} of ${devicesShouldReceiveJobs.length} Set device's notifications job added.`
          : 'The notifications were updated successfully';
        return Service.successResponse(
          { status, message }, 202
        );
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500,
        e.data
      );
    }
  }

  /**
   * Get account/system default notifications settings
   * @param account  String account ID
   * user Object
   * @return Default notification settings for either the specified account or the system.
   * If the account-specific settings are not found, system default settings will be returned.
   **/
  static async notificationsConfDefaultGET ({ account = null }, { user }) {
    try {
      // TODO - add a validation of the user permissions
      const defaultSettings = await notificationsMgr.getDefaultNotificationsSettings(account);
      return Service.successResponse(defaultSettings);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Get email notifications settings for a given organization/account/group
   * @param org  String organization ID
   * @param account  String account ID
   * @param group  String group name (must be sent with account ID)
   * user Object
   * @return Object: Returns email notification settings for a specific organization, or aggregated email notification settings
   *  for a list of organizations under the account/group.
   * The object contains nested objects with details of each subscribed user (id, signedToCritical, signedToWarning, etc.).
   **/

  static async notificationsConfEmailsGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user, false, true);
      if (orgIds.error) return orgIds;
      let response = [];
      const uniqueUsers = new Set();
      const processOrganization = async (orgId) => {
        const orgData = await Organizations.find({ _id: orgId });
        const members = await membership.find({
          $or: [
            { to: 'organization', organization: orgId },
            { to: 'account', account: orgData[0].account },
            { to: 'group', account: orgData[0].account, group: orgData[0].group }
          ]
        });

        const notificationsData = await notificationsConf.find({ org: orgId });
        // A map for storing usersData
        const usersDataMap = new Map();

        for (const member of members) {
          const memberIdStr = member.user.toString();

          if (!uniqueUsers.has(memberIdStr)) {
            uniqueUsers.add(memberIdStr);

            if (!usersDataMap.has(memberIdStr)) {
              const userData = await users.find({ _id: member.user });
              usersDataMap.set(memberIdStr, userData[0]);
            }

            const currentUser = {
              _id: member.user,
              email: usersDataMap.get(memberIdStr).email,
              name: usersDataMap.get(memberIdStr).name,
              lastName: usersDataMap.get(memberIdStr).lastName,
              signedToCritical: notificationsData[0].signedToCritical.includes(member.user),
              signedToWarning: notificationsData[0].signedToWarning.includes(member.user),
              signedToDaily: notificationsData[0].signedToDaily.includes(member.user)
            };

            if (org) response.push(currentUser);
            else response.push({ ...currentUser, count: 1 });
          // An account or a group is given
          } else if (!org) {
            if (!usersDataMap.has(memberIdStr)) {
              const userData = await users.find({ _id: member.user });
              usersDataMap.set(memberIdStr, userData[0]);
            }

            const userIndex = response.findIndex(user => user._id.toString() === memberIdStr);
            const existingUser = response[userIndex];
            existingUser.signedToCritical = notificationsData[0].signedToCritical.includes(member.user) !== existingUser.signedToCritical ? null : existingUser.signedToCritical;
            existingUser.signedToWarning = notificationsData[0].signedToWarning.includes(member.user) !== existingUser.signedToWarning ? null : existingUser.signedToWarning;
            existingUser.signedToDaily = notificationsData[0].signedToDaily.includes(member.user) !== existingUser.signedToDaily ? null : existingUser.signedToDaily;
            existingUser.count++;
          }
        }
      };
      if (org) {
        await processOrganization(org);
      } else {
        for (const orgId of orgIds) {
          await processOrganization(orgId);
        }
        response = response.filter(user => user.count >= orgIds.length).map(({ count, ...user }) => user);
      }
      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }

  /**
   * Modify email notifications settings of a given organization/account/group
   * @param org  String organization ID
   * @param account  String account ID
   * @param group  String group name (must be sent with account ID)
   * @param emailsSigning  Object which contains nested objects with the email signing details for each user (id, signToCritical, signToWarning, etc.)
   * user Object
   **/

  static async notificationsConfEmailsPUT ({ org, account, group, emailsSigning }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }

      const areEmailSigningFieldsMissing = validateEmailNotifications(emailsSigning, !org);
      if (areEmailSigningFieldsMissing) {
        return Service.rejectResponse({
          code: 400,
          message: 'Missing details in email signing list',
          data: areEmailSigningFieldsMissing
        });
      }

      const userIds = emailsSigning.map(e => e._id);
      const userDataList = await users.find({ _id: { $in: userIds } });

      // If one of the user ids does not exist in the db
      if (userIds.length !== userDataList.length) {
        return Service.rejectResponse('Not all the user IDs exist in the database');
      }
      const usersOrgAccess = {};
      for (const userData of userDataList) {
        usersOrgAccess[userData._id] = await getUserOrganizations(userData, undefined, undefined, user.defaultAccount._id);
      }

      let groupOrgsCount;
      if (group) {
        groupOrgsCount = await Organizations.count({
          account: user.defaultAccount._id,
          group
        });
      }

      const operations = [];

      for (const org of orgIds) {
        for (const emailSigning of emailsSigning) {
          if (!usersOrgAccess?.[emailSigning._id]?.[org]) {
            const errorMsg = org ? 'One of the users does not have a permission to access the organization'
              : `All the users must be authorized to each one of the organizations under the ${group ? 'group' : 'account'}`;
            logger.warn('Error in email subscription', { params: { err: `user id ${emailSigning._id} is not authorized for the organization ${org}` } });
            return Service.rejectResponse(errorMsg, 403);
          }

          // Since group is always being sent with account, we should check it first
          if (group) {
            const userGroupOrgs = Object.values(usersOrgAccess?.[emailSigning._id]).filter(o => o.group === group);
            if (userGroupOrgs.length !== groupOrgsCount) {
              const errorMsg = 'All the users must be authorized to each one of the organizations under the group';
              logger.warn('Error in email subscription', {
                params: {
                  err: `user id ${emailSigning._id} is not authorized for all the organizations in the group ${group} under the account ${account}`
                }
              });
              return Service.rejectResponse(errorMsg, 403);
            }
          } else if (account && user.defaultAccount.organizations.length !== Object.keys(usersOrgAccess[emailSigning._id]).length) {
            const errorMsg = 'All the users must be authorized to each one of the organizations under the account';
            logger.warn('Error in email subscription', { params: { err: `user id ${emailSigning._id} is not authorized for all the organizations in the account ${account}` } });
            return Service.rejectResponse(errorMsg, 403);
          }

          ['signedToCritical', 'signedToWarning', 'signedToDaily'].forEach(field => {
            if (emailSigning[field] === false) {
              operations.push({ updateOne: { filter: { org }, update: { $pull: { [field]: mongoose.Types.ObjectId(emailSigning._id) } }, upsert: true } });
            } else if (emailSigning[field]) {
              operations.push({ updateOne: { filter: { org }, update: { $addToSet: { [field]: mongoose.Types.ObjectId(emailSigning._id) } }, upsert: true } });
            }
          });
        }
      }

      if (operations.length) {
        await notificationsConf.bulkWrite(operations);
      }

      return Service.successResponse('updated successfully', 204);
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }

  /**
   * Get webhook notifications settings for a given organization/account/group
   * @param org  String organization ID
   * @param account  String account ID
   * @param group  String group name (must be sent with account ID)
   * @return Object Returns webhook notification settings for a specific organization, or aggregated email notification settings
   *  for a list of organizations under the account/group.
   **/

  static async notificationsConfWebhookGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user, false, true);
      if (orgIds.error) {
        return orgIds;
      }
      const response = await notificationsConf.find({ org: { $in: orgIds.map(orgId => new ObjectId(orgId)) } }, { webHookSettings: 1, _id: 0 }).lean();
      if (org) {
        const webHookSettings = { ...response[0].webHookSettings };
        delete webHookSettings._id;
        return Service.successResponse(webHookSettings);
      } else {
        const mergedSettings = {};
        for (let i = 0; i < response.length; i++) {
          Object.keys(response[i].webHookSettings).forEach(setting => {
            if (setting === '_id') {
              return;
            }
            if (!mergedSettings.hasOwnProperty(setting)) {
              mergedSettings[setting] = response[i].webHookSettings[setting];
            } else {
              if (mergedSettings[setting] !== response[i].webHookSettings[setting]) {
                mergedSettings[setting] = null;
              }
            }
          });
        }
        return Service.successResponse(mergedSettings);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify webhook notifications settings of a given organization/account/group
   * @param org  String organization ID
   * @param account  String account ID
   * @param group  String group name (must be sent with account ID)
   * @param webHookSettings  Object
   **/
  static async notificationsConfWebhookPUT ({ org: orgId, account, group, webHookSettings }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(orgId, account, group, user, false);
      if (orgIds && orgIds.error) {
        return orgIds;
      }

      const invalidWebHookSettings = validateWebhookSettings(webHookSettings, !orgId);
      if (invalidWebHookSettings) {
        throw new CustomError({
          status: 400,
          message: 'Invalid webhook settings',
          data: invalidWebHookSettings
        });
      }

      const updateData = { $set: {} };
      Object.entries(webHookSettings).forEach(([field, value]) => {
        if (value !== null) {
          updateData.$set[`webHookSettings.${field}`] = value;
        }
      });

      // Only run the update if there are fields to update
      if (Object.keys(updateData.$set).length > 0) {
        await notificationsConf.updateMany({ org: { $in: orgIds } }, updateData);
      }

      return Service.successResponse('updated successfully', 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500,
        e.data
      );
    }
  }
}

module.exports = NotificationsService;
