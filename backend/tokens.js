// flexiWAN SD-WAN software - flexiEdge, flexiManage. For more information go to https://flexiwan.com
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

var jwt = require('jsonwebtoken');
const {preDefinedPermissions, getUserPermissions} = require('./models/membership');
var configs = require('./configs')();
const logger = require('./logging/logging')({module: module.filename, type: 'req'});

// JWT strategy definition
// Generate token
exports.getToken = async function (req, override = {}, shouldExpire = true) {

    // Get user permissions
    let perms = null;
    try {
        perms = await getUserPermissions(req.user);
    } catch (err) {
        perms = {...preDefinedPermissions.none};
        logger.error('Could not get user permissions', {params:{user: req.user, message: err.message}, req: req})
    }

    return jwt.sign({
        "_id": req.user._id,
        "username": req.user.username,
        "org": req.user.defaultOrg? req.user.defaultOrg._id:null,
        "orgName": req.user.defaultOrg? req.user.defaultOrg.name:null,
        "account": req.user.defaultAccount? req.user.defaultAccount._id:null,
        "accountName": req.user.defaultAccount? req.user.defaultAccount.name:null,
        "perms": perms,
     ...override}, configs.get('userTokenSecretKey'), shouldExpire ? {expiresIn: configs.get('userTokenExpiration')} : null);
};

exports.getRefreshToken = async(req, override={}) => {
    return jwt.sign({
        "_id": req.user._id,
        "username": req.user.username,
     ...override}, configs.get('userTokenSecretKey'), {expiresIn: configs.get('userRefreshTokenExpiration')});
};

exports.verifyToken = (token) => {
    return jwt.verify(token, configs.get('userTokenSecretKey'));
};
