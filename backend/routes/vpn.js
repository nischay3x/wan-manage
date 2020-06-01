// flexiWAN SD-WAN software - flexiEdge,flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

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

// var configs = require('../configs')();
const express = require('express');
const router = express.Router();
const createError = require('http-errors');
const bodyParser = require('body-parser');
const applications = require('../models/applications');
const { validateDomainName } = require('../models/validators');
const cors = require('./cors');

var passport = require('passport');
var OAuth2Strategy = require('passport-oauth2');
const { AuthorizationCode } = require('simple-oauth2');

router.use(bodyParser.json());

passport.use(
  new OAuth2Strategy(
    {
      authorizationURL: 'https://accounts.google.com/o/oauth2/auth',
      tokenURL: 'https://oauth2.googleapis.com/token',
      clientID:
        '194818498973-f88p1a7t88ho4j3m93qs05h6s230o7e4.apps.googleusercontent.com',
      clientSecret: 'cjSFZJJUM6_QwX1BfftQUPEm',
      callbackURL: 'http://localhost:3000/auth/example/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      console.log(1);
      // User.findOrCreate({ exampleId: profile.id }, function (err, user) {
      //   return cb(err, user);
      // });
    }
  )
);

router
  .route('/callback')
  .options(cors.cors, (req, res) => {
    res.sendStatus(200);
  })
  .get((req, res) => {
    console.log('callback get');
    console.log('reqget', req);
  })
  .post((req, res) => {
    console.log('callback post');
    console.log('reqpost', req);
  });

router
  .route('/login')
  .options(cors.cors, (req, res) => {
    res.sendStatus(200);
  })
  .post(
    cors.cors,
    async (req, res, next) => {
      // check if email is valid
      if (!validateDomainName(req.body.organizationDomain)) {
        return next(createError(401, 'Could not get organization info'));
      }

      const vpnApp = await applications.findOne({
        'configuration.domainName': req.body.organizationDomain,
        removed: false
      });

      if (vpnApp) {
        // get enabled authentication methods
        const authMethods = vpnApp.configuration.authentications || [];
        const enabledAuthMethod = authMethods.find((a) => a.enabled);

        if (!enabledAuthMethod) {
          const msg =
            'No Authentication method enabled. please contact your system administrator';

          return next(createError(500, msg));
        }

        req.config = enabledAuthMethod;
        return next();
      } else {
        return next(createError(401, 'Could not get organization info'));
      }
    },
    // passport.authenticate('oauth2', {scope: 'https://www.googleapis.com/auth/plus.login'})
    function (req, res) {
      const config = {
        client: {
          id: req.config.clientId,
          secret: req.config.clientSecret
        },
        auth: {
          tokenHost: 'https://oauth2.googleapis.com/token',
          authorizePath: 'https://accounts.google.com/o/oauth2/auth'
        }
      };

      const client = new AuthorizationCode(config);

      const authorizationUri = client.authorizeURL({
        redirect_uri: 'https://local.flexiwan.com:3443/api/vpn/callback',
        scope: 'plus.login'
      });

      res.redirect(authorizationUri);

      // //   // const client = new ClientCredentials(config);
      // //   // const tokenParams = {
      // //   //   scope: '<scope>',
      // //   // };
      // //   // const accessToken = await client.getToken(tokenParams);

      // //   // console.log("client", client)

    // //   // console.log('-----------------------------');
    // //   // console.log('login call back dumps');
    // //   // console.log(req.user);
    // //   // console.log('-----------------------------');
    // //   // res.send('Log in Callback Success');
    // // }
    }
  );

module.exports = router;
