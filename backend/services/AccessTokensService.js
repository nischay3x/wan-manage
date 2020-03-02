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

const { getToken } = require('../tokens');
const AccessTokens = require('../models/accesstokens');

class AccessTokensService {
  /**
   * Get all AccessTokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async accesstokensGET ({ org, offset, limit }, { user }) {
    try {
      const response = await AccessTokens.find({ account: user.defaultAccount._id })
        .populate('organization');

      const result = response.map(record => {
        return {
          _id: record.id,
          name: record.name,
          organization: record.organization.name,
          token: record.token,
          isValid: record.isValid
        };
      });
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete access token
   *
   * id String Numeric ID of the Access token to delete
   * no response value expected for this operation
   **/
  static async accesstokensIdDELETE ({ id }, { user }) {
    try {
      await AccessTokens.deleteOne({
        _id: id,
        account: user.defaultAccount._id
      });

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify an access token
   *
   * id String Numeric ID of the Access token to modify
   * accessToken AccessToken  (optional)
   * returns List
   **/
  static async accesstokensIdPUT ({ id, accessToken }, { user }) {
    const token = accessToken;

    try {
      await AccessTokens.update({
        _id: id,
        org: user.defaultOrg._id
      }, { $set: token }, { upsert: false, multi: false, runValidators: true, new: true });

      const result = await AccessTokens.findOne({
        _id: id,
        org: user.defaultOrg._id
      });

      const accessToken = {
        _id: result.id,
        name: result.name,
        token: result.token
      };

      return Service.successResponse(accessToken);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Create new access token
   *
   * accessTokenRequest AccessTokenRequest  (optional)
   * returns AccessToken
   **/
  static async accesstokensPOST ({ accessTokenRequest }, { user }) {
    try {
      const tokenIsValid = user.defaultAccount.organizations.find((record) => {
        return record._id.toString() === accessTokenRequest.organization;
      });

      if (!tokenIsValid) {
        return Service.rejectResponse('Invalid input', 405);
      }

      const accessToken = new AccessTokens({
        account: user.defaultAccount._id,
        organization: accessTokenRequest.organization,
        name: accessTokenRequest.name,
        token: '', // should be empty for now
        isValid: true
      });

      const token = await getToken({ user }, {
        type: 'app_access_token',
        id: accessToken._id.toString(),
        org: accessTokenRequest.organization
      }, false);

      accessToken.token = token;
      await accessToken.save();

      return Service.successResponse({
        _id: accessToken.id,
        name: accessToken.name,
        token: accessToken.token
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = AccessTokensService;
