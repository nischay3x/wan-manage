const Controller = require('./Controller');

class TunnelsController {
  constructor (Service) {
    this.service = Service;
  }

  async tunnelsIdDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsIdDELETEGET);
  }

  async tunnelsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsGET);
  }
}

module.exports = TunnelsController;
