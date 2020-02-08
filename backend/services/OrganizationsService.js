/* eslint-disable no-unused-vars */
const Service = require('./Service');

const Accounts = require('../models/accounts');
const Devices = require('../models/devices');
const Users = require('../models/users');
const Organizations = require('../models/organizations');
const Tunnels = require('../models/tunnels');
const TunnelIds = require('../models/tunnelids');
const Tokens = require('../models/tokens');
const AccessTokens = require('../models/accesstokens');
const Membership = require('../models/membership');
const Connections = require('../websocket/Connections')();

const Flexibilling = require('../flexibilling');

const { getUserOrganizations, getUserOrgByID, orgUpdateFromNull } = require('../utils/membershipUtils');
const mongoConns = require('../mongoConns.js')();
const { getToken } = require('../tokens');


class OrganizationsService {

  /**
   * Get all organizations
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async organizationsGET({ offset, limit }, { user }) {
    try {
      const orgs = await getUserOrganizations(user);
      const result = Object.keys(orgs).map((key) => { return orgs[key]});

      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Delete organization
   *
   * id String Numeric ID of the Organization to delete
   * no response value expected for this operation
   **/
  static async organizationsIdDELETE({ id }, { user }) {
    try {
      let session = null;

      mongoConns.getMainDB().startSession()
        .then((_session) => {
          session = _session;
          return session.startTransaction();
        })
        // Find and remove organization from account
        .then(async () => {
          // Only allow to delete current default org, this is required to make sure the API permissions
          // are set properly for updating this organization
          if (user.defaultOrg._id.toString() === id) {
            return Accounts.findOneAndUpdate(
              { _id: user.defaultAccount },
              { $pull: { organizations: id } },
              { upsert: false, new: true, session }
            );
          } else {
            throw new Error('Please select an organization to delete it');
          }
        })
        .then(async (account) => {
          if (!account) throw new Error('Cannot delete organization');
          // Since the selected org is deleted, need to select another organization available
          user.defaultOrg = null;
          await orgUpdateFromNull({ user }, res);
          return Promise.resolve(true);
        })
        // Remove organization
        .then(() => {
          return Organizations.findOneAndRemove({ _id: id, account: user.defaultAccount }, { session: session });
        })
        // Remove all memberships that belong to the organization, but keep group even if empty
        .then(() => {
          return Membership.deleteMany({ organization: id }, { session: session });
        })
        // Remove organization inventory (devices, tokens, tunnelIds, tunnels)
        .then(() => {
          return Tunnels.deleteMany({ org: id }, { session: session });
        })
        .then(() => {
          return TunnelIds.deleteMany({ org: id }, { session: session });
        })
        .then(() => {
          return Tokens.deleteMany({ org: id }, { session: session });
        })
        .then(() => {
          return AccessTokens.deleteMany({ organization: id }, { session: session });
        })
        .then(async () => {
          // Find all devices for organization
          const orgDevices = await Devices.find({ org: id }, { machineId: 1, _id: 0 }, { session: session });
          // Get the account total device count
          const deviceCount = await Devices.countDocuments({ account: user.defaultAccount._id }).session(session);
          // Delete all devices
          await Devices.deleteMany({ org: id }, { session: session });
          // Unregister a device (by removing the removed org number)
          await Flexibilling.registerDevice({
            account: user.defaultAccount._id,
            count: deviceCount,
            increment: -orgDevices.length
          }, session);
          // Disconnect all devices
          orgDevices.forEach((device) => Connections.deviceDisconnect(device.machineId));
          return Promise.resolve(true);
        })
        .then(() => {
          return session.commitTransaction();
        })
        .then(async () => {
          // Session committed, set to null
          session = null;
          return Service.successResponse('');
        })
        .catch((err) => {
          if (session) session.abortTransaction();
          logger.error('Error deleting organization', { params: { reason: err.message } });
          throw new Error('Error deleting organization');
        });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Modify organization
   *
   * id String Numeric ID of the Organization to modify
   * organizationRequest OrganizationRequest  (optional)
   * returns Organization
   **/
  static async organizationsIdPUT({ id, organizationRequest }, { user }) {
    try {
      // Only allow to update current default org, this is required to make sure the API permissions
      // are set properly for updating this organization
      if (user.defaultOrg._id.toString() === id) {
        const resultOrg = await Organizations.findOneAndUpdate(
          { _id: id },
          { $set: organizationRequest },
          { upsert: false, multi: false, new: true, runValidators: true }
        );
        // Update token
        const token = await getToken({ user }, { orgName: organizationRequest.name });
        // res.setHeader('Refresh-JWT', token);
        return Service.successResponse(resultOrg);
      } else {
        throw new Error('Please select an organization to update it');
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Add new organization
   *
   * organizationRequest OrganizationRequest  (optional)
   * returns Organization
   **/
  static async organizationsPOST({ organizationRequest }, { user }) {
    try {
      let session = null;
      let org = null;

      mongoConns.getMainDB().startSession()
        .then((_session) => {
          session = _session;
          return session.startTransaction();
        })
        .then(() => {
          const orgBody = { organizationRequest, account: user.defaultAccount };
          return Organizations.create([orgBody], { session: session });
        })
        .then((_org) => {
          org = _org[0];
          return Users.findOneAndUpdate(
            // Query, use the email
            { _id: user._id },
            // Update
            { defaultOrg: org._id },
            // Options
            { upsert: false, new: true, session: session }
          );
        })
        .then((updUser) => {
          if (!updUser) throw new Error('Error updating default organization');
          // Add organization to default account
          return Accounts.findOneAndUpdate(
            { _id: updUser.defaultAccount },
            { $addToSet: { organizations: org._id } },
            { upsert: false, new: true, session: session }
          );
        })
        .then((updAccount) => {
          if (!updAccount) throw new Error('Error adding organization to account');
          return session.commitTransaction();
        })
        .then(async () => {
          // Session committed, set to null
          session = null;
          const token = await getToken({ user }, { org: org._id, orgName: org.name });
          res.setHeader('Refresh-JWT', token);
          return res.status(200).json(org);
        })





      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

}

module.exports = OrganizationsService;
