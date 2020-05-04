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
const { concat, find } = require('lodash');

// ! TODO: Unit tests

/**
 * Rules Database Schema (TBD)
 */
const rulesSchema = new Schema({
  // Rule id
  _id: {
    type: Schema.Types.ObjectId,
    required: true
  },
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
  rules: [rulesSchema],
  // Is application modifed
  modified: {
    type: Boolean
  }
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
  applications: [applicationSchema],
  imported: [applicationSchema]
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
 * @param {*} orgList Organization filter
 * @returns applications + metadata
 */
const getAllApplications = async (orgList) => {
  const projection = {
    updatedAt: 1,
    'applications.id': 1,
    'applications.name': 1,
    'applications.description': 1,
    'applications.category': 1,
    'applications.serviceClass': 1,
    'applications.importance': 1,
    'applications.rules._id': 1,
    'applications.rules.protocol': 1,
    'applications.rules.ports': 1,
    'applications.rules.ip': 1,
    // not part of the imported, so maybe split projections?
    'imported.id': 1,
    'imported.category': 1,
    'imported.serviceClass': 1,
    'imported.importance': 1
  };
  // it is expected that custom applications are stored as single document per
  // organization in the collection
  const customApplicationsResult =
    await applications.findOne({ 'meta.org': { $in: orgList } }, projection);
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
      : importedApplicationsResult.applications
        .map(item => { item.modified = false; return item; });

  if (customApplicationsResult.imported) {
    customApplicationsResult.imported.forEach(item => {
      const oldApplication = find(importedApplications, { id: item.id });
      oldApplication.modified = true;
      oldApplication.category = item.category;
      oldApplication.serviceClass = item.serviceClass;
      oldApplication.importance = item.importance;
    });
  }

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

  const modifiedImportedProjection = {
    'imported.id': 1,
    'imported.category': 1,
    'imported.serviceClass': 1,
    'imported.importance': 1
  };

  // it is expected that imported applications are stored as single document
  // in the collection
  const importedApplicationsResult =
    await importedapplications.findOne({}, projection);
  const importedApplications =
    (importedApplicationsResult === null || importedApplicationsResult.applications === null)
      ? []
      : importedApplicationsResult.applications;

  const importedApplicationResult = importedApplications.find(item => item.id === id);
  if (importedApplicationResult) {
    const modifiedImportedApplicationsResult =
      await applications.findOne({ 'meta.org': { $in: org } }, modifiedImportedProjection);
    if (modifiedImportedApplicationsResult) {
      const modifiedImportedApplicationResult =
        modifiedImportedApplicationsResult.imported.find(item => item.id === id);
      if (modifiedImportedApplicationResult) {
        importedApplicationResult.category = modifiedImportedApplicationResult.category;
        importedApplicationResult.serviceClass = modifiedImportedApplicationResult.serviceClass;
        importedApplicationResult.importance = modifiedImportedApplicationResult.importance;
      }

      return importedApplicationResult;
    }
  }

  return null;
};

/**
 * Get last update time for application list for an organization
 * @param {Array} orgList - org ID to get
 */
const getApplicationUpdateAt = async (orgList) => {
  // Get updated at value
  const projection = {
    updatedAt: 1
  };
  const customApplicationsResult =
    await applications.findOne({ 'meta.org': { $in: orgList } }, projection);
  const importedApplicationsResult =
    await importedapplications.findOne({}, projection);

  return (
    {
      customUpdatedAt: customApplicationsResult === null
        ? ''
        : customApplicationsResult.updatedAt,
      importedUpdatedAt: importedApplicationsResult === null
        ? ''
        : importedApplicationsResult.updatedAt
    }
  );
};

// Default exports
module.exports =
{
  applicationsSchema,
  getAllApplications,
  getApplicationUpdateAt,
  getApplicationById,
  applications,
  importedapplications,
  rules: mongoConns.getMainDB().model('rules', rulesSchema)
};
