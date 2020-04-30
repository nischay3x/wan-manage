// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const mongoConns = require('../mongoConns.js')();
const concat = require('lodash/concat');

// ! TODO: Unit tests

/**
 * Rules Database Schema (TBD)
 */
const rulesSchema = new Schema({
  // IP
  // TODO: add validator
  ip: {
    type: String,
    required: false
  },
  // Ports
  // TODO: add validator
  ports: {
    type: String,
    required: false
  },
  // Protocol
  protocol: {
    type: String,
    enum: ['tcp', 'udp', ''],
    required: false
  }
});

/**
 * Application Database Default Schema (TBD)
 * Main difference from the main schema - not tied to organization
 */
const applicationSchema = new Schema({
  // Application id
  id: {
    type: String,
    required: true
  },
  // Application name
  name: {
    type: String,
    required: true,
    maxlength: [30, 'Application name must be at most 30']
  },
  // Category name
  category: {
    type: String,
    required: true,
    maxlength: [20, 'Category must be at most 20']
  },
  // Service Class name
  serviceClass: {
    type: String,
    required: true,
    maxlength: [20, 'Service Class must be at most 20']
  },
  // Importance
  importance: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true
  },
  // Description
  description: {
    type: String,
    maxlength: [128, 'Description must be at most 128']
  },
  // List of rules
  rules: [rulesSchema]
}, {
  timestamps: true
});

const metaSchema = new Schema({
  // Update timw
  time: {
    type: Number
  },
  // Organization
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations'
  }
});

/**
 * Application Database Schema (TBD)
 */
const applicationsSchema = new Schema({
  // meta
  meta: {
    type: metaSchema,
    required: true
  },
  applications: [applicationSchema]
}, {
  timestamps: true
});

// indexing
applicationsSchema.index({ name: 1, org: 1 }, { unique: true });

const applications =
  mongoConns.getMainDB().model('applications', applicationsSchema);
const importedapplications =
  mongoConns.getMainDB().model('importedapplications', applicationsSchema);

/**
 * Gets the combined list of custom and imported applications as well
 * as the meta data containging times of last updates in both collections.
 *
 * @param {*} org Organization filter
 * @returns applications + metadata
 */
const getAllApplications = async (org) => {
  const projection = {
    updatedAt: 1,
    'applications.id': 1,
    'applications.name': 1,
    'applications.description': 1,
    'applications.category': 1,
    'applications.serviceClass': 1,
    'applications.importance': 1,
    'applications.rules.id': 1,
    'applications.rules.protocol': 1,
    'applications.rules.ports': 1,
    'applications.rules.ip': 1
  };
  // it is expected that custom applications are stored as single document per
  // organization in the collection
  const customApplicationsResult =
    await applications.findOne({ 'meta.org': { $in: org } }, projection);
  const customApplications =
    (customApplicationsResult === null || customApplicationsResult.applications === null)
      ? []
      : customApplicationsResult.applications;

  // it is expected that imported applications are stored as single document
  // in the collection
  const importedApplicationsResult =
    await importedapplications.findOne({}, projection);
  const importedApplications =
    (importedApplicationsResult === null || importedApplicationsResult.applications === null)
      ? []
      : importedApplicationsResult.applications;

  return {
    applications: concat(customApplications, importedApplications),
    meta: {
      customUpdatedAt: customApplicationsResult === null
        ? ''
        : customApplicationsResult.updatedAt,
      importedUpdatedAt: importedApplicationsResult === null
        ? ''
        : importedApplicationsResult.updatedAt
    }
  };
};

/**
 * Gets the combined list of custom and imported applications as well
 * as the meta data containging times of last updates in both collections.
 *
 * @param {*} org Organization filter
 * @returns applications + metadata
 */
const getApplicationById = async (org, id) => {
  const projection = {
    updatedAt: 1,
    'applications.id': 1,
    'applications.name': 1,
    'applications.description': 1,
    'applications.category': 1,
    'applications.serviceClass': 1,
    'applications.importance': 1,
    'applications.rules.id': 1,
    'applications.rules.protocol': 1,
    'applications.rules.ports': 1,
    'applications.rules.ip': 1
  };
  // it is expected that custom applications are stored as single document per
  // organization in the collection
  // const customApplicationsResult =
  //   await applications.findOne({ 'meta.org': { $in: org } }, projection);
  // const customApplications =
  //   (customApplicationsResult === null || customApplicationsResult.applications === null)
  //     ? []
  //     : customApplicationsResult.applications;

  // it is expected that imported applications are stored as single document
  // in the collection
  const importedApplicationsResult =
    await importedapplications.findOne({}, projection);
  const importedApplications =
    (importedApplicationsResult === null || importedApplicationsResult.applications === null)
      ? []
      : importedApplicationsResult.applications;

  return importedApplications.find(item => item.id === id);
};

// Default exports
module.exports =
{
  applicationsSchema,
  getAllApplications,
  getApplicationById,
  applications: mongoConns.getMainDB().model('applications', applicationsSchema),
  rules: mongoConns.getMainDB().model('rules', rulesSchema)
};
