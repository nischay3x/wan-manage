const Controller = require('./Controller');

class AccountsController {
  constructor(Service) {
    this.service = Service;
  }

  async accountsIdGET(request, response) {
    await Controller.handleRequest(request, response, this.service.accountsIdGET);
  }

  async accountsIdPUT(request, response) {
    await Controller.handleRequest(request, response, this.service.accountsIdPUT);
  }

  async accountsPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.accountsPOST);
  }

}

module.exports = AccountsController;
