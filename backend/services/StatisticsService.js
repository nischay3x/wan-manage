/* eslint-disable no-unused-vars */
const Service = require('./Service');

class StatisticsService {

  /**
   * Retrieve device statistics information
   *
   * id Object Numeric ID of the Device to feth information about
   * returns DeviceStatistics
   **/
  static devicesIdStatisticsGET({ id }) {
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

module.exports = StatisticsService;
