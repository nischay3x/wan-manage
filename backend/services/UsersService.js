/* eslint-disable no-unused-vars */
const Service = require('./Service');

class UsersService {

  /**
   * Login
   *
   * loginRequest LoginRequest  (optional)
   * no response value expected for this operation
   **/
  static async usersLoginPOST({ loginRequest }) {
    try {
      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Reset password
   *
   * resetPasswordRequest ResetPasswordRequest  (optional)
   * no response value expected for this operation
   **/
  static async usersResetPasswordPOST({ resetPasswordRequest }) {
    try {
      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

}

module.exports = UsersService;
