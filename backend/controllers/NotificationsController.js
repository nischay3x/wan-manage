// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const Controller = require('./Controller');

class NotificationsController {
  constructor (Service) {
    this.service = Service;
  }

  async notificationsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsGET);
  }

  async notificationsConfGET (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsConfGET);
  }

  async emailNotificationsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.emailNotificationsGET);
  }

  async emailNotificationsPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.emailNotificationsPUT);
  }

  async notificationsDefaultConfGET (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsDefaultConfGET);
  }

  async notificationsIdPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsIdPUT);
  }

  async notificationsPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsPUT);
  }

  async notificationsConfPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsConfPUT);
  }

  async notificationsDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.notificationsDELETE);
  }

  async webhookSettingsGET (request, response) {
    await Controller.handleRequest(request, response, this.service.webhookSettingsGET);
  }

  async webhookSettingsPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.webhookSettingsPUT);
  }
}
module.exports = NotificationsController;
