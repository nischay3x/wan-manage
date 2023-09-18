// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019-2023  flexiWAN Ltd.

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
 * Gets the device LAN NAT rules for creating a job
 * @async
 * @param   {Array}  rules - enabled LAN NAT rules
 * @return  {Object} parameters to include in the job response data
*/
const getLanNatJobInfo = async (rules) => {
  const requestTime = Date.now();
  const lanNatRules = rules.map(rule => {
    return {
      source: rule.classification?.source?.lanNat,
      destination: rule.classification?.destination?.lanNat
    };
  });
  const params = { 'nat44-1to1': lanNatRules };
  const tasks = [{
    entity: 'agent',
    message: 'add-lan-nat-policy',
    params: params
  }];
  const data = {
    requestTime: requestTime
  };
  return { tasks, data };
};

module.exports = { getLanNatJobInfo };
