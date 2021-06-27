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

// Returns paginated array of data
const paginated = (data, offset, limit) => {
  if (offset !== undefined || limit !== undefined) {
    if (limit !== undefined) {
      limit = +limit > 0 ? +limit : data.length;
    }
    if (offset !== undefined) {
      offset = +offset > 0 ? +offset : 0;
    }
    return data.slice(offset, offset + limit);
  }
  return data;
};

module.exports = {
  paginated
};
