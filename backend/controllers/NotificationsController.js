const Controller = require('./Controller');

class NotificationsController {
  constructor(Service) {
    this.service = Service;
  }

  async notificationsGET(request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsGET);
  }

}

module.exports = NotificationsController;
