const Controller = require('./Controller');

class LogsController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesIdLogsGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdLogsGET);
  }

}

module.exports = LogsController;
