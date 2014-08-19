"use strict";

var Publisher = require('../libraries/adapters/publisher'),
    plugin;

module.exports = plugin = {
  name: 'Publisher',

  attach: function(options) {
    this.publisher = new Publisher(options);
    this.publisher.log = this.log.get('console');
    this.publisher.attachConfigPlugins();
  },

  init: function(done) { done(); }
};
