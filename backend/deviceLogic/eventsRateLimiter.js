
// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2020  flexiWAN Ltd.

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

const { RateLimiterMemory } = require('rate-limiter-flexible');

// 5 times in an hour - stop it for 1 hours
// TODO: consult about the right settings
const publicPortLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60 * 60,
  blockDuration: 60 * 60
});

module.exports = {
  publicPortLimiter
};
