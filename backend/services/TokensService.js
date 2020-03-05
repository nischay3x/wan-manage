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

const jwt = require('jsonwebtoken');
const configs = require('../configs.js')();
const Tokens = require('../models/tokens');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');

class TokensService {
  /**
   * Get all Tokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async tokensGET ({ org, offset, limit }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const result = await Tokens.find({ org: { $in: orgList } });

      const tokens = result.map(item => {
        return {
          _id: item.id,
          org: item.org.toString(),
          name: item.name,
          token: item.token,
          createdAt: item.createdAt.toISOString()
        };
      });

      return Service.successResponse(tokens);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete token
   *
   * id String Numeric ID of the Token to delete
   * no response value expected for this operation
   **/
  static async tokensIdDELETE ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      await Tokens.remove({
        _id: id,
        org: { $in: orgList }
      });

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  static async tokensIdGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const result = await Tokens.findOne({ _id: id, org: { $in: orgList } });

      const token = {
        _id: result.id,
        org: result.org.toString(),
        name: result.name,
        token: result.token,
        createdAt: result.createdAt.toISOString()
      };
      return Service.successResponse(token);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify a token
   *
   * id String Numeric ID of the Token to modify
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static async tokensIdPUT ({ id, org, tokenRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const result = await Tokens.findOneAndUpdate(
        { _id: id, org: { $in: orgList } },
        { $set: tokenRequest },
        { useFindAndModify: false, upsert: false, runValidators: true, new: true });

      const token = {
        _id: result.id,
        org: result.org.toString(),
        name: result.name,
        token: result.token,
        createdAt: result.createdAt.toISOString()
      };

      return Service.successResponse(token, 201);
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
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static async tokensPOST ({ org, tokenRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const body = jwt.sign({
        org: orgList[0].toString(),
        account: user.defaultAccount._id
      }, configs.get('deviceTokenSecretKey'));

      const token = await Tokens.create({
        name: tokenRequest.name,
        org: orgList[0].toString(),
        token: body
      });

      return Service.successResponse({
        _id: token.id,
        org: token.org.toString(),
        name: token.name,
        token: token.token,
        createdAt: token.createdAt.toISOString()
      }, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = TokensService;
