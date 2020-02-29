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

const Accounts = require('../models/accounts');
const Devices = require('../models/devices');
const Users = require('../models/users');
const Organizations = require('../models/organizations');
const Tunnels = require('../models/tunnels');
const TunnelIds = require('../models/tunnelids');
const Tokens = require('../models/tokens');
const AccessTokens = require('../models/accesstokens');
const { membership, permissionMasks, preDefinedPermissions } = require('../models/membership');
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
  static async organizationsIdDELETE({ id }, { user }, response) {
    try {
      const session = await mongoConns.getMainDB().startSession();
      await session.startTransaction();

      // Find and remove organization from account
      // Only allow to delete current default org, this is required to make sure the API permissions
      // are set properly for updating this organization
      if (user.defaultOrg._id.toString() !== id) {
        throw new Error('Please select an organization to delete it');
      }

      const account = await Accounts.findOneAndUpdate(
        { _id: user.defaultAccount },
        { $pull: { organizations: id } },
        { upsert: false, new: true, session }
      );


      if (!account) {
        throw new Error('Cannot delete organization');
      }

      // Since the selected org is deleted, need to select another organization available
      user.defaultOrg = null;
      await orgUpdateFromNull({ user }, response);

      // Remove organization
      await Organizations.findOneAndRemove({ _id: id, account: user.defaultAccount }, { session: session });

      // Remove all memberships that belong to the organization, but keep group even if empty
      await membership.deleteMany({ organization: id }, { session: session });

      // Remove organization inventory (devices, tokens, tunnelIds, tunnels)
      await Tunnels.deleteMany({ org: id }, { session: session });
      await TunnelIds.deleteMany({ org: id }, { session: session });
      await Tokens.deleteMany({ org: id }, { session: session });
      await AccessTokens.deleteMany({ organization: id }, { session: session });

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

      await session.commitTransaction();
      return Service.successResponse(204);
    } catch (e) {
      if (session) session.abortTransaction();
      logger.error('Error deleting organization', { params: { reason: err.message } });

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
  static async organizationsIdPUT({ id, organizationRequest }, { user }, response) {
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
        response.setHeader('Refresh-JWT', token);
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
  static async organizationsPOST({ organizationRequest }, { user }, response) {
    try {
      const session = await mongoConns.getMainDB().startSession()
      await session.startTransaction();
      const _org = await Organizations.create([organizationRequest], { session: session });
      const org = _org[0];
      const updUser = await Users.findOneAndUpdate(
        // Query, use the email
        { _id: user._id },
        // Update
        { defaultOrg: org._id },
        // Options
        { upsert: false, new: true, session: session }
      );

      if (!updUser) throw new Error('Error updating default organization');
      // Add organization to default account
      const updAccount = await Accounts.findOneAndUpdate(
        { _id: updUser.defaultAccount },
        { $addToSet: { organizations: org._id } },
        { upsert: false, new: true, session: session }
      );

      if (!updAccount) throw new Error('Error adding organization to account');
      session.commitTransaction();

      const token = await getToken({ user }, { org: org._id, orgName: org.name });
      response.setHeader('Refresh-JWT', token);

      return Service.successResponse(org, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

}

module.exports = OrganizationsService;
