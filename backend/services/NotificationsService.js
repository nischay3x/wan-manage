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
const { checkMemberLevel } = require('./MembersService');
const mongoose = require('mongoose');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getMatchFilters } = require('../utils/filterUtils');
const notificationsConf = require('../models/notificationsConf');
const { membership } = require('../models/membership');
const Organizations = require('../models/organizations');
const users = require('../models/users');
const { ObjectId } = require('mongodb');
const { apply } = require('../deviceLogic/deviceNotifications');

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
            status: 1,
            severity: 1
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
              if (key.startsWith('device.')) {
                res[0].push({ [key.replace('device.', '')]: filter[key] });
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
            notificationFilters.push({ device: { $in: devicesArray.map(d => d._id) } });
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
            _id: { $in: notifications[0].records.map(n => n.device) }
          }, { name: 1 });
        }
      };
      const result = (op === 'count')
        ? notifications.map(element => {
          return {
            _id: element._id.toString(),
            count: element.count
          };
        })
        : notifications[0].records.map(element => {
          return {
            ...element,
            _id: element._id.toString(),
            time: element.time.toISOString()
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
  static async notificationsIdPUT ({ id, org, notificationsIDPutRequest }, { user }) {
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
  static async notificationsPUT ({ org, notificationsPutRequest }, { user }) {
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
  static async notificationsDELETE ({ org, notificationsDeleteRequest }, { user }) {
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

  // Validate request params and return the list of organizations according to the param
  static async validateParams (org, account, group, user, setAsDefault = null) {
    if (setAsDefault) {
      if (!account) {
        return Service.rejectResponse('Please specify the account id', 400);
      }
    } else {
    // Validate parameters
      if (!org && !account && !group) {
        return Service.rejectResponse('Missing parameter: org, account or group', 400);
      }
      if (org && (account || group)) {
        return Service.rejectResponse('Invalid parameter: org should be used alone', 400);
      }
      if (group && !account) {
        return Service.rejectResponse('Invalid parameter: group should be used with account', 400);
      }
      if (account && org) {
        return Service.rejectResponse('Invalid parameter: account should be used alone or with group(for modifying the group)', 400);
      }

      const orgList = await getUserOrganizations(user);
      let orgIds = [];
      if (org) {
        if (!Object.values(orgList).find(o => o.id === org)) {
          return Service.rejectResponse('You do not have permission to access this organization', 403);
        }
        orgIds = [org];
      } else {
        orgIds = Object.values(orgList)
          .filter(org => org.account.toString() === account && (!group || org.group === group))
          .map(org => org.id);
      }
      if (!orgIds.length) {
        return Service.rejectResponse('No organizations found', 404);
      }
      return orgIds;
    }
  }

  /**
   * Get notifications settings of a given organization/account/group
   **/
  static async notificationsConfGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }
      const response = await notificationsConf.find({ org: { $in: orgIds.map(orgId => new ObjectId(orgId)) } }, { rules: 1, _id: 0 }).lean();
      if (org) {
        const sortedRules = Object.fromEntries(
          Object.entries(response[0].rules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        );
        return Service.successResponse([sortedRules]);
      } else {
        const mergedRules = {};
        const keysOfInterest = ['warningThreshold', 'criticalThreshold', 'thresholdUnit', 'severity', 'immediateEmail', 'resolvedAlert', 'type', 'sendWebHook'];
        response.forEach(org => {
          Object.keys(org.rules).forEach(ruleName => {
            if (!mergedRules[ruleName]) {
              mergedRules[ruleName] = {};
              keysOfInterest.forEach(key => {
                if (org.rules[ruleName].hasOwnProperty(key)) {
                  mergedRules[ruleName][key] = org.rules[ruleName][key];
                }
              });
            } else {
              keysOfInterest.forEach(key => {
                if (mergedRules[ruleName][key] !== org.rules[ruleName][key]) {
                  mergedRules[ruleName][key] = 'varies';
                }
              });
            }
          });
        });
        const sortedMergedRules = Object.fromEntries(Object.entries(mergedRules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB)));
        return Service.successResponse([sortedMergedRules]);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify the notifications settings of a given organization/account/group
   **/
  static async notificationsConfPUT ({ notificationsConfPut }, { user }) {
    try {
      const { org: orgId, account, group, rules: newRules, setAsDefault = false } = notificationsConfPut;
      const orgIds = await NotificationsService.validateParams(orgId, account, group, user, setAsDefault);
      if (orgIds && orgIds.error) {
        return orgIds;
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
      } else {
        for (const org of orgIds) {
          const devicesList = [];
          for (const event in newRules) {
            const updateData = { $set: {} };
            const rule = newRules[event];
            if (rule.warningThreshold !== 'varies') {
              updateData.$set[`rules.${event}.warningThreshold`] = rule.warningThreshold;
            }
            if (rule.criticalThreshold !== 'varies') {
              updateData.$set[`rules.${event}.criticalThreshold`] = rule.criticalThreshold;
            }
            if (rule.thresholdUnit !== 'varies') {
              updateData.$set[`rules.${event}.thresholdUnit`] = rule.thresholdUnit;
            }
            if (rule.severity !== 'varies') {
              updateData.$set[`rules.${event}.severity`] = rule.severity;
            }
            if (rule.immediateEmail !== 'varies') {
              updateData.$set[`rules.${event}.immediateEmail`] = rule.immediateEmail;
            }
            if (rule.resolvedAlert !== 'varies') {
              updateData.$set[`rules.${event}.resolvedAlert`] = rule.resolvedAlert;
            }
            if (rule.sendWebHook !== 'varies') {
              updateData.$set[`rules.${event}.sendWebHook`] = rule.sendWebHook;
            }
            await notificationsConf.updateOne({ org: org }, updateData);
          }
          const orgDevices = await devices.find({ org: org });
          devicesList.push(orgDevices);
          const getOrgNotificationsConf = await notificationsConf.findOne({ org: org });
          const orgNotificationsConf = getOrgNotificationsConf.rules;
          const data = {
            rules: orgNotificationsConf,
            org: org
          };
          await apply(devicesList[0], user, data);
        }
      }
      return Service.successResponse({
        code: 200,
        message: 'Success',
        data: 'updated successfully'
      });
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }

  /**
   * Get account/system default notifications settings
   **/
  static async notificationsDefaultConfGET ({ account = null }, { user }) {
    try {
      let response;
      if (account) {
        response = await notificationsConf.find({ account: account }, { rules: 1, _id: 0 }).lean();
        if (response.length > 0) {
          const sortedRules = Object.fromEntries(
            Object.entries(response[0].rules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
          );
          return Service.successResponse([sortedRules]);
        }
      // If the account doesn't have a default or the user asked the system default - retrieve the system default
      } if (!account || response.length === 0) {
        response = await notificationsConf.find({ name: 'Default notifications settings' }, { rules: 1, _id: 0 }).lean();
        const sortedRules = Object.fromEntries(
          Object.entries(response[0].rules).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        );
        return Service.successResponse([sortedRules]);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async emailNotificationsGET ({ org, account, group }, { user }) {
    try {
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }
      // a function to retrieve users details
      const createCurrentUser = async (userId, orgId) => {
        const currentUser = {};
        const userData = await users.find({ _id: userId });
        const notificationsData = await notificationsConf.find({ org: orgId });
        currentUser._id = userId;
        currentUser.email = userData[0].email;
        currentUser.name = userData[0].name;
        currentUser.lastName = userData[0].lastName;
        currentUser.signedToCritical = notificationsData[0].signedToCritical.includes(userId);
        currentUser.signedToWarning = notificationsData[0].signedToWarning.includes(userId);
        currentUser.signedToDaily = notificationsData[0].signedToDaily.includes(userId);
        return currentUser;
      };

      let response = [];
      let membersIds;
      if (org) {
        const uniqueUsers = new Set();
        const orgData = await Organizations.find({ _id: org });
        const orgAccount = orgData[0].account;
        const orgGroup = orgData[0].group;
        membersIds = await membership.find({
          $or: [
            { to: 'organization', organization: org },
            { to: 'account', account: orgAccount },
            { to: 'group', account: orgAccount, group: orgGroup }
          ]
        });
        for (const member of membersIds) {
          if (!uniqueUsers.has(member.user.toString())) {
            uniqueUsers.add(member.user.toString());
            const isPermitted = await checkMemberLevel(member.to, member.role, member.to === 'organization' ? member.organization : member.to === 'account' ? member.account : member.group
              , user._id, user.defaultAccount._id, member);
            if (isPermitted) {
              response.push(await createCurrentUser(member.user, org));
            }
          }
        }
      } else {
        const uniqueUsers = new Set();
        for (let i = 0; i < orgIds.length; i++) {
          const orgData = await Organizations.find({ _id: orgIds[i] });
          const orgAccount = orgData[0].account;
          const orgGroup = orgData[0].group;
          const orgMembers = await membership.find({
            $or: [
              { to: 'organization', organization: orgIds[i] },
              { to: 'account', account: orgAccount },
              { to: 'group', account: orgAccount, group: orgGroup }
            ]
          });
          for (const member of orgMembers) {
            if (!uniqueUsers.has(member.user.toString())) {
              uniqueUsers.add(member.user.toString());
              const isPermitted = await checkMemberLevel(member.to, member.role, member.to === 'organization' ? member.organization : member.to === 'account' ? member.account : member.group
                , user._id, user.defaultAccount._id, member);
              if (isPermitted) {
                const currentUser = await createCurrentUser(member.user, orgIds[i]);
                response.push({ ...currentUser, count: 1 });
              }
            } else {
              const index = response.findIndex(x => x._id.toString() === member.user.toString());
              const currentUser = await createCurrentUser(member.user, orgIds[i]);
              if (index !== -1) {
                const existingUser = response[index];
                existingUser.signedToCritical = existingUser.signedToCritical !== currentUser.signedToCritical ? null : existingUser.signedToCritical;
                existingUser.signedToWarning = existingUser.signedToWarning !== currentUser.signedToWarning ? null : existingUser.signedToWarning;
                existingUser.signedToDaily = existingUser.signedToDaily !== currentUser.signedToDaily ? null : existingUser.signedToDaily;
                existingUser.count++;
              }
            }
          }
        }
        response = response
          .filter(user => user.count >= orgIds.length)
          .map(user => {
            const { count, ...rest } = user;
            return rest;
          });
      }
      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }

  static async emailNotificationsPUT ({ emailNotificationsConfPut }, { user }) {
    try {
      const { org, account, group, emailsSigning } = emailNotificationsConfPut;
      const orgIds = await NotificationsService.validateParams(org, account, group, user);
      if (orgIds.error) {
        return orgIds;
      }
      if (org) {
        for (let i = 0; i < emailsSigning.length; i++) {
          const emailSigning = emailsSigning[i];
          // validate that the user has permissions to the organization
          const userData = await users.findOne({ _id: emailSigning._id }).populate('defaultAccount');
          const userOrgList = await getUserOrganizations(userData);
          if (!Object.values(userOrgList).find(o => o.id === org)) {
            return Service.rejectResponse('One of the users does not have permission to access the organization');
          }
          const signedToCritical = emailSigning.signedToCritical ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
          const signedToWarning = emailSigning.signedToWarning ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
          const signedToDaily = emailSigning.signedToDaily ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
          if (emailSigning.signedToCritical === false) {
            await notificationsConf.updateOne({ org: org }, { $pull: { signedToCritical: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
          } else if (signedToCritical !== undefined) {
            await notificationsConf.updateOne({ org: org }, { $addToSet: { signedToCritical: signedToCritical } }, { upsert: true });
          }
          if (emailSigning.signedToWarning === false) {
            await notificationsConf.updateOne({ org: org }, { $pull: { signedToWarning: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
          } else if (signedToWarning !== undefined) {
            await notificationsConf.updateOne({ org: org }, { $addToSet: { signedToWarning: signedToWarning } }, { upsert: true });
          }
          if (emailSigning.signedToDaily === false) {
            await notificationsConf.updateOne({ org: org }, { $pull: { signedToDaily: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
          } else if (signedToDaily !== undefined) {
            await notificationsConf.updateOne({ org: org }, { $addToSet: { signedToDaily: signedToDaily } }, { upsert: true });
          }
        }
      } else {
        // verify that all the users have a permission to access all the organizations under the account/group
        for (let i = 0; i < orgIds.length; i++) {
          for (let j = 0; j < emailsSigning.length; j++) {
            const emailSigning = emailsSigning[j];
            const userData = await users.findOne({ _id: emailSigning._id }).populate('defaultAccount');
            const userOrgList = await getUserOrganizations(userData);
            if (!Object.values(userOrgList).find(o => o.id === orgIds[i])) {
              return Service.rejectResponse('All the users must have an access permission to each one of the organizations');
            }
          }
        }
        for (let i = 0; i < orgIds.length; i++) {
          for (let j = 0; j < emailsSigning.length; j++) {
            const emailSigning = emailsSigning[j];
            const signedToCritical = emailSigning.signedToCritical ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
            const signedToWarning = emailSigning.signedToWarning ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
            const signedToDaily = emailSigning.signedToDaily ? mongoose.Types.ObjectId(emailSigning._id) : undefined;
            if (emailSigning.signedToCritical === false) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $pull: { signedToCritical: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
            } else if (signedToCritical !== undefined) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $addToSet: { signedToCritical: signedToCritical } }, { upsert: true });
            }
            if (emailSigning.signedToWarning === false) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $pull: { signedToWarning: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
            } else if (signedToWarning !== undefined) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $addToSet: { signedToWarning: signedToWarning } }, { upsert: true });
            }
            if (emailSigning.signedToDaily === false) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $pull: { signedToDaily: mongoose.Types.ObjectId(emailSigning._id) } }, { upsert: true });
            } else if (signedToDaily !== undefined) {
              await notificationsConf.updateOne({ org: orgIds[i] }, { $addToSet: { signedToDaily: signedToDaily } }, { upsert: true });
            }
          }
        }
      }
      return Service.successResponse({
        code: 200,
        message: 'Success',
        data: 'updated successfully'
      });
    } catch (e) {
      return Service.rejectResponse({
        code: e.status || 500,
        message: e.message || 'Internal Server Error'
      });
    }
  }
}

module.exports = NotificationsService;
