"use strict";

var BuildSys = require('../libraries/build'),
plugin;

module.exports = plugin = {
  name: 'Build System',

  attach: function(options) {
    this.build = new BuildSys(options);
    this.build.log = this.log.get('console');
  },

  init: function(done) {
    this.build.start();
    done();
  }
};
