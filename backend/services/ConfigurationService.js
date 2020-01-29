/* eslint-disable no-unused-vars */
const Service = require('./Service');

class ConfigurationService {

  /**
   * Retrieve device configuration information
   *
   * id String Numeric ID of the Device to feth information about
   * returns DeviceConfiguration
   **/
  static devicesIdConfigurationGET({ id }) {
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

module.exports = ConfigurationService;
