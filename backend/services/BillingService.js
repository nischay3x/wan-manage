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

const Service = require('./Service');
const flexibilling = require('../flexibilling');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

class BillingService {
  /**
   * Get all Invoices
   *
   * offset Integer The number of items to skip before starting to collect the result set
   * limit Integer The numbers of items to return (optional)
   * returns List
   **/
  static async invoicesGET ({ offset, limit }, { user }) {
    try {
      const customerId = user.defaultAccount.billingCustomerId;

      if (!customerId) {
        logger.error('Account does not have link to billing system', { params: {} });
        return Service.rejectResponse(new Error('Unknown account error'), 500);
      }

      const invoices = await flexibilling.retrieveInvoices({ customer_id: customerId });

      const _invoices = invoices.map(value => {
        return {
          id: value.invoice.id,
          type: 'card',
          payment_method: 'card',
          amount: value.invoice.total,
          base_currency_code: value.invoice.base_currency_code,
          status: value.invoice.status,
          date: value.invoice.date
        };
      });

      for (let idx = 0; idx < _invoices.length; idx++) {
        _invoices[idx].download_url = await flexibilling.retrieveInvoiceDownloadLink({
          invoice_id: _invoices[idx].id
        });
      }

      const summary = await flexibilling.getMaxDevicesRegisteredSummmary(user.defaultAccount.id);
      const amount = await flexibilling.getCurrentUsage({ customer_id: customerId });
      const status = await flexibilling.getSubscriptionStatus({ customer_id: customerId });

      return Service.successResponse({
        invoices: _invoices,
        summary,
        amount,
        subscription: status
      });
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Delete a job
   *
   * id Integer Numeric ID of the Job to delete
   * no response value expected for this operation
   **/
  static async couponsPOST ({ couponsRequest }, { user }) {
    try {
      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = BillingService;
