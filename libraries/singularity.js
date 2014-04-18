var Logger = require('./log'),
    fs = require('fs'),
    path = require('path'),
    express = require('express');

module.exports = function(config) {

  var app = express();
  app.log = Logger(config.log_level || 'debug');
  app.listeners = [];

  app.loadListeners = function(directories) {
    if (!Array.isArray(directories)) {
      throw new Error('directories must be array');
    }

    directories.forEach(function(dir) {
      fs.readdir(dir, function(err, files) {
        if (err) {
          app.log.error(err);
          process.exit(1);
        }

        if (!config.plugins) {
          app.log.info('No plugin configurations found');
          process.exit(0);
        }

        for (var i = 0, l = files.length; i < l; i++) {
          var filename = path.join(dir, files[i]),
              pluginName = files[i].split('.', 2)[0];

          if (!filename.match(/\.js$/)) {
            continue;
          }

          if (!config.plugins[pluginName]) {
            app.log.info('No configuration for ' + pluginName + ', not loading');
            continue;
          }

          var pluginEnabled = config.plugins[pluginName].enabled;

          if (pluginEnabled == undefined || pluginEnabled) {
            app.log.info('Loading plugin: ' + pluginName);
            app.listeners.push(require(filename).init(config.plugins[pluginName], app));
          }
          else {
            app.log.info('Not loading disabled plugin ' + pluginName);
          }
        }
      });
    });
  };

  return app;
};