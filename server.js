"use strict";
var flatiron = require('flatiron'),
    path = require('path'),
    app = flatiron.app;

// configure & init the flatiron app *then* instantiate singularity
// init() instantiates the logs
app.config.file(path.join(__dirname, '/config.json'));
app.use(flatiron.plugins.http);

var singularity = require('./libraries/singularity');

app.start(app.config.get('port'), function() {
  singularity.injectFlatironPlugins(__dirname + '/flatiron_plugins');
  singularity.mapTriggers(require('./default_events'));
  singularity.route(require('./routes'));
  app.log.info('Listening on port %d', app.config.get('port'));
});
