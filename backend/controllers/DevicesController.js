const Controller = require('./Controller');

class DevicesController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesExecutePOST(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesExecutePOST);
  }

  async devicesGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesGET);
  }

  async devicesIdGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdGET);
  }

  async devicesIdDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdDELETE);
  }

  async devicesIdExecutePOST(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdExecutePOST);
  }

  async devicesRegisterPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesRegisterPOST);
  }

  async devicesIdPUT(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdPUT);
  }

}

module.exports = DevicesController;
