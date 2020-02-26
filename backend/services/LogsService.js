/* eslint-disable no-unused-vars */
const Service = require('./Service');

const { devices } = require('../models/devices');
const Connections = require('../websocket/Connections')();

class LogsService {

  /**
   * Retrieve device logs information
   *
   * id String Numeric ID of the Device to fetch information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * filter String Filter to be applied (optional)
   * returns DeviceLog
   **/
  static async devicesIdLogsGET({ id, offset, limit, filter }, { user }) {
    try {
      const device = await devices.find({ _id: mongoose.Types.ObjectId(id) });
        if (!device || device.length === 0) return Service.rejectResponse(404);

        if (!Connections.isConnected(device[0].machineId)) {
          return Service.successResponse({
            status: 'disconnected',
            log: []
          });
        }

        const deviceLogs = await Connections.deviceSendMessage(
          null,
          device[0].machineId,
          {
            entity: 'agent',
            message: 'get-device-logs',
            params: {
              lines: limit || '100',
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
          return Service.rejectResponse('Failed to get device logs', 500);
        }

        return Service.successResponse({
          status: 'connected',
          logs: deviceLogs.message
        });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    }
  }
}

module.exports = LogsService;
