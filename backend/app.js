// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2020 flexiWAN Ltd.

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

const rateLimit = require('express-rate-limit');
var configs = require('./configs')();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var passport = require('passport');
var auth = require('./authenticate');
var deviceStatus = require('./periodic/deviceStatus')();
var deviceQueues = require('./periodic/deviceQueue')();
const deviceSwVersion = require('./periodic/deviceSwVersion')();
const deviceSwUpgrade = require('./periodic/deviceperiodicUpgrade')();
const notifyUsers = require('./periodic/notifyUsers')();

// var usersRouter = require('./routes/users');
// var devicesRouter = require('./routes/devices');
// var tokensRouter = require('./routes/tokens');
// var tunnelsRouter = require('./routes/tunnels');
// var { organizationsRouter } = require('./routes/organizations');
// var { accountsRouter } = require('./routes/accounts');
// var membersRouter = require('./routes/members');

// Routers definition
var adminRouter = require('./routes/admin');
var connectRouter = require('./routes/connect');
// const invoiceRouter = require('./routes/invoices');
// const couponRouter = require('./routes/coupons');

// const portalRouter = require('./routes/portals');
// var deviceStatsRouter = require('./routes/deviceStats');
// var deviceQueueRouter = require('./routes/deviceQueue');
// const notificationsRouter = require('./routes/notifications');
// const accesstokensRouter = require('./routes/accesstokens');

const mongoExpress = require('mongo-express/lib/middleware');
const mongoExpressConfig = require('./mongo_express_config');
const morgan = require('morgan');
const logger = require('./logging/logging')({ module: module.filename, type: 'req' });
const { reqLogger, errLogger } = require('./logging/request-logging');
const RateLimitStore = require('./rateLimitStore');
const uuid = require('uuid/v4');

// Create a resource for download
// var resorucesRouter = require('./routes/resources');
// var downloadRouter = require('./routes/download');

var app = express();

// A middleware that adds a unique request ID for each request
// or uses the existing request ID, if there is one.
// THIS MIDDLEWARE MUST BE ASSIGNED FIRST.
app.use((req, res, next) => {
  // Add unique ID to each request
  req.id = req.get('X-Request-Id') || uuid();
  res.set('X-Request-Id', req.id);

  // Set the remote address IP on the request
  req.ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  next();
});

// Request logging middleware - must be defined before routers.
app.use(reqLogger);

// Use morgan request logger in development mode
if (configs.get('environment') === 'development') app.use(morgan('dev'));

app.set('trust proxy', true); // Needed to get the public IP if behind a proxy

// // Swagger definition
// const swaggerDefinition = {
//   info: {
//     title: 'flexiWAN REST API documentation',
//     version: '1.0.0',
//     description:
//       'This is the REST API for flexiWAN management. ' +
//       // eslint-disable-next-line max-len
//       'Full swagger.json file:
//          <a href="./swagger.json" target="_blank" rel="noopener noreferrer">' +
//       'swagger.json</a>'
//   },
//   components: {},
//   host: configs.get('restServerURL').split('//')[1],
//   basePath: '/api',
//   securityDefinitions: {
//     JWT: {
//       type: 'apiKey',
//       in: 'header',
//       name: 'Authorization',
//       description: ''
//     }
//   }
// };

// const options = {
//   swaggerDefinition,
//   apis: [`${__dirname}/swagger/**/*.yaml`]
// };
// const swaggerUiOptions = {
//   docExpansion: 'none'
// };
// const swaggerSpec = swaggerJSDoc(options);

// Don't expose system internals in response headers
app.disable('x-powered-by');

// Start periodic device tasks
deviceStatus.start();
deviceQueues.start();
deviceSwVersion.start();
deviceSwUpgrade.start();
notifyUsers.start();

// Secure traffic only
app.all('*', (req, res, next) => {
  // Allow Let's encrypt certbot to access its certificate dirctory
  if (!configs.get('shouldRedirectHTTPS') ||
      req.secure || req.url.startsWith('/.well-known/acme-challenge')) {
    return next();
  } else {
    return res.redirect(
      307, 'https://' + req.hostname + ':' + configs.get('redirectHttpsPort') + req.url
    );
  }
});

