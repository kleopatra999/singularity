"use strict";

var postal = require('postal');

// vent: something turns a bunch of knobs
// ...and things just keep coming out
// ...of all the...holes...? :|
module.exports = require('nbd/Class').extend({
  name: 'unnamed-vent',
  channel: undefined,

  setChannel: function(channelName) {
    this.channel = postal.channel(channelName);
  },

  publish: function(topic, data) {
    if (!this.channel) {
      this.error('cannot publish topic, no channel', {topic: topic, vent: this.name});
      return;
    }
    this.channel.publish(topic, data);
  },

  init: function(option) {
    this.config = option;
    this.error = this.error.bind(this);
  },

  error: function() {
    this.log.error.apply(this.log, Array.prototype.slice.call(arguments));
  }
});
