/* eslint-disable no-unused-vars */
const Service = require('./Service');
const Tunnels = require('../models/tunnels');

// not sure that it is needed
const deviceStatus = require('../periodic/deviceStatus')();

class TunnelsService {

  /**
   * Retrieve device tunnels information
   *
   * id String Numeric ID of the Device to fetch tunnel information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async tunnelsIdGET ({ id, offset, limit }, { user }) {
    try {
      const response = await Tunnels.find({ org: user.defaultOrg._id, isActive: true }).populate('deviceA').populate('deviceB');

      // Populate interface details
      response.forEach((d) => {
        d.set('interfaceADetails',
          d.deviceA.interfaces.filter((ifc) => {
            return ifc._id.toString() === '' + d.interfaceA;
          })[0],
          { strict: false });
        d.set('interfaceBDetails',
          d.deviceB.interfaces.filter((ifc) => {
            return ifc._id.toString() === '' + d.interfaceB;
          })[0],
          { strict: false });

        const tunnelId = d.num;
        // Add tunnel status
        d.set(
          'tunnelStatusA',
          deviceStatus.getTunnelStatus(d.deviceA.machineId, tunnelId) ||
            null,
          { strict: false }
        );

        // Add tunnel status
        d.set(
          'tunnelStatusB',
          deviceStatus.getTunnelStatus(d.deviceB.machineId, tunnelId) ||
            null,
          { strict: false }
        );
      });

      return Service.successResponse(response);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      );
    };
  }
}

module.exports = TunnelsService;
