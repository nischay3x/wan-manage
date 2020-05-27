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

var SamlStrategy = require("passport-saml").Strategy;

passport.use(
  new SamlStrategy(
    {
      path: "/login/callback",
      entryPoint:
        "https://openidp.feide.no/simplesaml/saml2/idp/SSOService.php",
      issuer: "passport-saml",
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
      const user = await User.findOne({ email: req.body.username });

      if (user) {
        const accounts = await getUserAccounts(user);

        if (accounts.length > 1) {
          console.log("choose account");
          // TODO: return to select account
        }

        await user.populate("defaultAccount").execPopulate();

        const userOrgs = await getUserOrganizations(user);

        if (Array.isArray(userOrgs) && userOrgs.length === 0) {
          console.log("no org found");
          return next(createError(401, "Could not get user info"));
        }

        const orgIds = Object.keys(userOrgs);

        if (orgIds.length > 1) {
          console.log("choose org");
          // TODO: return to select org
        }

        const openVpn = await Applications.findOne({ name: "Open VPN" });
        if (!openVpn)
          return next(createError(500, "No Open VPN app installed"));

        // check if open vpn install on this org
        const vpnInstalled = await PurchasedApplications.findOne({
          org: orgIds[0],
          app: openVpn._id,
          removed: false,
        });

        if (!vpnInstalled) {
          return next(createError(500, "No Open VPN app installed"));
        }

        // get authentication methods
        const authMethods = vpnInstalled.configuration.authentications;

        console.log("user", user);
        console.log("accounts", accounts);
        console.log("userOrgs", userOrgs);
        console.log("authMethods", authMethods);
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
