/* eslint-disable no-unused-vars */
const Service = require('./Service');

class OrganizationsService {

  /**
   * Get all organizations
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async organizationsGET({ offset, limit }, { user }) {
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
   * Delete organization
   *
   * id String Numeric ID of the Organization to delete
   * no response value expected for this operation
   **/
  static async organizationsIdDELETE({ id }, { user }) {
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
   * Modify organization
   *
   * id String Numeric ID of the Organization to modify
   * organizationRequest OrganizationRequest  (optional)
   * returns Organization
   **/
  static async organizationsIdPUT({ id, organizationRequest }, { user }) {
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
   * Add new organization
   *
   * organizationRequest OrganizationRequest  (optional)
   * returns Organization
   **/
  static async organizationsPOST({ organizationRequest }, { user }) {
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

module.exports = OrganizationsService;
