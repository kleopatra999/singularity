var app = require('flatiron').app;

/**
 * @module EventMapper
 */
module.exports = require('./vent').extend({
  objectType: 'core_component',

  init: function(option) {
    this.log = app.log.get('console');
    this._super(option);
  }
});
