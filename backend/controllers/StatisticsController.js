const Controller = require('./Controller');

class StatisticsController {
  constructor(Service) {
    this.service = Service;
  }

  async devicesIdStatisticsGET(request, response) {
    await Controller.handleRequest(request, response, this.service.devicesIdStatisticsGET);
  }

}

module.exports = StatisticsController;
