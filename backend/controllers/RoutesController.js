const Controller = require('./Controller');

class RoutesController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesIdRoutesGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdRoutesGET);
  }

}

module.exports = RoutesController;
