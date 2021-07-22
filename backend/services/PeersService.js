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
const Peers = require('../models/peers');
const pick = require('lodash/pick');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

class PeersService {
  static selectPeerParams (item) {
    // Pick relevant fields
    const retPeer = pick(item, [
      'name',
      'localFQDN',
      'remoteFQDN',
      'remoteIP',
      'monitoringType',
      'monitoringTarget',
      'psk'
    ]);

    retPeer._id = item._id.toString();
    return retPeer;
  }

  /**
   * Retrieve peers
   *
   * org ID of the Device to fetch tunnel information about
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async peersGET ({ org, offset, limit }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const response = await Peers.find({
        org: { $in: orgList }
      }).skip(offset).limit(limit).lean();

      const peers = response.map(p => {
        return PeersService.selectPeerParams(p);
      });

      return Service.successResponse(peers);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    };
  }

  /**
   * Create new peer
   *
   * peer
   * returns The new peer
   **/
  static async peersPOST ({ org, peer }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const newPeer = await Peers.create({ ...peer, org: orgList[0].toString() });
      return Service.successResponse(newPeer);
    } catch (e) {
      let msg = e.message || 'Internal Server Error';
      const status = e.status || 500;

      // Change the duplicate error message to make it clearer
      if (e.name === 'MongoError' && e.code === 11000) {
        msg = `Peer name ${peer.name} already exists for this organization`;
      }

      return Service.rejectResponse(msg, status);
    }
  }

  /**
   * Update peer
   **/
  static async peersIdPUT ({ id, org, peer }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const updatedPeer = await Peers.findOneAndUpdate(
        { org: { $in: orgList }, _id: id },
        {
          name: peer.name,
          localFQDN: peer.localFQDN,
          remoteFQDN: peer.remoteFQDN,
          remoteIP: peer.remoteFQDN,
          psk: peer.psk,
          monitoringType: peer.monitoringType,
          monitoringTarget: peer.monitoringTarget
        },
        { new: true }
      );

      if (updatedPeer) {
        const hasTunnels = false; // TODO!!!!! //
        // Check if has tunnels based on this peer, if so, send update tunnels jobs to devices
        if (hasTunnels) {
          // UPDATE EXISTING TUNNELS! // TODO!!!!!
        }

        return Service.successResponse(updatedPeer);
      } else {
        logger.error('Failed to update peer', {
          params: { id, org, orgList, peer }
        });
        throw new Error('The peer was not updated. Please check the ID or org paramter');
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete peer
   **/
  static async peersIdDelete ({ id, org, peer }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);

      const hasTunnels = false; // TODO!!!!! //
      // Check if has tunnels based on this peer, if so, prevent deletion and return error
      if (hasTunnels) {
        throw new Error('There are tunnels based on this configuration. Please delete them first');
      }

      const resp = await Peers.deleteOne({ _id: id, org: { $in: orgList } });

      if (resp && resp.deletedCount === 1) {
        return Service.successResponse(null, 204);
      } else {
        logger.error('Failed to remove peer', {
          params: { id, org, orgList, peer, resp: resp }
        });
        throw new Error('The peer was not deleted. Please check the ID or org paramter');
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = PeersService;
