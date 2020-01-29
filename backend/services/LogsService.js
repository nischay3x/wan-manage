/* eslint-disable no-unused-vars */
const Service = require('./Service');

class LogsService {

  /**
   * Retrieve device logs information
   *
   * id String Numeric ID of the Device to feth information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * filter String Filter to be applied (optional)
   * returns DeviceLog
   **/
  static devicesIdLogsGET({ id, offset, limit, filter }) {
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

module.exports = LogsService;
