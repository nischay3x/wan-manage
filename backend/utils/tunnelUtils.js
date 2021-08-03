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

const randomNum = require('../utils/random-key');

/**
 * Generates various tunnel parameters that will
 * be used for creating the tunnel.
 * @param  {number} tunnelNum tunnel id
 * @return
 * {{
        ip1: string,
        ip2: string,
        mac1: string,
        mac2: string,
        sa1: number,
        sa2: number
    }}
 */
const generateTunnelParams = (tunnelNum, peer = null) => {
  const d2h = (d) => (('00' + (+d).toString(16)).substr(-2));

  // we usr 100 for site-to-site tunnels and 200 for peers
  const segment = peer ? '200' : '100';

  const h = (tunnelNum % 127 + 1) * 2;
  const l = Math.floor(tunnelNum / 127);
  const ip1 = `10.${segment}.` + (+l).toString(10) + '.' + (+h).toString(10);
  const ip2 = `10.${segment}.` + (+l).toString(10) + '.' + (+(h + 1)).toString(10);
  const mac1 = '02:00:27:fd:' + d2h(l) + ':' + d2h(h);
  const mac2 = '02:00:27:fd:' + d2h(l) + ':' + d2h(h + 1);
  const sa1 = (l * 256 + h);
  const sa2 = (l * 256 + h + 1);

  return {
    ip1: ip1,
    ip2: ip2,
    mac1: mac1,
    mac2: mac2,
    sa1: sa1,
    sa2: sa2
  };
};

/**
 * Generates random keys that will be used for tunnels creation
 * @return {{key1: number, key2: number, key3: number, key4: number}}
 */
const generateRandomKeys = () => {
  return {
    key1: randomNum(32, 16),
    key2: randomNum(32, 16),
    key3: randomNum(32, 16),
    key4: randomNum(32, 16)
  };
};

// Default exports
module.exports = {
  generateTunnelParams,
  generateRandomKeys
};
