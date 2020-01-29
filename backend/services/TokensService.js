/* eslint-disable no-unused-vars */
const Service = require('./Service');

class TokensService {

  /**
   * Get all Tokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static tokensGET({ offset, limit }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
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
  static tokensIdDELETE({ id }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
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
  static tokensIdPUT({ id, tokenRequest }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
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
   * id String Numeric ID of the Token to modify
   * tokenRequest TokenRequest  (optional)
   * returns Token
   **/
  static tokensPOST({ id, tokenRequest }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
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
