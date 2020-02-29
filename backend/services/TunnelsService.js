// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const Service = require('./Service');
const Tunnels = require('../models/tunnels');
const mongoose = require('mongoose');

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
  static async tunnelsIdDELETE ({ id, offset, limit }, { user }) {
    try {
      const resp = await Tunnels.findOneAndUpdate(
        // Query
        { _id: mongoose.Types.ObjectId(id), org: user.defaultOrg._id },
        // Update
        { isActive: false },
        // Options
        { upsert: false, new: true });

      if (resp != null) {
        return Service.successResponse(resp);
      } else {
        return Service.rejectResponse(404);
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405
      );
    }
  }

  /**
   * Retrieve device tunnels information
   *
   * id String Numeric ID of the Device to fetch tunnel information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async tunnelsGET ({ offset, limit }, { user }) {
    try {
      const response = await Tunnels.find({ org: user.defaultOrg._id, isActive: true })
        .populate('deviceA').populate('deviceB');

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
        e.status || 405
      );
    };
  }
}

module.exports = TunnelsService;
