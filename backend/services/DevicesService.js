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

  static async devicesUpgdSchedPOST( { ids, date }, { user }) {
    try {
      const query = { _id: { $in: ids } };
      const numOfIdsFound = await devices.countDocuments(query);

      // The request is considered invalid if not all device IDs
      // are found in the database. This is done to prevent a partial
      // schedule of the devices in case of a user's mistake.
      if (numOfIdsFound < ids.length) {
        return Service.rejectResponse(new Error('Some devices were not found'), 404);
      }

      const set = { $set: { upgradeSchedule: { time: date, jobQueued: false } } };
      const options = { upsert: false, useFindAndModify: false };
      await devices.updateMany(query, set, options);
      return Service.successResponse();
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  static async devicesIdUpgdSchedPOST( { id, date }, { user }) {
    try {
      const query = { _id: id };
      const set = { $set: { upgradeSchedule: { time: date, jobQueued: false } } };
      const options = { upsert: false, useFindAndModify: false };
      const res = await devices.updateOne(query, set, options);
      if (res.n === 0) return Service.rejectResponse(createError(404));
    } catch (err) {
      return Service.rejectResponse();
    }
    return Service.successResponse();
  }

  /**
   * Get device software version
   *
   * returns DeviceLatestVersion
   **/
  static async devicesLatestVersionsGET () {
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
      const result = await devices.findOne({ _id: id, org: user.defaultOrg._id });
      const device = DevicesService.selectDeviceParams(result);

      return Service.successResponse([device]);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Retrieve device configuration
   *
   * id String Numeric ID of the Device to retrieve configuration from
   * Returns Device Configuration
   **/
  static async devicesIdConfigurationGET({ id }, { user }) {
    try {
      const device = await devices.find({ _id: mongoose.Types.ObjectId(id) });
      if (!device || device.length === 0) return Service.rejectResponse(new Error('Device not found'), 404);

      if (!connections.isConnected(device[0].machineId)) {
        return Service.successResponse({
          status: 'disconnected',
          configurations: []
        });
      }

      const deviceConf = await connections.deviceSendMessage(
        null,
        device[0].machineId,
        { entity: 'agent', message: 'get-router-config' }
      );

      if (!deviceConf.ok) {
        logger.error('Failed to get device configuration', {
          params: {
            deviceId: id,
            response: deviceConf.message
          },
          req: req
        });
        return Service.rejectResponse(new Error('Failed to get device configuration'), 500);
      }

      return Service.successResponse({
        status: 'connected',
        configuration: deviceConf.message
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Retrieve device configuration
   *
   * id String Numeric ID of the Device to retrieve configuration from
   * Returns Device Configuration
   **/
  static async devicesIdLogsGET({ id, filter, lines }, { user }) {
    try {
      const device = await devices.find({ _id: mongoose.Types.ObjectId(id) });
      if (!device || device.length === 0) return Service.rejectResponse(new Error('Device not found'), 404);

      if (!connections.isConnected(device[0].machineId)) {
        return Service.successResponse({
          status: 'disconnected',
          log: []
        });
      }

      const deviceLogs = await connections.deviceSendMessage(
        null,
        device[0].machineId,
        {
          entity: 'agent',
          message: 'get-device-logs',
          params: {
            lines: lines || '100',
            filter: filter || 'all'
          }
        }
      );

      if (!deviceLogs.ok) {
        logger.error('Failed to get device logs', {
          params: {
            deviceId: id,
            response: deviceLogs.message
          },
          req: req
        });
        return Service.rejectResponse(new Error('Failed to get device logs'), 404);
      }

      return Service.successResponse({
        status: 'connected',
        logs: deviceLogs.message
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
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
