"use strict";

var Db = require('../libraries/adapters/db'),
    plugin;

module.exports = plugin = {
  name: 'Database',

  attach: function(options) {
    this.db = new Db(options);
    this.db.log = this.log.get('console');
    this.db.registerDefaultTriggers();
    this.db.attachConfigPlugins();
  },

  init: function(done) { done(); }
};
