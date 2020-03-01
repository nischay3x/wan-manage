/* eslint-disable no-unused-vars */
const Service = require('./Service');

class PathLabelsService {
  /**
   * Get all Path labels
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * org String Organization to be filtered by (optional)
   * returns List
   **/
  static pathlabelsGET ({ offset, limit, org }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse({}));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405
          ));
        }
      }
    );
  }

  /**
   * Delete a Path label
   *
   * id String Numeric ID of the Path label to delete
   * no response value expected for this operation
   **/
  static pathlabelsIdDELETE ({ id }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405
          ));
        }
      }
    );
  }

  /**
   * Get a Path label by id
   *
   * id String Numeric ID of the Path label to retrieve
   * org String Organization to be filtered by (optional)
   * returns PathLabel
   **/
  static pathlabelsIdGET ({ id, org }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405
          ));
        }
      }
    );
  }

  /**
   * Modify a Path label
   *
   * id String Numeric ID of the Path label to modify
   * pathLabelRequest PathLabelRequest  (optional)
   * returns PathLabel
   **/
  static pathlabelsIdPUT ({ id, pathLabelRequest }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405
          ));
        }
      }
    );
  }

  /**
   * Add a new Path label
   *
   * pathLabelRequest PathLabelRequest  (optional)
   * returns Error
   **/
  static pathlabelsPOST ({ pathLabelRequest }) {
    return new Promise(
      async (resolve) => {
        try {
          resolve(Service.successResponse(''));
        } catch (e) {
          resolve(Service.rejectResponse(
            e.message || 'Invalid input',
            e.status || 405
          ));
        }
      }
    );
  }
}

module.exports = PathLabelsService;
