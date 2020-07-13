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

const { ObjectId } = require('mongoose').Types;
const {
  isVpn,
  appsValidations,
  getDeviceSubnet
} = require('../validators');

describe('validate vpn configuration', () => {
  let app = null;
  let devicesIds = null;
  beforeEach(() => {
    app = {
      libraryApp: {
        name: 'Open VPN'
      },
      configuration: {
        remoteClientIp: '192.168.0.0/24',
        connectionsPerDevice: 128,
        subnets: [
          {
            subnet: '192.168.0.0/25',
            device: null
          },
          {
            subnet: '192.168.0.128/25',
            device: null
          }
        ]
      }
    };

    devicesIds = [];
  });

  it('Should be an invalid configuration', () => {
    app.configuration = {};

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).toThrow(
      new Error('Required configurations is missing, please check again the configurations')
    );
  });

  it('Should be an invalid because of there is no subnets', () => {
    app.configuration.subnets = [];
    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).toThrow(
      new Error('There is no subnets remaining, please check again the configurations')
    );
  });

  it('Should be a valid configs if is one device and one subnet and both is the same', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [deviceId];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/24',
        device: deviceId
      }
    ];

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).not.toThrow();
  });

  it('Should be an invalid configs if there is no subnets remaining', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [deviceId];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/24',
        device: ObjectId('5e65290fbe66a2335718e082')
      }
    ];

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).toThrow(
      new Error('There is no subnets remaining, please check again the configurations')
    );
  });

  it('Should be a valid configs if there is a free subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [ObjectId('5e65290fbe66a2335718e082')];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/25',
        device: deviceId
      },
      {
        subnet: '192.168.0.128/25',
        device: null
      }
    ];

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).not.toThrow();
  });

  it('Should be an invalid configs if there is no subnets remaining', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [
      deviceId,
      ObjectId('5e65290fbe66a2335718e082'),
      ObjectId('5e65290fbe66a2335718e083'),
      ObjectId('5e65290fbe66a2335718e084'),
      ObjectId('5e65290fbe66a2335718e085'),
      ObjectId('5e65290fbe66a2335718e086')
    ];

    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/26',
        device: deviceId
      },
      {
        subnet: '192.168.0.64/26',
        device: null
      },
      {
        subnet: '192.168.0.128/26',
        device: null
      },
      {
        subnet: '192.168.0.192/26',
        device: null
      }
    ];

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).toThrow(
      new Error('There is no subnets remaining, please check again the configurations')
    );
  });

  it('Should be a valid configs', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [
      deviceId,
      ObjectId('5e65290fbe66a2335718e082'),
      ObjectId('5e65290fbe66a2335718e083'),
      ObjectId('5e65290fbe66a2335718e084')
    ];

    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/26',
        device: null
      },
      {
        subnet: '192.168.0.64/26',
        device: null
      },
      {
        subnet: '192.168.0.128/26',
        device: deviceId
      },
      {
        subnet: '192.168.0.192/26',
        device: null
      }
    ];

    expect(() => {
      appsValidations(app, 'deploy', devicesIds);
    }).not.toThrow();
  });

  it('Should return the assigned subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    app.configuration.subnets[0].device = deviceId;
    const subnet = getDeviceSubnet(app.configuration.subnets, deviceId.toString());
    expect(subnet).toMatchObject(app.configuration.subnets[0]);
  });

  it('Should return the free subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    app.configuration.subnets[0].device = ObjectId('5e65290fbe66a2335718e082');
    const subnet = getDeviceSubnet(app.configuration.subnets, deviceId.toString());
    expect(subnet).toMatchObject(app.configuration.subnets[1]);
  });
});

describe('validate vpn name', () => {
  it('Should be a valid vpn name', () => {
    const res = isVpn('Open VPN');
    expect(res).toBe(true);
  });

  it('Should be an invalid vpn name', () => {
    const res = isVpn('Open vpn');
    expect(res).toBe(false);
  });
});
