"use strict";

var q = require('q'),
    VcsPayload = require('../payloads/vcs').VcsPayload,
    BuildPayload = require('../payloads/build').BuildPayload,
    validateBuildPayload,
    validateVcsPayload;

/**
 * @param {Object} buildPayload
 * @return {Object} buildPayload
 */
function validateBuildPayload(buildPayload) {
  new BuildPayload(buildPayload).validate();
  return buildPayload;
}

/**
 * @param {Array} payloads array of build payloads
 * @return {Array} buildPayload
 */
function validateBuildPayloads(payloads) {
  return payloads.map(function(buildRes) {
    validateBuildPayload(buildRes);
    return buildRes;
  });
}

/**
 * @param {Object} vcsPayload
 * @return {Object} vcsPayload
 */
function validateVcsPayload(vcsPayload) {
  new VcsPayload(vcsPayload).validate();
  return vcsPayload;
}

/**
 * MUST BIND `this`
 * Plugin workflow to handle httpPayloads coming from build systems
 * signaling state changes for builds
 *
 * @param {Object} httpPayload
 * @param {Promise}
 */
function buildUpdate(httpPayload) {
  return q(httpPayload)
  .then(this.validateBuildUpdate.bind(this))
  .then(this.createUpdatePayload.bind(this))
  .then(validateBuildPayload);
}

/**
 * MUST BIND `this`
 * Plugin workflow function to be bound to a plugin, returns a buildPayload
 * Triggers a build for a change, returns a build payload
 *
 * @param {Object} vcsPayload change payload (vcs payload)
 * @return {Promise} Resolves with a build payload
 */
function buildChangePayload(vcsPayload) {
  return q(vcsPayload)
  .then(validateVcsPayload)
  .then(this.validateChange.bind(this))
  .then(this.buildChange.bind(this))
  .then(validateBuildPayloads);
}

/**
 * MUST BIND `this`
 * Plugin workflow function to be bound to a plugin
 * Triggers a build for a proposal, returns a build payload
 *
 * @param {Object} vcsPayload proposal payload (vcs payload)
 * @return {Promise} Resolves with a build payload
 */
function buildProposalPayload(vcsPayload) {
  return q(vcsPayload)
  .then(validateVcsPayload)
  .then(this.validateProposal.bind(this))
  .then(this.buildProposal.bind(this))
  .then(validateBuildPayloads);
}

/**
 * MUST BIND `this`
 * Executes a given build plugin workflow (function to be executed in context of
 * plugin) given a Payload
 *
 * @param {Function} workflow Function to execute in context of plugins
 * @param {Object} payload either a change or proposal payload (vcs payload)
 * @return {Promise} Resolving with results of publishing the build payloads
 */
function executeAndPublish(workflow, payload) {
  this.debug(
    'request for build adapter received',
     this.logForObject(payload)
  );
  return this.executeInPlugins(workflow, payload)
  .then(function(pluginResults) {
    pluginResults.filter(function(result) {
      return !!result;
    })
    .forEach(function(buildResults) {
      // VCS workflows can potentially trigger multiple build systems
      // which is why they return arrays of buildPayloads
      // buildStatus updates however, should only return a single response
      // per build plugin (for the time being at least), which is why this
      // check is here
      if (!Array.isArray(buildResults)) {
        buildResults = [buildResults];
      }

      buildResults.forEach(function(buildPayload) {
        this.publishPayload(buildPayload);
      }, this);
    }.bind(this));
  }.bind(this));
}

/**
 * @module adapters/build
 */
module.exports = require('./adapter').extend({
  name: 'build',
  pluginType: 'builders',

  buildChange: function(changePayload) {
    executeAndPublish.call(this, buildChangePayload, changePayload);
  },

  buildProposal: function(proposalPayload) {
    executeAndPublish.call(this, buildProposalPayload, proposalPayload);
  },

  handleBuildUpdate: function(httpPayload) {
    executeAndPublish.call(this, buildUpdate, httpPayload);
  }
});
