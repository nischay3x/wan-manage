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
const { isVpn, getSubnetForDevice } = require('../openvpn');
const { validateApplication } = require('../applications');

describe('validate vpn configuration', () => {
  const successObject = {
    valid: true,
    err: ''
  };
  const failureObject = {
    valid: false,
    err: ''
  };

  let app = null;
  let devicesIds = null;
  beforeEach(() => {
    app = {
      libraryApp: {
        name: 'Remote VPN'
      },
      configuration: {
        remoteClientIp: '192.168.0.0/24',
        connectionsPerDevice: 128,
        subnets: []
      }
    };

    devicesIds = [];
  });

  it('Should be an invalid configuration', () => {
    app.configuration = {};
    const result = validateApplication(app, 'deploy', devicesIds);
    failureObject.err = 'Required configurations is missing. Please check again the configurations';
    expect(result).toMatchObject(failureObject);
  });

  it('Should be an invalid because of there is no enough subnets for selected devices', () => {
    devicesIds = [
      ObjectId('5e65290fbe66a2335718e081'),
      ObjectId('5e65290fbe66a2335718e082'),
      ObjectId('5e65290fbe66a2335718e083')
    ];
    const result = validateApplication(app, 'deploy', devicesIds);
    failureObject.err = 'There are no remained subnets. Please check the configurations';
    expect(result).toMatchObject(failureObject);
  });

  it('Should be an invalid because of all the subnets are assigned', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e082');
    devicesIds = [deviceId];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/25',
        device: ObjectId('5e65290fbe66a2335718e081')
      },
      {
        subnet: '192.168.0.128/25',
        device: ObjectId('5e65290fbe66a2335718e083')
      }
    ];

    const result = validateApplication(app, 'deploy', devicesIds);
    failureObject.err = 'There are no remained subnets. Please check the configurations';
    expect(result).toMatchObject(failureObject);
  });

  it('Should be a valid configs if the device and one of the subnets are the same', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e083');
    devicesIds = [deviceId];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/25',
        device: ObjectId('5e65290fbe66a2335718e081')
      },
      {
        subnet: '192.168.0.128/25',
        device: ObjectId('5e65290fbe66a2335718e083')
      }
    ];

    const result = validateApplication(app, 'deploy', devicesIds);
    expect(result).toMatchObject(successObject);
  });

  it('Should be a valid configs if there is a free subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [ObjectId('5e65290fbe66a2335718e082')];
    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/25',
        device: deviceId
      }
    ];

    const result = validateApplication(app, 'deploy', devicesIds);
    expect(result).toMatchObject(successObject);
  });

  it('Should be a valid configs if the devices and the assigned subnets are the same', () => {
    const deviceA = ObjectId('5e65290fbe66a2335718e081');
    const deviceB = ObjectId('5e65290fbe66a2335718e082');
    devicesIds = [deviceA, deviceB];

    app.configuration.subnets = [
      {
        subnet: '192.168.0.0/25',
        device: deviceA
      },
      {
        subnet: '192.168.0.128/25',
        device: deviceB
      }
    ];

    const result = validateApplication(app, 'deploy', devicesIds);
    expect(result).toMatchObject(successObject);
  });

  it('Should be a valid configs', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    devicesIds = [
      deviceId,
      ObjectId('5e65290fbe66a2335718e082'),
      ObjectId('5e65290fbe66a2335718e083'),
      ObjectId('5e65290fbe66a2335718e084')
    ];

    app.configuration.remoteClientIp = '192.168.0.0/24';
    app.configuration.connectionsPerDevice = 64;

    app.configuration.subnets = [
      {
        subnet: '192.168.0.128/26',
        device: deviceId
      }
    ];

    const result = validateApplication(app, 'deploy', devicesIds);
    expect(result).toMatchObject(successObject);
  });

  it('Should return the assigned subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    app.configuration.subnets = [
      {
        device: deviceId,
        subnet: '192.168.0.0/25'
      }
    ];

    const result = getSubnetForDevice(app.configuration, deviceId.toString());
    expect(result).toMatchObject([app.configuration.subnets[0], 'exists']);
  });

  it('Should return the next free subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    app.configuration.subnets = [
      {
        device: ObjectId('5e65290fbe66a2335718e082'),
        subnet: '192.168.0.0/25'
      }
    ];

    const result = getSubnetForDevice(app.configuration, deviceId.toString());
    expect(result).toMatchObject([{ device: deviceId, subnet: '192.168.0.128/25' }, 'new']);
  });

  it('Should return the exists free subnet', () => {
    const deviceId = ObjectId('5e65290fbe66a2335718e081');
    app.configuration.subnets = [
      {
        device: ObjectId('5e65290fbe66a2335718e082'),
        subnet: '192.168.0.0/25'
      },
      {
        device: null,
        subnet: '192.168.0.128/25'
      }
    ];

    const result = getSubnetForDevice(app.configuration, deviceId.toString());
    expect(result).toMatchObject([{ device: deviceId, subnet: '192.168.0.128/25' }, 'update']);
  });
});

describe('validate vpn name', () => {
  it('Should be a valid vpn name', () => {
    const res = isVpn('Remote VPN');
    expect(res).toBe(true);
  });

  it('Should be an invalid vpn name', () => {
    const res = isVpn('Remote vpn');
    expect(res).toBe(false);
  });
});
