/* eslint-disable no-unused-vars */
const Service = require('./Service');

class StaticRoutesService {

  /**
   * Retrieve device static routes information
   *
   * id String Numeric ID of the Device to feth information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns StaticRoute
   **/
  static devicesIdStaticroutesGET({ id, offset, limit }) {
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
   * Delete static route
   *
   * id String Numeric ID of the Device
   * route String Numeric ID of the Route to delete
   * no response value expected for this operation
   **/
  static devicesIdStaticroutesRouteDELETE({ id, route }) {
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
   * Create new static route
   *
   * id String Numeric ID of the Device
   * route String Numeric ID of the Route to modify
   * staticRouteRequest StaticRouteRequest  (optional)
   * returns DeviceStaticRouteInformation
   **/
  static devicesIdStaticroutesRoutePOST({ id, route, staticRouteRequest }) {
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
   * Modify static route
   *
   * id String Numeric ID of the Device
   * route String Numeric ID of the Route to modify
   * staticRouteRequest StaticRouteRequest  (optional)
   * returns StaticRoute
   **/
  static devicesIdStaticroutesRoutePUT({ id, route, staticRouteRequest }) {
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

module.exports = StaticRoutesService;
