var EventMapper = require('./event_mapper'),
    Receiver = require('./receiver'),
    q = require('q'),
    app = require('flatiron').app,
    fs = require('fs'),
    path = require('path');

/**
 * Generates flatiron plugin name from a filename
 *
 * @param {String} file
 * @return {Promise} string
 */
function pluginNameFromFile(file) {
  var defer = q.defer();
  defer.resolve(file.substring(0, file.lastIndexOf('.')));
  return defer.promise;
}

/**
 * Validates a flatiron plugin file
 *
 * @param {String} file
 * @return {Promise} file
 */
function checkPluginFile(file) {
  var defer = q.defer();
  if (!file.match(/\.js$/)) {
    throw file + ' **PLUGIN FILE NOT VALID**';
  }
  defer.resolve(file);
  return defer.promise;
}

/**
 * Retrieves flatiron plugin config
 *
 * @param {String} name
 * @return {Promise} Resolves with plugin cfg if found
 */
function pluginConfig(name) {
  var defer = q.defer(),
  cfg = app.config.get(name);
  if (cfg && cfg.disabled) {
    defer.reject(name + ' is disabled');
  }
  else if (cfg) {
    defer.resolve(cfg);
  }
  else {
    defer.reject('Singularity: no config found for adapter=' + name);
  }
  return defer.promise;
}

/**
 * Injects flatiron plugin into app
 *
 * @param {String} file path to file
 * @param {Object} cfg cfg for given plugin
 */
function appUsePlugin(file, cfg) {
  app.use(require(file), cfg);
}

var Singularity = require('nbd/Class').extend({
  init: function() {
    app.config.defaults(require('./config'));
    app.init();
    this.log = app.log.get('console');
    this.eventMapper = new EventMapper();
    this.receiver = new Receiver();
  },

  route: function(routes) {
    if (routes == null) { return; }
    if (!Array.isArray(routes)) { return; }

    routes.forEach(function(meta) {
      var pathRoutes = meta.routes;
      if (!Array.isArray(pathRoutes)) {
        pathRoutes = [pathRoutes];
      }
      pathRoutes.forEach(function(route) {
        this.receiver.buildRoutes(
          meta.path,
          route,
          this.eventMapper
        );
      }, this);
    }, this);
  },

  mapTriggers: function(triggers) {
    triggers.forEach(function(trigger) {
      this.eventMapper.addTrigger(trigger);
    }, this);
  },

  injectFlatironPlugins: function(dir) {
    return q.ninvoke(fs, 'readdir', dir)
    .then(function(files) {
      files.forEach(function(file) {
        q.resolve(path.join(dir, file))
        .then(checkPluginFile)
        .thenResolve(
          q.all([
            path.join(dir, file),
            pluginNameFromFile(file)
          ])
        )
        .spread(function(path, name) {
          this.log.debug(
            '[flatiron_plugin.load]',
            {name: name, path: path}
          );
          return q.all([path, pluginConfig(name)]);
        }.bind(this))
        .spread(appUsePlugin)
        .catch(this.log.error.bind(this));
      }, this);
    }.bind(this))
    .done();
  }
});

module.exports = new Singularity();