// Global rate limiter to protect against DoS attacks
// Windows size of 5 minutes
const inMemoryStore = new RateLimitStore(5 * 60 * 1000);
const rateLimiter = rateLimit({
  store: inMemoryStore,
  max: configs.get('userIpReqRateLimit'), // Rate limit for requests in 5 min per IP address
  message: 'Request rate limit exceeded',
  onLimitReached: (req, res, options) => {
    logger.error(
      'Request rate limit exceeded. blocking request', {
        params: { ip: req.ip },
        req: req
      }
    );
  }
});
app.use(rateLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(passport.initialize());

// Routes allowed without authentication
app.use(express.static(path.join(__dirname, configs.get('clientStaticDir'))));
// Enable db admin only in development mode
if (configs.get('environment') === 'development') {
  logger.warn('Warning: Enabling UI database access');
  app.use('/admindb', mongoExpress(mongoExpressConfig));
}

// Add swagger api docs, url api-docs is the latest version.
// Older versions can be added under /api-docs/vX.Y.Z
// app.get('/api-docs/swagger.json', function (req, res) {
//   res.status(200).send(swaggerSpec);
// });
// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, false, swaggerUiOptions));
// app.use('/api/users', usersRouter);
app.use('/api/connect', connectRouter);
// Download a resource
// app.use('/download', downloadRouter);

app.use('/ok', function (req, res, next) {
  res.sendFile(path.join(__dirname, configs.get('clientStaticDir') + '/ok.html'));
});

// Check authentication globally
app.use(auth.verifyUserJWT);
// app.use(auth.auth);

// // Routes from here and below would require authentication if they are under api path
// // To allow specific routes in a path, add the path before the auth and call
// // auth.verifyUserJWT before the request handler itself
// app.use('/api/devices', devicesRouter);
// app.use('/api/tokens', tokensRouter);
// app.use('/api/tunnels', tunnelsRouter);
// app.use('/api/admin', adminRouter);
// app.use('/api/devicestats', deviceStatsRouter);
// app.use('/api/jobs', deviceQueueRouter);
// app.use('/api/organizations', organizationsRouter);
// app.use('/api/accounts', accountsRouter);
// app.use('/api/members', membersRouter);
// app.use('/api/notifications', notificationsRouter);
// app.use('/api/accesstokens', accesstokensRouter);

// // billing support
// app.use('/api/invoices', invoiceRouter);
// app.use('/api/coupons', couponRouter);
// app.use('/api/portals', portalRouter);

// Create a file resource for download
// app.use('/api/resources', resorucesRouter);

// "catchall" handler, for any request that doesn't match one above, send back index.html file.
// app.get('*', (req, res, next) => {
//   logger.info('Route not found', { req: req });
//   res.sendFile(path.join(__dirname, configs.get('clientStaticDir') + '/index.html'));
// });

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// Request error logger - must be defined after all routers
// Set log severity on the request to log errors only for 5xx status codes.
app.use((err, req, res, next) => {
  req.logSeverity = err.status || 500;
  next(err);
});
app.use(errLogger);

// error handler
// In production environment prints only the title, without the trace, check www in bin folder
// On error return json object
app.use(function (err, req, res, next) {
  // In production, we let winston log our errors
  if (configs.get('environment') === 'development') {
    logger.error('Request failed', { params: { status: err.status || 500, reason: err.message } });
  }

  try {
    const status = err.status || 500;
    const message = err.status ? err.message : 'Internal server error';
    return res.status(status).send({ error: message });
  } catch (sendErr) {
    // Remove redundant spaces and newline characters
    const stack = sendErr.stack.replace(/[\r\n ]+/gm, ' ');
    const origStack = err.stack.replace(/[\r\n ]+/gm, ' ');
    logger.error('Caught an unhandled express exception', {
      params: { stack: stack, originalStack: origStack },
      req: req
    });
  }
});

// Register event handlers for uncaught exceptions and promise rejections
process
  .on('uncaughtException', err => {
    // Remove redundant spaces and newline characters
    const stack = err.stack.replace(/[\r\n ]+/gm, ' ');
    logger.error('Caught an unhandled exception', { params: { stack: stack } });
  })
  .on('unhandledRejection', (reason, promise) => {
    // Remove redundant spaces and newline characters
    const stack = reason.stack.replace(/[\r\n ]+/gm, ' ');
    logger.error('Caught an unhandled rejection', { params: { reason: stack, promise: promise } });
  });

module.exports = app;
