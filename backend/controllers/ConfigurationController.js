const Controller = require('./Controller');

class ConfigurationController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesIdConfigurationGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdConfigurationGET);
  }

}

module.exports = ConfigurationController;
