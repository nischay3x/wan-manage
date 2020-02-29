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

const Controller = require('./Controller');

class DevicesController {
  constructor (Service) {
    this.service = Service;
  }

  async devicesExecutePOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesExecutePOST);
  }

  async devicesGET(request, response) {
    await Controller.handleRequest (request, response, this.service.devicesGET);
  }

  async devicesLatestVersionsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesLatestVersionsGET);
  }

  async devicesIdUpgdSchedPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdUpgdSchedPOST);
  }

  async devicesUpgdSchedPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesUpgdSchedPOST);
  }

  async devicesIdGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdGET);
  }

  async devicesIdConfigurationGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdConfigurationGET);
  }

  async devicesIdLogsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdLogsGET);
  }

  async devicesIdDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdDELETE);
  }

  async devicesIdExecutePOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdExecutePOST);
  }

  async devicesRegisterPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesRegisterPOST);
  }

  async devicesIdPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdPUT);
  }

  async devicesIdLogsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdLogsGET);
  }

  async devicesIdRoutesGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdRoutesGET);
  }

  async devicesIdStaticroutesGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesGET);
  }

  async devicesIdStaticroutesRouteDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesDELETE);
  }

  async devicesIdStaticroutesPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesPOST);
  }

  async devicesIdStaticroutesRoutePATCH (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesPUT);
  }

  async devicesStatisticsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesStatisticsGET);
  }

  async devicesIdStatisticsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStatisticsGET);
  }
}

module.exports = DevicesController;
