var app = require('flatiron').app;

/**
 * @module core_component
 */
module.exports = require('./event_reactor').extend({
  objectType: 'core_component',

  init: function(option) {
    this.log = app.log.get('console');
    this._super(option);
  }
});
