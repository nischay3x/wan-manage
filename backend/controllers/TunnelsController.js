const Controller = require('./Controller');

class TunnelsController {
  constructor(Service) {
    this.service = Service;
  }

  async tunnelsIdGET(request, response) {
    await Controller.handleRequest(request, response, this.service.tunnelsIdGET);
  }

}

module.exports = TunnelsController;
