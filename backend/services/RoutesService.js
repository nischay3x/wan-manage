/* eslint-disable no-unused-vars */
const Service = require('./Service');

class RoutesService {

  /**
   * Retrieve device routes information
   *
   * id String Numeric ID of the Device to feth information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static devicesIdRoutesGET({ id, offset, limit }) {
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

module.exports = RoutesService;
