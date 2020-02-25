// const { Middleware } = require('swagger-express-middleware');
const fs = require('fs');
const path = require('path');
const https = require('https');
const configs = require('./configs')();
const swaggerUI = require('swagger-ui-express');
const yamljs = require('yamljs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { OpenApiValidator } = require('express-openapi-validator');
const openapiRouter = require('./utils/openapiRouter');

const passport = require('passport');
const auth = require('./authenticate');
const morgan = require('morgan');
const logger = require('./logging/logging')({ module: module.filename, type: 'req' });
const { reqLogger, errLogger } = require('./logging/request-logging');

// periodic tasks
const deviceStatus = require('./periodic/deviceStatus')();
const deviceQueues = require('./periodic/deviceQueue')();
const deviceSwVersion = require('./periodic/deviceSwVersion')();
const deviceSwUpgrade = require('./periodic/deviceperiodicUpgrade')();
const notifyUsers = require('./periodic/notifyUsers')();

// rate limiter
const rateLimit = require('express-rate-limit');
const RateLimitStore = require('./rateLimitStore');

// mongo database UI
const mongoExpress = require('mongo-express/lib/middleware');
const mongoExpressConfig = require('./mongo_express_config');

// Internal routers definition
const adminRouter = require('./routes/admin');

// WSS
const WebSocket = require('ws');
const connections = require('./websocket/Connections')();
const broker = require('./broker/broker.js');

class ExpressServer {
  constructor(port, openApiYaml) {
    this.port = port;
    this.app = express();
    this.openApiPath = openApiYaml;
    this.schema = yamljs.load(openApiYaml);

    this.setupMiddleware();
  }

  setupMiddleware() {
    // this.setupAllowedMedia();
    this.app.use((req, res, next) => {
      console.log(`${req.method}: ${req.url}`);
      return next();
    });

    // A middleware that adds a unique request ID for each request
    // or uses the existing request ID, if there is one.
    // THIS MIDDLEWARE MUST BE ASSIGNED FIRST.
    // this.app.use((req, res, next) => {
    //   // Add unique ID to each request
    //   req.id = req.get('X-Request-Id') || uuid();
    //   res.set('X-Request-Id', req.id);

    //   // Set the remote address IP on the request
    //   req.ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    //   next();
    // });

    // Request logging middleware - must be defined before routers.
    this.app.use(reqLogger);
    this.app.set('trust proxy', true); // Needed to get the public IP if behind a proxy

    // Don't expose system internals in response headers
    this.app.disable('x-powered-by');

    // Use morgan request logger in development mode
    if (configs.get('environment') === 'development') this.app.use(morgan('dev'));


    // Start periodic device tasks
    deviceStatus.start();
    deviceQueues.start();
    deviceSwVersion.start();
    deviceSwUpgrade.start();
    notifyUsers.start();

    // Secure traffic only
    this.app.all('*', (req, res, next) => {
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
      max: 300, // Up to 300 request per IP address
      message: 'Request rate limit exceeded',
      onLimitReached: (req, res, options) => {
        logger.error(
          'Request rate limit exceeded. blocking request', {
            params: { ip: req.ip },
            req: req
          });
      }
    });
    this.app.use(rateLimiter);

    // eneral settings here
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cookieParser());

    // // Routes allowed without authentication
    this.app.use(express.static(path.join(__dirname, configs.get('clientStaticDir'))));

    // Secure traffic only
    this.app.all('*', (req, res, next) => {
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

    // no authentication
    this.app.use('/api/connect', require('./routes/connect'));
    this.app.use('/api/users', require('./routes/users'));

    // add API documentation
    this.app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(this.schema));

    // initialize passport and authentication
    this.app.use(passport.initialize());

    // Enable db admin only in development mode
    if (configs.get('environment') === 'development') {
      logger.warn('Warning: Enabling UI database access');
      this.app.use('/admindb', mongoExpress(mongoExpressConfig));
    }

    // Enable routes for non-authorized links
    this.app.use('/ok', express.static(path.join(__dirname, 'public', 'ok.html')));
    this.app.use('/spec', express.static(path.join(__dirname, 'api', 'openapi.yaml')));
    this.app.get('/hello', (req, res) => res.send('Hello World'));

    this.app.use(auth.verifyUserJWT);
    // this.app.use(auth.verifyPermission);

    try {
      // FIXME: temporary map the OLD routes
      this.app.use('/api/devices', require('./routes/devices'));
      this.app.use('/api/devicestats', require('./routes/deviceStats'));
      this.app.use('/api/tunnels', require('./routes/tunnels'));
      this.app.use('/api/accounts', require('./routes/accounts').accountsRouter);
      this.app.use('/api/members', require('./routes/members'));
    } catch (error) {
      logger.error('Error: Can\'t connect OLD routes');
    }

    // Intialize routes
    this.app.use('/api/admin', adminRouter);

    // reserved for future use
    // this.app.get('/login-redirect', (req, res) => {
    //   res.status(200);
    //   res.json(req.query);
    // });
    // this.app.get('/oauth2-redirect.html', (req, res) => {
    //   res.status(200);
    //   res.json(req.query);
    // });

      new OpenApiValidator({
        apiSpecPath: this.openApiPath,
      }).install(this.app);

      this.app.use(openapiRouter());
  }

  addErrorHandler() {
    // "catchall" handler, for any request that doesn't match one above, send back index.html file.
    this.app.get('*', (req, res, next) => {
      logger.info("Route not found", {req: req});
      res.sendFile(path.join(__dirname, configs.get('clientStaticDir'), 'index.html'));
    });

    // catch 404 and forward to error handler
    this.app.use(function(req, res, next) {
      next(createError(404));
    });

    // Request error logger - must be defined after all routers
    // Set log severity on the request to log errors only for 5xx status codes.
    this.app.use((err, req, res, next) => {
      req.logSeverity = err.status || 500;
      next(err);
    });
    this.app.use(errLogger);

    /**
     * suppressed eslint rule: The next variable is required here, even though it's not used.
     *
     ** */
    // eslint-disable-next-line no-unused-vars
    this.app.use((error, req, res, next) => {
      const errorResponse = error.error || error.errors || error.message || 'Unknown error';
      res.status(error.status || 500);
      res.type('json');
      res.json({ error: errorResponse });
    });
  }

  async launch() {
    this.addErrorHandler();

    try {
      this.options = {
        key: fs.readFileSync(path.join(__dirname, 'bin', configs.get('httpsCertKey'))),
        cert: fs.readFileSync(path.join(__dirname, 'bin', configs.get('httpsCert')))
      };

      this.server = https.createServer(this.options, this.app);

      // setup wss here
      this.wss = new WebSocket.Server({
        server: this.server,
        verifyClient: connections.verifyDevice
      });

      connections.registerConnectCallback('broker', broker.deviceConnectionOpened);
      connections.registerCloseCallback('broker', broker.deviceConnectionClosed);

      this.wss.on('connection', connections.createConnection);
      logger.info('Websocket server running');

      this.server.listen(this.port, () => {
        logger.info('HTTP server listening on port', {params: {port: configs.get('httpPort')}});
        return this.server;
      });
    } catch (error) {
      console.error(error);
    }
  }

  async close() {
    if (this.server !== undefined) {
      await this.server.close();
      console.log(`Server on port ${this.port} shut down`);
    }
  }
}

module.exports = ExpressServer;
