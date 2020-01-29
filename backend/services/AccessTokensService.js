/* eslint-disable no-unused-vars */
const Service = require('./Service');

class AccessTokensService {

  /**
   * Get all AccessTokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static accesstokensGET({ offset, limit }) {
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
   * Delete access token
   *
   * id String Numeric ID of the Access token to delete
   * no response value expected for this operation
   **/
  static accesstokensIdDELETE({ id }) {
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
   * Modify an access token
   *
   * id String Numeric ID of the Access token to modify
   * accessToken AccessToken  (optional)
   * returns List
   **/
  static accesstokensIdPUT({ id, accessToken }) {
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
   * accessTokenRequest AccessTokenRequest  (optional)
   * returns AccessToken
   **/
  static accesstokensPOST({ accessTokenRequest }) {
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

module.exports = AccessTokensService;
