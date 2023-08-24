const notificationsModel = require('../models/notifications');
const devicesModel = require('../models/devices').devices;
const logger = require('../logging/logging')({ module: module.filename, type: 'migration' });
const keyBy = require('lodash/keyBy');

async function up () {
  try {
    await notificationsModel.aggregate([
      {
        $addFields: {
          count: { $ifNull: ['$count', 1] },
          resolved: { $ifNull: ['$resolved', false] },
          targets: {
            $ifNull: [
              '$targets',
              {
                deviceId: '$device',
                tunnelId: null,
                interfaceId: null
              }
            ]
          },
          severity: { $ifNull: ['$severity', 'warning'] },
          agentAlertsInfo: { $ifNull: ['$agentAlertsInfo', {}] },
          emailSent: {
            $ifNull: [
              '$emailSent',
              {
                sendingTime: null,
                rateLimitedCount: 0
              }
            ]
          }
        }
      },
      {
        $unset: ['device', 'machineId']
      },
      {
        $out: 'notifications'
      }
    ]).allowDiskUse(true);

    logger.info('Database migration successful', {
      params: { collections: ['notifications'], operation: 'up' }
    });
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['notifications'], operation: 'up', err: err.message }
    });
  }
}

async function down () {
  try {
    const devices = await devicesModel.find();
    const devicesMapById = keyBy(devices, '_id');

    const notifications = await notificationsModel.find();

    for (const notification of notifications) {
      if (!notification.targets || !notification.targets.deviceId) {
        continue;
      }

      const device = devicesMapById[notification.targets.deviceId];
      const machineId = device.machineId;

      await notificationsModel.collection.updateOne(
        { _id: notification._id },
        {
          $set: {
            device: notification.targets.deviceId,
            machineId: machineId
          },
          $unset: {
            count: '',
            resolved: '',
            targets: '',
            severity: '',
            agentAlertsInfo: '',
            emailSent: ''
          }
        }
      );
    }

    logger.info('Database migration successful', {
      params: { collections: ['notifications'], operation: 'down' }
    });
  } catch (err) {
    logger.error('Database migration failed', {
      params: { collections: ['notifications'], operation: 'down', err: err.message }
    });
  }
}

module.exports = { up, down };
