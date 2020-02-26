/* eslint-disable no-unused-vars */
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
  static async accesstokensGET ({ offset, limit }, { user }) {
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
        e.message || 'Invalid input',
        e.status || 405
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
      await AccessTokens.remove({
        _id: id,
        org: user.defaultOrg._id
      });

      return Service.successResponse();
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
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
        e.message || 'Invalid input',
        e.status || 405,
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
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }
}

module.exports = AccessTokensService;
