const Controller = require('./Controller');

class AccessTokensController {
  constructor(Service) {
    this.service = Service;
  }

  async accesstokensGET(request, response) {
    await Controller.handleRequest(request, response, this.service.accesstokensGET);
  }

  async accesstokensIdDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.accesstokensIdDELETE);
  }

  async accesstokensIdPUT(request, response) {
    await Controller.handleRequest(request, response, this.service.accesstokensIdPUT);
  }

  async accesstokensPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.accesstokensPOST);
  }

}

module.exports = AccessTokensController;
