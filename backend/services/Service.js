const { TypedError } = require('../utils/errors');

class Service {
  static rejectResponse (error, code = 500) {
    return { error, code };
  }

  static successResponse (payload, code = 200) {
    return { payload, code };
  }

  static handleRequestError (e, payload, code = 200) {
    if (e instanceof TypedError && e.type === 'timeout') {
      return this.successResponse({ ...payload, error: 'timeout' }, code);
    } else {
      return this.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = Service;
