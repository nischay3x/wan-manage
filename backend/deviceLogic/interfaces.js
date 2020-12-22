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

const { isIPv4Address } = require('./validators');
const Joi = require('@hapi/joi');

/**
 * Builds collection of interfaces to be sent to device
 *
 * @param {*} deviceInterfaces interfaces stored in db
 * @returns array of interfaces
 */
const buildInterfaces = (deviceInterfaces) => {
  const interfaces = [];
  for (const ifc of deviceInterfaces) {
    // Skip unassigned/un-typed interfaces, as they
    // cannot be part of the device configuration
    if (!ifc.isAssigned || ifc.type.toLowerCase() === 'none') continue;

    const {
      devId,
      IPv4,
      IPv6,
      IPv4Mask,
      IPv6Mask,
      PublicIP,
      PublicPort,
      useStun,
      monitorInternet,
      routing,
      type,
      pathlabels,
      gateway,
      metric,
      dhcp,
      deviceType,
      configuration,
      deviceParams
    } = ifc;
    // Non-DIA interfaces should not be
    // sent to the device
    const labels = pathlabels.filter(
      (label) => label.type === 'DIA'
    );
    // Skip interfaces with invalid IPv4 addresses.
    // Currently we allow empty IPv6 address
    if (dhcp !== 'yes' && !isIPv4Address(IPv4, IPv4Mask) && deviceType !== 'wifi') continue;

    const ifcInfo = {
      devId: devId,
      dhcp: dhcp || 'no',
      addr: `${(IPv4 && IPv4Mask ? `${IPv4}/${IPv4Mask}` : '')}`,
      addr6: `${(IPv6 && IPv6Mask ? `${IPv6}/${IPv6Mask}` : '')}`,
      routing,
      type,
      multilink: { labels: labels.map((label) => label._id.toString()) },
      deviceType,
      configuration,
      deviceParams
    };
    if (ifc.type === 'WAN') {
      ifcInfo.gateway = gateway;
      ifcInfo.metric = metric;
      ifcInfo.PublicIP = PublicIP;
      ifcInfo.PublicPort = PublicPort;
      ifcInfo.useStun = useStun;
      ifcInfo.monitorInternet = monitorInternet;
    }
    interfaces.push(ifcInfo);
  }

  return interfaces;
};

const lteConfigurationSchema = Joi.object().keys({
  apn: Joi.string().required(),
  auth: Joi.string().valid('MSCHAPV2', 'PAP', 'CHAP').allow(null, ''),
  user: Joi.string().allow(null, ''),
  password: Joi.string().allow(null, '')
});
// wifiChannels
const shared = {
  ssid: Joi.string().required(),
  enable: Joi.boolean().required(),
  password: Joi.alternatives().when('securityMode', {
    is: 'wep',
    then: Joi.string()
      .regex(/^([a-z0-9]{5}|[a-z0-9]{13}|[a-z0-9]{16})$/)
      .error(() => 'Password length must be 5, 13 or 16'),
    otherwise: Joi.string().min(8)
  }).required(),
  operationMode: Joi.string().required().valid('b', 'g', 'n', 'a', 'ac'),
  channel: Joi.string().regex(/^\d+$/).required(),
  bandwidth: Joi.string().valid('20', '40').required(),
  securityMode: Joi.string().valid(
    'open', 'wpa-psk', 'wpa2-psk', 'wpa-eap', 'wpa2-eap'
  ).required(),
  hideSsid: Joi.boolean().required(),
  encryption: Joi.string().valid('aes-ccmp').required(),
  region: Joi.string()
};

const WifiConfigurationSchema = Joi.alternatives().try(
  Joi.object().keys({ '2.4GHz': Joi.object().keys(shared) }),
  Joi.object().keys({ '5GHz': Joi.object().keys(shared) }),
  Joi.object().keys({ '5GHz': Joi.object().keys(shared), '2.4GHz': Joi.object().keys(shared) })
);

/**
 * Validate dynamic configuration object for different types of interfaces
 *
 * @param {*} deviceInterfaces interfaces stored in db
 * @param {*} configurationReq configuration request to save
 * @returns array of interfaces
 */
const validateConfiguration = (deviceInterfaces, configurationReq) => {
  const interfacesTypes = {
    lte: lteConfigurationSchema,
    wifi: WifiConfigurationSchema
  };

  const intType = deviceInterfaces.deviceType;

  if (interfacesTypes[intType]) {
    const result = interfacesTypes[intType].validate(configurationReq);

    if (result.error) {
      return {
        valid: false,
        err: `${result.error.details[result.error.details.length - 1].message}`
      };
    }

    return { valid: true, err: '' };
  }

  return { valid: false, err: 'You can\'t save configuration for this interface' };
};

const lteOperationSchema = Joi.object().keys({
  op: Joi.string().valid('connect', 'disconnect', 'reset').required(),
  params: Joi.alternatives().when('op', {
    is: 'connect',
    then: Joi.object({
      apn: Joi.string().required().error(() => 'Can\'t start network without an apn')
    }).required(),
    otherwise: Joi.optional()
  })
});

const wifiOperationSchema = Joi.object().keys({
  op: Joi.string().valid('start', 'stop').required(),
  params: Joi.object().required()
});

/**
 * Validate dynamic operation object for different types of interfaces
 *
 * @param {*} deviceInterfaces interfaces stored in db
 * @param {*} configurationReq configuration request to save
 * @returns array of interfaces
 */
const validateOperations = (deviceInterfaces, operationReq) => {
  const interfacesTypes = {
    lte: lteOperationSchema,
    wifi: wifiOperationSchema
  };

  const intType = deviceInterfaces.deviceType;

  if (interfacesTypes[intType]) {
    const result = interfacesTypes[intType].validate(operationReq);

    if (result.error) {
      return { valid: false, err: `${result.error.details[0].message}` };
    }

    if (intType === 'wifi') {
      const configuration = operationReq.params.configuration;
      const isBand2Enabled = configuration['2.4GHz'] && configuration['2.4GHz'].enable;
      const isBand5Enabled = configuration['5GHz'] && configuration['5GHz'].enable;

      if (isBand2Enabled && isBand5Enabled) {
        return {
          valid: false,
          err: 'You can\'t enabled two bands at the same time. Please enable one of them'
        };
      }
    }

    return { valid: true, err: '' };
  }

  return { valid: false, err: 'You can\'t perform requested operation for this interface' };
};

const getOldInterfaceIdentification = devId => {
  if (devId && devId.startsWith('pci:')) {
    const splitted = devId.split(':');
    splitted.shift();
    return splitted.join(':');
  }

  return null;
};

module.exports = {
  buildInterfaces,
  validateConfiguration,
  validateOperations,
  getOldInterfaceIdentification
};
