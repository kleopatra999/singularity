var q = require('q'),
    app = require('flatiron').app;

/**
 * Used to safely wrap function ret vals & respond to requests
 *
 * @param {Object} route A function that returns *some* object
 * @return {Object} A promise
 */
function requestWrapper(route) {
  var deferred = q.defer();
  deferred.resolve(this.req);

  var self = this,
  retval = deferred.promise.then(function(req) {
    return route(req);
  }),
  writeResponse = function(defaultStatus, meta) {
    self.res.writeHead(meta.status || defaultStatus);
    self.res.write(JSON.stringify(meta.body || meta));
    self.res.end();
  };

  retval.done(function(meta) {
    writeResponse(200, meta);
  }, function(meta) {
    writeResponse(500, meta);
  });

  return retval;
}

/**
 * Given a path and a route object, build the arguments
 * needed to add to the router.
 *
 * @param {string} path        the path
 * @param {Object|[]} routes   object with route callback and method
 * @param {Object} EventMapper object to pass generated route
 *                             metadata to
 * @return [{Object}] router arguments object
 */
function attachRoute(path, route, eventHandler) {
  var method = route.method || 'get';
  this.debug('creating route', { path: path, method: method });
  return q.resolve([
    method,
    path,
    function() {
      requestWrapper.call(this, route)
      .then(eventHandler.mapEvent);
    }
  ]);
}

/**
 * Add a route to the router.
 *
 * @param {Object[]} routes array args for router.on()
 */
function dispatchRoute(route) {
  app.router.on.apply(app.router, route);
}

module.exports = require('./core_component').extend({
  name: 'receiver',

  init: function(option) {
    this._super(option);
    this.buildRoutes = this.buildRoutes.bind(this);
  },

  buildRoutes: function(path, routes, eventMapper) {
    if (!Array.isArray(routes)) {
      routes = [routes];
    }

    q.all(
      routes.map(function(route) {
        return attachRoute.call(this, path, route, eventMapper)
        .then(dispatchRoute);
      }, this)
    )
    .done();
  }
});
