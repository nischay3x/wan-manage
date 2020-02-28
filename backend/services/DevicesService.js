/* eslint-disable no-unused-vars */
const Service = require('./Service');
const { devices } = require('../models/devices');
const connections = require('../websocket/Connections')();
const deviceStatus = require('../periodic/deviceStatus')();
const DevSwUpdater = require('../deviceLogic/DevSwVersionUpdateManager');
const mongoConns = require('../mongoConns.js')();
const pick = require('lodash/pick');
const dispatcher = require('../deviceLogic/dispatcher');

class DevicesService {
  /**
   * Execute an action on the device side
   *
   * action String Command to execute
   * commandRequest CommandRequest  (optional)
   * no response value expected for this operation
   **/
  static async devicesExecutePOST ({ action, commandRequest }, { user }) {
    try {
      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Select the API fields from mongo Device Object
   *
   * @param {mongo Device Object} item
   */
  static selectDeviceParams (item) {
    // Pick relevant fields
    const retDevice = pick(item, [
      'org',
      'description',
      'defaultRoute',
      'deviceToken',
      'machineId',
      'site',
      'hostname',
      'name',
      '_id',
      'pendingDevModification',
      'isApproved',
      'fromToken',
      'account',
      'ipList',
      // Internal array, objects
      'labels',
      'staticroutes',
      'upgradeSchedule']);

    // pick interfaces
    const retInterfaces = item.interfaces.map(i => {
      return pick(i, [
        'IPv6',
        'PublicIP',
        'IPv4',
        'type',
        'MAC',
        'routing',
        'IPv6Mask',
        'isAssigned',
        'driver',
        'IPv4Mask',
        'name',
        'pciaddr',
        '_id'
      ]);
    });

    // Update with additional objects
    retDevice.versions = pick(item.versions, ['agent', 'router', 'device', 'vpp', 'frr']);
    retDevice.interfaces = retInterfaces;
    retDevice.isConnected = connections.isConnected(retDevice.machineId);
    // Add interface stats to mongoose response
    retDevice.deviceStatus = retDevice.isConnected
      ? deviceStatus.getDeviceStatus(retDevice.machineId) || 0 : 0;

    return retDevice;
  }

  /**
   * Get all registered devices
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async devicesGET ({ offset, limit }, { user }) {
    try {
      const result = await devices.find({ org: user.defaultOrg._id });

      const devicesMap = result.map(item => {
        return DevicesService.selectDeviceParams(item);
      });

      return Service.successResponse(devicesMap);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  static async devicesLatestVersionsGET ({ user }) {
    try {
      const swUpdater = await DevSwUpdater.getSwVerUpdaterInstance();
      return Service.successResponse({
        versions: swUpdater.getLatestSwVersions(),
        versionDeadline: swUpdater.getVersionUpDeadline()
      });
    } catch (err) {
      return Service.rejectResponse(err);
    }
  }

  /**
   * Retrieve device
   *
   * id String Numeric ID of the Device to retrieve
   * Returns Device
   **/
  static async devicesIdGET({ id }, { user }) {
    try {
      return Service.successResponse({});
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }

  /**
   * Delete device
   *
   * id String Numeric ID of the Device to delete
   * no response value expected for this operation
   **/
  static async devicesIdDELETE ({ id }, { user }) {
    try {
      await devices.remove({
        _id: id,
        org: user.defaultOrg._id
      });

      // TBD: remove from billing


      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Execute an action on the device side
   *
   * id String Numeric ID of the Device to start
   * action String Command to execute
   * uNKNOWNUnderscoreBASEUnderscoreTYPE UNKNOWN_BASE_TYPE  (optional)
   * no response value expected for this operation
   **/
  static async devicesIdExecutePOST (
    { id, action, uNKNOWNUnderscoreBASEUnderscoreTYPE }, { user }) {
    try {
      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Modify device
   *
   * id String Numeric ID of the Device to modify
   * deviceRequest DeviceRequest  (optional)
   * returns Device
   **/
  static async devicesIdPUT ({ id, deviceRequest }, { user }) {
    let session;
    try {
      session = await mongoConns.getMainDB().startSession();
      await session.startTransaction();
      const origDevice = await devices.findOne({ id: id, org: user.defaultOrg._id });
      const updDevice = await devices.findOneAndUpdate(
        { id: id, org: user.defaultOrg._id },
        deviceRequest,
        { new: true, upsert: false, runValidators: true }
      );
      await session.commitTransaction();
      session = null;

      // TBD: Check to disconnect on device unapprove

      // Apply modify device action
      if (origDevice) {
        // TBD: Cange apply method
        /*
        req.body.method = 'modify';

        dispatcher.apply([origDoc], req, res, next, {
          newDevice: resp
        }).then(() => {
          return resolve({ ok: 1});
        })
        */
      }

      return DevicesService.selectDeviceParams(updDevice);
    } catch (e) {
      if (session) session.abortTransaction();

      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }
}

module.exports = DevicesService;
