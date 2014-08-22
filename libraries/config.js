"use strict";

var ReadWriteLock = require('rwlock'),
    fs = require('fs'),
    lock = new ReadWriteLock();

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
      this.fs.writeSync(writeLoc, JSON.stringify(this.config));
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
    this._super(configs);
    this.config = configs;
    this.lock = lock;
    this.fs = fs;
    this._registerTrigger('config', 'update', writeConfig.bind(this));
  }
});

module.exports.defaults = function() {
  return {
    port: 8080,
    log: {
      console: {
        level: 'info',
        colorize: false
      }
    },
    build: {
      plugin: 'jenkins',
      jenkins: {
        protocol: 'http',
        host: 'localhost:8080',
        auth: {
          user: 'jenkins',
          password: 'password',
          project_token: 'token'
        },
        projects: []
      }
    },
    db: {},
    vcs: {
      plugin: 'github',
      github: {
        ignore_statuses: false,
        auth: {
          token: false,
          type: 'oauth',
          username: ''
        },
        repos: []
      }
    },
    publisher: {
      plugin: 'github',
      github: {
        auth: {
          token: false,
          type: 'oauth',
          username: ''
        }
      }
    },
    cache: {
      max: 64,
      maxAge: 60 * 1000
    }
  };
}
