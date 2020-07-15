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

/**
 * Get available ips from a mask
 * @param  {number} mask  subnet mask
 * @return {number}       number of available ips
 */
function getAvailableIps (mask) {
  return Math.pow(2, 32 - mask);
}

/**
 * Get subnet mask by number of available ips
 * @param  {number} ips   number of ips range
 * @return {number}       subnet mask
 */
function getSubnetMaskByRangeCount (ips) {
  let count = 0;

  while (ips) {
    ips = ips >>> 1;
    count++;
  }

  var mask = 32 - count + 1;
  return mask;
}

module.exports = {
  getSubnetMask: getSubnetMaskByRangeCount,
  getAvailableIps
};
