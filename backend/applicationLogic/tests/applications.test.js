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

const { isVpn } = require('../remotevpn');
const {
  needToUpdatedDevices
} = require('../applications');

describe('Validate vpn name', () => {
  it('Should be a valid vpn name', () => {
    const res = isVpn('com.flexiwan.remotevpn');
    expect(res).toBe(true);
  });
});

describe('Validate vpn configuration', () => {
  const app = {
    appStoreApp: {
      name: 'Remote Worker VPN',
      identifier: 'com.flexiwan.remotevpn'
    }
  };

  let oldConfig = null;
  let newConfig = null;

  beforeEach(() => {
    oldConfig = {
      routeAllTrafficOverVpn: false,
      serverPort: '1194',
      dnsIps: '8.8.8.8',
      dnsDomains: 'local.dns'
    };
    newConfig = {
      routeAllTrafficOverVpn: false,
      serverPort: '1194',
      dnsIps: '8.8.8.8',
      dnsDomains: 'local.dns'
    };
  });

  it('Should return false', () => {
    const res = needToUpdatedDevices(app, oldConfig, newConfig);
    expect(res).toBe(false);
  });

  it('Should return true if serverPort is different', () => {
    newConfig.serverPort = '1196';
    const res = needToUpdatedDevices(app, oldConfig, newConfig);
    expect(res).toBe(true);
  });

  it('Should return true if dnsIps is different', () => {
    newConfig.dnsIps = '8.8.4.4';
    const res = needToUpdatedDevices(app, oldConfig, newConfig);
    expect(res).toBe(true);
  });

  it('Should return true if dnsDomains is different', () => {
    newConfig.dnsDomains = 'local2.dns';
    const res = needToUpdatedDevices(app, oldConfig, newConfig);
    expect(res).toBe(true);
  });

  it('Should return true if routeAllTraffic is different', () => {
    newConfig.routeAllTrafficOverVpn = true;
    const res = needToUpdatedDevices(app, oldConfig, newConfig);
    expect(res).toBe(true);
  });
});
