/* eslint-disable no-unused-vars */
const Service = require('./Service');

class UsersService {

  /**
   * Login
   *
   * loginRequest LoginRequest  (optional)
   * no response value expected for this operation
   **/
  static usersLoginPOST({ loginRequest }) {
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
   * Reset password
   *
   * resetPasswordRequest ResetPasswordRequest  (optional)
   * no response value expected for this operation
   **/
  static usersResetPasswordPOST({ resetPasswordRequest }) {
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

module.exports = UsersService;
