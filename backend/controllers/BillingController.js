const Controller = require('./Controller');

class BillingController {
  constructor(Service) {
    this.service = Service;
  }

  async invoicesGET(request, response) {
    await Controller.handleRequest(request, response, this.service.invoicesGET);
  }

  async couponsPOST(request, response) {
    await Controller.handleRequest(request, response, this.service.couponsPOST);
  }

}

module.exports = BillingController;
