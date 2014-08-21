"use strict";

var HttpPayload, createPayload;

module.exports.HttpPayload = HttpPayload = require('./payload').extend({
  name: 'http',
  required_fields: ['__headers']
});

/**
 * Utility fx to wrap HTTP requests into objects that are readable by the rest of
 * the system
 *
 * @function payload
 * @param {String} event Name of the event (channel.topic pair)
 * @param {Object} request Raw flatiron request object
 */
module.exports = createPayload = function(event, request) {
  return (new HttpPayload(request.body))
  .setName(event)
  .appendData('__headers', request.headers)
  .appendData('type', 'http')
  .appendData('method', request.method)
  .validate()
  .payload();
};

module.exports.preparePayload = function(event, request) {
  var pl;
  try {
    pl = createPayload(event, request);
  }
  catch(err) {
    throw {
      status: 422,
      message: err.message || err
    };
  }
  return pl;
};
