"use strict";

var postal = require('postal');

module.exports = require('./vent').extend({
  channel: undefined,

  /**
   * {@inheritDoc}
   * @param {Object} option Configuration
   */
  init: function(option) {
    this._super(option);
    this.publishPayload = this.publishPayload.bind(this);
    this.setChannel = this.setChannel.bind(this);
  },

  setChannel: function(channelName) {
    this.channel = postal.channel(channelName);
  },

  publishPayload: function(payload) {
    if (!payload) {
      this.debug('no payload given, ignoring');
      return;
    }
    if (!payload.type) {
      this.debug('payload has no type!', payload);
      return;
    }
    this.debug('publishing', this.logForObject(payload));
    this.channel.publish(payload.type, payload);
  }
});
