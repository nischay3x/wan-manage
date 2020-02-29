const Controller = require('./Controller');

class RoutesController {
  constructor(Service) {
    this.service = Service;
  }
}

module.exports = RoutesController;
