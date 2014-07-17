"use strict";

var q = require('q'),
    BuildPayload = require('../payloads/build').BuildPayload,
    PublisherPayload = require('../payloads/publisher').PublisherPayload;

/**
 * @param {Object} buildPayload
 */
function validateBuildPayload(buildPayload) {
  new BuildPayload(buildPayload).validate();
  return buildPayload;
}

/**
 * @param {Object} publisherPayload
 */
function validatePublisherPayload(publisherPayload) {
  new PublisherPayload(publisherPayload).validate();
  return publisherPayload;
}

/**
 * Set the message to publish based on the
 * status of the payload
 *
 * @param {Object} buildPayload
 */
function setStatusMessage(buildPayload) {
  switch (buildPayload.status) {
    case 'queued':
      buildPayload.message = 'Build Queued.';
      break;
    case 'building':
      buildPayload.message = 'Building...';
      break;
    case 'success':
      buildPayload.message = 'Singularity Build Succeeded.';
      break;
    case 'failure':
      buildPayload.message = 'Build Failed.';
      break;
    case 'error':
      buildPayload.message = 'Error Building.';
      break;
    default:
      // TODO: throw error
      break;
  }

  return q(buildPayload);
}

function publishStatus(buildPayload) {
  return q(buildPayload)
  .then(this.createStatus.bind(this));
}

module.exports = require('./adapter').extend({
  name: 'publisher',
  pluginType: 'publishers',

  createStatus: function(payload) {

    this.debug('creating status for', this.logForObject(payload));

    return q(payload)
    .then(validateBuildPayload)
    .then(setStatusMessage)
    .then(function(buildPayload) {
      return this.executeInPlugins(publishStatus, payload);
    }.bind(this))
    .then(function(publisherPayloads) {
      var promises = [];

      publisherPayloads.forEach(function(payload) {
        promises.push(q(payload)
        .then(validatePublisherPayload)
        .thenResolve(payload)
        .then(this.publishPayload.bind(this)));
      }, this);

      return promises;
    }.bind(this))
    .allSettled()
    .then(function(results) {
      results.forEach(function(result) {
        if (result.state !== "fulfilled") {
          throw result.reason;
        }
      });
    });
  }
});
