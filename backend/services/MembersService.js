/* eslint-disable no-unused-vars */
const Service = require('./Service');

class MembersService {

  /**
   * Get all Members
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async membersGET({ offset, limit }, { user }) {
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
   * Modify member
   *
   * id String Numeric ID of the account to modify
   * memberRequest MemberRequest  (optional)
   * returns Member
   **/
  static async membersIdPUT({ id, memberRequest }, { user }) {
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
   * Create new member
   *
   * memberRequest MemberRequest  (optional)
   * returns Member
   **/
  static async membersPOST({ memberRequest }, { user }) {
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

module.exports = MembersService;
