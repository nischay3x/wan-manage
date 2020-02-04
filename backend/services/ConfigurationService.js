/* eslint-disable no-unused-vars */
const Service = require('./Service');

class ConfigurationService {

  /**
   * Retrieve device configuration information
   *
   * id String Numeric ID of the Device to fetch information about
   * returns DeviceConfiguration
   **/
  static async devicesIdConfigurationGET({ id }, { user }) {
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

module.exports = ConfigurationService;
