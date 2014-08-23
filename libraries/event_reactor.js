"use strict";

var postal = require('postal'),
    stackTrace = require('stack-trace');

module.exports = require('./vent').extend({
  // where this object publishes to by default
  channel: undefined,

  /**
   * {@inheritDoc}
   * @param {Object} option Configuration
   */
  init: function(option) {
    this._super(option);
    this.publishPayload = this.publishPayload.bind(this);
    this.setChannel = this.setChannel.bind(this);
    this.postal = postal;
    this._registerTrigger = this._registerTrigger.bind(this);
  },

  setChannel: function(channelName) {
    this.channel = postal.channel(channelName);
  },

  publishToChannel: function(payload, channel, subject) {
    var trace = stackTrace.get();
    postal.publish({channel: channel, topic: subject, data: payload});
    this.debug(
      'published event',
      {
          channel: channel,
          topic: subject,
          origin: trace[1].getFileName() + ':' + trace[1].getLineNumber()
      }
    );
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
    this.debug('published internal event', this.logForObject(payload));
    this.channel.publish(payload.type, payload);
  },

  _registerTrigger: function(channel, subject, callback) {
    var trace = stackTrace.get();
    postal.subscribe({channel: channel, topic: subject, callback: callback});
    this.debug(
      'registered trigger',
      {
          channel: channel,
          topic: subject,
          origin: trace[1].getFileName() + ':' + trace[1].getLineNumber()
      }
    );
  }
});
