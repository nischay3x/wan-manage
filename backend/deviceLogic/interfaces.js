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

const WifiConfigurationSchema = Joi.object().keys({
  ssid: Joi.string().required(),
  password: Joi.string().required().min(8),
  operationMode: Joi.string().required().valid('b', 'g', 'n'),
  channel: Joi.string().regex(/^\d+$/).required(),
  bandwidth: Joi.string().valid('20', '40').required(),
  securityMode: Joi.string().valid('wpa').required(),
  broadcastSsid: Joi.boolean().required()
});

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
      return { valid: false, err: `${result.error.details[0].message}` };
    }

    return { valid: true, err: '' };
  }

  return { valid: false, err: 'You can\'t save configuration for this interface' };
};

const lteOperationSchema = Joi.object().keys({
  op: Joi.string().valid('connect', 'disconnect')
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
    lte: lteOperationSchema
  };

  const intType = deviceInterfaces.deviceType;

  if (interfacesTypes[intType]) {
    const result = interfacesTypes[intType].validate(operationReq);

    if (result.error) {
      return { valid: false, err: `${result.error.details[0].message}` };
    }

    return { valid: true, err: '' };
  }

  return { valid: false, err: 'You can\'t perform requested operation for this interface' };
};

module.exports = {
  buildInterfaces,
  validateConfiguration,
  validateOperations
};
