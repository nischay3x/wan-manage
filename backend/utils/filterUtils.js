// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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
 * Converts API query filter operation to mongoose expression
 * @param {Object} filter a filter object from API request
 * @param {String} filter.key Key to be filtered by
 * @param {String} filter.op filter operation [==, !=, contains...]
 * @param {String} filter.val Value to be filtered
 * @param {String} filter.type Type of the value, optional
 * @returns {Object} Mongoose expression for the $match stage
*/
const getFilterExpression = ({ key, op, val, type }) => {
  // The key is required
  if (!key) return undefined;
  // Two sides case '?' means 'A' && 'B' - for example "device?.name" be replaced by
  // 'cond': [{"deviceA.name": "DeviceName"}, {"deviceB.name": "DeviceName"}]
  // where 'cond' depends on 'op' - if negative it will be '$and' and '$or' if opposite
  // Example: 'op' is '==' or 'contains' the condition in that case will be
  // { $or: [{"deviceA.name": "DeviceName"}, {"deviceB.name": "DeviceName"}] }
  if (key.includes('?')) {
    const cond = op.includes('!') ? '$and' : '$or';
    return {
      [cond]: ['A', 'B'].map(side => getFilterExpression({
        key: key.replace(/\?/g, side), op, val, type
      }))
    };
  }
  // Special case for dates filtering
  if (type === 'date') {
    const date1 = new Date(val);
    const date2 = new Date(val);
    date2.setDate(date1.getDate() + 1); // beginning of the next day
    switch (op) {
      case '==':
        return { $and: [{ [key]: { $gte: date1 } }, { [key]: { $lt: date2 } }] };
      case '!=':
        return { $and: [{ [key]: { $lt: date1 } }, { [key]: { $gte: date2 } }] };
      case 'in last days':
        date1.setDate(date1.getDate() - 3); // let's do the last 3 days...
        return { $and: [{ [key]: { $lt: date1 } }, { [key]: { $gte: date2 } }] };
      case '<':
        return { [key]: { $lt: date1 } };
      case '>':
        return { [key]: { $gte: date2 } };
      case '<=':
        return { [key]: { $lt: date2 } };
      case '>=':
        return { [key]: { $gte: date1 } };
      default:
        return undefined;
    }
  }
  // all other types
  switch (op) {
    case '==':
      return { [key]: val };
    case '!=':
      return { [key]: { $ne: val } };
    case 'contains':
      return { [key]: { $regex: val } };
    case '!contains':
      return { [key]: { $regex: '^((?!' + val + ').)*$' } };
    case '<':
      return { [key]: { $lt: val } };
    case '>':
      return { [key]: { $gt: val } };
    case '<=':
      return { [key]: { $lte: val } };
    case '>=':
      return { [key]: { $gte: val } };
    default:
      return undefined;
  }
};

module.exports = {
  getFilterExpression
};
