// flexiWAN SD-WAN software - flexiEdge, flexiManage.
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

const findKey = require('lodash/findKey');

/**
 * Get available ips from a mask
 * @param  {number} mask  subnet mask
 * @return {number}       number of available ips
 */
function getAvailableIps (mask) {
  return findKey(maskByIpRange, ips => ips === parseInt(mask));
}

/**
 * Get subnet mask of available ip
 * @param  {number} ips   number of available ips
 * @return {number}       subnet mask
 */
function getSubnetMask (ips) {
  return maskByIpRange[ips];
}

const maskByIpRange = {
  1: 32,
  2: 31,
  4: 30,
  8: 29,
  16: 28,
  32: 27,
  64: 26,
  128: 25,
  256: 24,
  512: 23,
  1024: 22,
  2048: 21,
  4096: 20,
  8192: 19,
  16384: 18,
  32768: 17,
  65536: 16,
  131072: 15,
  262144: 14,
  524288: 13,
  1048576: 12,
  2097152: 11,
  4194304: 10,
  8388608: 9,
  16777216: 8,
  33554432: 7,
  67108864: 6,
  134217728: 5,
  268435456: 4,
  536870912: 3,
  1073741824: 2,
  2147483648: 1
};

module.exports = { getSubnetMask, getAvailableIps };
