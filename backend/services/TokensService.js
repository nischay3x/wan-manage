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
  static tokensGET({ offset, limit }, user) {
    return new Promise(
      async (resolve) => {
        try {
        const result = await Tokens.find({ org: user.defaultOrg._id });

          const tokens = result.map(item => {
            return {
              _id: item.id,
              name: item.name,
              token: item.token
            };
          });

          resolve(Service.successResponse(tokens));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405,
          ));
        }
      },
    );
  }

  /**
   * Delete token
   *
   * id String Numeric ID of the Token to delete
   * no response value expected for this operation
   **/
  static tokensIdDELETE({ id }, user) {
    return new Promise(
      async (resolve) => {
        try {
          const result = await Tokens.remove({
            _id: id,
            org: user.defaultOrg._id
          });

          resolve(Service.successResponse(null, 204));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405,
          ));
        }
      },
    );
  }

  /**
   * Modify a token
   *
   * id String Numeric ID of the Token to modify
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static tokensIdPUT({ id, tokenRequest }, user) {
    return new Promise(
      async (resolve) => {
        try {
          await Tokens.update({
            _id: id,
            org: user.defaultOrg._id
          }, { $set: tokenRequest }, { upsert: false, multi: false, runValidators: true, new: true });

          const result = await Tokens.findOne({
            _id: id,
            org: user.defaultOrg._id
          });

          const token = {
            _id: result.id,
            name: result.name,
            token: result.token
          };

          resolve(Service.successResponse(token));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405,
          ));
        }
      },
    );
  }

  /**
   * Create new access token
   *
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static tokensPOST({ tokenRequest }, user) {
    return new Promise(
      async (resolve) => {
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

          resolve(Service.successResponse({
            _id: token.id,
            name: token.name,
            token: token.token
          }));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405,
          ));
        }
      },
    );
  }

}

module.exports = TokensService;
