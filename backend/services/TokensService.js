/* eslint-disable no-unused-vars */
const Service = require('./Service');

const jwt = require('jsonwebtoken');
const configs = require('../configs.js')();
const Tokens = require('../models/tokens');

class TokensService {
  /**
   * Get all Tokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async tokensGET ({ offset, limit }, { user }) {
    try {
      const result = await Tokens.find({ org: user.defaultOrg._id });

      const tokens = result.map(item => {
        return {
          _id: item.id,
          name: item.name,
          token: item.token
        };
      });

      return Service.successResponse(tokens);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Delete token
   *
   * id String Numeric ID of the Token to delete
   * no response value expected for this operation
   **/
  static async tokensIdDELETE ({ id }, { user }) {
    try {
      await Tokens.remove({
        _id: id,
        org: user.defaultOrg._id
      });

      return Service.successResponse();
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  static async tokensIdGET({ id }, { user }) {
    try {
      const token = await Tokens.findOne({ _id: id, org: user.defaultOrg._id });

      return Service.successResponse([token]);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
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
  static async tokensIdPUT ({ id, tokenRequest }, { user }) {
    try {
      const result = await Tokens.findOneAndUpdate(
        { _id: id, org: user.defaultOrg._id },
        { tokenRequest },
        { upsert: false, runValidators: true, new: true });

      const token = {
        _id: result.id,
        name: result.name,
        token: result.token
      };

      return Service.successResponse(token);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Create new access token
   *
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static async tokensPOST ({ tokenRequest }, { user }) {
    try {
      const body = jwt.sign({
        org: user.defaultOrg._id.toString(),
        account: user.defaultAccount._id
      }, configs.get('deviceTokenSecretKey'));

      const token = await Tokens.create({
        name: tokenRequest.name,
        org: user.defaultOrg._id.toString(),
        token: body
      });

      return Service.successResponse({
        _id: token.id,
        name: token.name,
        token: token.token
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }
}

module.exports = TokensService;
