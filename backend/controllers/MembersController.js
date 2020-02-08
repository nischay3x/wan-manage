const Controller = require('./Controller');

class MembersController {
  constructor(Service) {
    this.service = Service;
  }

  async membersGET(request, response) {
    await Controller.handleRequest(request, response, this.service.membersGET);
  }

  async membersIdDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.membersIdDELETE);
  }

  async membersIdPUT(request, response) {
    await Controller.handleRequest(request, response, this.service.membersIdPUT);
  }

  async membersPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.membersPOST);
  }

}

module.exports = MembersController;
