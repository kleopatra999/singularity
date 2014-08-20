"use strict";

module.exports = require('../vent').extend({
  // **SHOULD** be swapped out with the adapter.name that this plugin
  // is attached to
  objectType: 'plugin',

  removeConfig: function(httpPayload) {
    this.debug('not set up to remove config', this.logForObject(httpPayload));
  },

  addConfig: function(httpPayload) {
    this.debug('not set up to add config', this.logForObject(httpPayload));
  },

  updateConfig: function(httpPayload) {
    this.debug('not set up to update config', this.logForObject(httpPayload));
  }
});
