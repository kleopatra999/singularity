"use strict";

var ReadWriteLock = require('rwlock'),
    fs = require('fs'),
    lock = new ReadWriteLock(),
    q = require('q');

function validateConfigMeta(meta) {
  return q.all(
    ['adapter', 'plugin', 'config'].map(function(field) {
      if (!meta[field]) {
        throw 'meta missing ' + field;
      }
      return field;
    })
  );
}

function writeConfig(configMeta) {
  return q(configMeta)
  .then(validateConfigMeta)
  .then(function() {
    this.lock.writeLock(function(release) {
      var adapter = configMeta.adapter,
          plugin = configMeta.plugin,
          writeLoc = this.config.cacheConfig || 'config.json.cache';
      this.config[adapter][plugin] = configMeta.config;
      this.fs.writeFileSync(writeLoc, JSON.stringify(this.config));
      this.debug(
        'wrote cfg to ' + writeLoc,
        { adapter: adapter, plugin: plugin }
      );
      release();
    }.bind(this));
  }.bind(this))
  .catch(this.error)
  .done();
}

module.exports = require('./core_component').extend({
  fs: null,
  lock: null,
  name: 'configuration',

  init: function(configs) {
    configs = configs || {};
    this._super(configs);
    this.config = JSON.parse(JSON.stringify(configs));
    this.lock = lock;
    this.fs = fs;
    this._registerTrigger('config', 'updates', writeConfig.bind(this));
  }
});
