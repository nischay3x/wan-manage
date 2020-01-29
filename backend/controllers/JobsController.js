const Controller = require('./Controller');

class JobsController {
  constructor(Service) {
    this.service = Service;
  }

  async jobsGET(request, response) {
    await Controller.handleRequest(request, response, this.service.jobsGET);
  }

  async jobsIdDELETE(request, response) {
    await Controller.handleRequest(request, response, this.service.jobsIdDELETE);
  }

}

module.exports = JobsController;
