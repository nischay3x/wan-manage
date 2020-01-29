const Controller = require('./Controller');

class OrganizationsController {
  constructor(Service) {
    this.service = Service;
  }

  async organizationsGET(request, response) {
    await Controller.handleRequest(request, response, this.service.organizationsGET);
  }

  async organizationsIdDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.organizationsIdDELETE);
  }

  async organizationsIdPUT(request, response) {
    await Controller.handleRequest(request, response, this.service.organizationsIdPUT);
  }

  async organizationsPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.organizationsPOST);
  }

}

module.exports = OrganizationsController;
