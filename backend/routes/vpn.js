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

var configs = require("../configs")();
const express = require("express");
const router = express.Router();
const createError = require("http-errors");
const bodyParser = require("body-parser");
const User = require("../models/users");
const PurchasedApplications = require("../models/purchasedApplications");
const Applications = require("../models/applications");
const { validateEmail } = require("../models/validators");
const {
  getUserOrganizations,
  getUserAccounts,
} = require("../utils/membershipUtils");
const cors = require("./cors");
var passport = require("passport");

const MultiSamlStrategy = require("passport-saml/multiSamlStrategy");

const ProvidersSettings = {
  'G-Suite': {
    path: '/login/callback',
    entryPoint: 'https://samltest.id/saml/idp',
    issuer: 'passport-saml'
  },
};

passport.use(
  new MultiSamlStrategy(
    {
      passReqToCallback: true,
      // get saml options based on org auth method
      getSamlOptions: function (request, done) {
        if (!request.provider) {
          return done(err);
        } else {
          const type = request.provider.type;
 
          console.log(
            "ProvidersSettings[type]",
            ProvidersSettings[type]
          );
          return done(null, ProvidersSettings[type]);
        }
      },
    },
    function (profile, done) {
      return done(null, profile);
    }
  )
);

router.use(bodyParser.json());

router
  .route("/login")
  .options(cors.cors, (req, res) => {
    res.sendStatus(200);
  })
  .post(
    cors.cors,
    async (req, res, next) => {
      // check if email is valid
      if (!validateEmail(req.body.username)) {
        console.log(2);
        return next(createError(401, "Could not get user info"));
      }

      // try to get user
      const user = await User.findOne({ email: req.body.username }).populate(
        "defaultAccount"
      );

      if (user) {
        const accounts = await getUserAccounts(user);

        if (accounts.length > 1) {
          console.log("choose account");
          // TODO: return to select account
        }

        // get user organization
        const userOrgs = await getUserOrganizations(user);
        if (Array.isArray(userOrgs) && userOrgs.length === 0) {
          console.log("no org found");
          return next(createError(401, "Could not get user info"));
        }

        // if user exists on multi orgs - need to choose one
        const orgIds = Object.keys(userOrgs);
        if (orgIds.length > 1) {
          console.log("choose org");
          // TODO: return to select org
        }

        // get open vpn app
        const openVpn = await Applications.findOne({ name: "Open VPN" });
        if (!openVpn) {
          return next(createError(500, "No Open VPN app installed"));
        }

        // check if open vpn install on selected org
        const vpnInstalled = await PurchasedApplications.findOne({
          org: orgIds[0],
          app: openVpn._id,
          removed: false,
        });

        if (!vpnInstalled) {
          return next(createError(500, "No Open VPN app installed"));
        }

        // get enabled authentication methods
        const authMethods = vpnInstalled.configuration.authentications || [];
        const enabledAuthMethods = authMethods.filter((a) => a.enabled);

        if (enabledAuthMethods.length === 0) {
          const msg =
            "No Authentication method enabled. please contact your system administrator";
          
            return next(createError(500, msg));
        }

        console.log("user", user);
        console.log("accounts", accounts);
        console.log("userOrgs", userOrgs);
        console.log("enabledAuthMethods", enabledAuthMethods);
        req.provider = enabledAuthMethods[0];
        return next();
      } else {
        return next(createError(401, "Could not get user info"));
      }
    },
    passport.authenticate("saml"),
    function (req, res) {
      console.log("-----------------------------");
      console.log("login call back dumps");
      console.log(req.user);
      console.log("-----------------------------");
      res.send("Log in Callback Success");
    }
  );

module.exports = router;
