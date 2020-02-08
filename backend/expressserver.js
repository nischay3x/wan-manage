// const { Middleware } = require('swagger-express-middleware');
const fs = require('fs');
const path = require('path');
const https = require('https');
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

// mongo database UI
const mongoExpress = require('mongo-express/lib/middleware');
const mongoExpressConfig = require('./mongo_express_config');

// Internal routers definition
const adminRouter = require('./routes/admin');

// Devices contact point
const connectRouter = require('./routes/connect');

const logger = require('./logger');

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

    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cookieParser());

    // no authentication
    this.app.use('/api/connect', require('./routes/connect'));
    this.app.use('/api/users', require('./routes/users'));

    // add API documentation
    this.app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(this.schema));

    // initialize passport and authentication
    this.app.use(passport.initialize());
    this.app.use(auth.verifyUserJWT);
    // this.app.use(auth.verifyPermission);

    // add mongodb UI
    this.app.use('/admindb', mongoExpress(mongoExpressConfig));

    // Intialize routes
    this.app.use('/api/admin', adminRouter);
    this.app.use('/api/connect', connectRouter);

    this.app.use('/ok', express.static(path.join(__dirname, 'public', 'ok.html')));
    this.app.use('/spec', express.static(path.join(__dirname, 'api', 'openapi.yaml')));
    this.app.get('/hello', (req, res) => res.send('Hello World'));

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
    this.app.use('*', (req, res) => {
      res.status(404);
      res.send(JSON.stringify({ error: `path ${req.baseUrl} doesn't exist` }));
    });
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
        key: fs.readFileSync('./bin/cert.local.flexiwan.com/domain.key'),
        cert: fs.readFileSync('./bin/cert.local.flexiwan.com/certificate.pem')
      };

      this.server = https.createServer(this.options, this.app).listen(this.port, () => {
        console.log(`server running on port ${this.port}`);
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
