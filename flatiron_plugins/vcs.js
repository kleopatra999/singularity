"use strict";

var plugin,
    Vcs = require('../libraries/adapters/vcs');

module.exports = plugin = {
  name: 'VCS',

  attach: function(options) {
    this.vcs = new Vcs(options);
    this.vcs.log = this.log.get('console');
    this.vcs.attachConfigPlugins();
  },

  init: function(done) { done(); }
};
