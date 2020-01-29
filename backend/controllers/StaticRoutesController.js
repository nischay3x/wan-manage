const Controller = require('./Controller');

class StaticRoutesController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesIdStaticroutesGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesGET);
  }

  async devicesIdStaticroutesRouteDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesRouteDELETE);
  }

  async devicesIdStaticroutesRoutePOST(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesRoutePOST);
  }

  async devicesIdStaticroutesRoutePUT(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStaticroutesRoutePUT);
  }

}

module.exports = StaticRoutesController;
