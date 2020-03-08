const Service = require('./Service');
const PathLabels = require('../models/pathlabels');
const { devices } = require('../models/devices');

class PathLabelsService {
  /**
   * Get all Path labels
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * org String Organization to be filtered by (optional)
   * returns List
   **/
  static async pathlabelsGET ({ offset, limit, org }, { user }) {
    try {
      const pathLabels = await PathLabels.find(
        { org: user.defaultOrg._id.toString() },
        { name: 1, description: 1, color: 1 }
      ).skip(offset).limit(limit);

      return Service.successResponse(pathLabels);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete a Path label
   *
   * id String Numeric ID of the Path label to delete
   * no response value expected for this operation
   **/
  static async pathlabelsIdDELETE ({ id }, { user }) {
    try {
      // Don't allow to delete a label which is being used
      // Improve this code when adding tunnels/policies.
      const count = await devices.countDocuments({ 'interfaces.pathlabels': id });
      if (count > 0) {
        const message = 'Cannot delete a path label that is being used';
        return Service.rejectResponse(message, 400);
      }

      const { deletedCount } = await PathLabels.deleteOne({
        org: user.defaultOrg._id.toString(),
        _id: id
      });

      if (deletedCount === 0) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse({}, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Get a Path label by id
   *
   * id String Numeric ID of the Path label to retrieve
   * org String Organization to be filtered by (optional)
   * returns PathLabel
   **/
  static async pathlabelsIdGET ({ id, org }, { user }) {
    try {
      const pathLabel = await PathLabels.findOne(
        {
          org: user.defaultOrg._id.toString(),
          _id: id
        },
        {
          name: 1,
          description: 1,
          color: 1
        }
      );

      if (!pathLabel) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(pathLabel);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify a Path label
   *
   * id String Numeric ID of the Path label to modify
   * pathLabelRequest PathLabelRequest
   * returns PathLabel
   **/
  static async pathlabelsIdPUT ({ id, pathLabelRequest }, { user }) {
    try {
      const { name, description, color } = pathLabelRequest;
      const pathLabel = await PathLabels.findOneAndUpdate(
        {
          org: user.defaultOrg._id.toString(),
          _id: id
        },
        {
          org: user.defaultOrg._id.toString(),
          name: name,
          description: description,
          color: color
        },
        {
          fields: { name: 1, description: 1, color: 1 },
          new: true
        }
      );

      if (!pathLabel) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(pathLabel);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Add a new Path label
   *
   * pathLabelRequest PathLabelRequest
   * returns PathLabel
   **/
  static async pathlabelsPOST ({ pathLabelRequest }, { user }) {
    try {
      const { name, description, color } = pathLabelRequest;
      const result = await PathLabels.create({
        org: user.defaultOrg._id.toString(),
        name: name,
        description: description,
        color: color
      });

      const pathLabel = (({ name, description, color, _id }) => ({
        name,
        description,
        color,
        _id
      }))(result);
      return Service.successResponse(pathLabel, 201);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = PathLabelsService;
