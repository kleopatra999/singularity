"use strict";

var winston = require('winston'),
    logger = new winston.Logger({
      transports: [
        new (winston.transports.Console)()
      ]
    });
    logger.cli();

function logPrepend(type, name) {
  return '[' + type + '.' + name + '] ';
}

module.exports = require('nbd/Class').extend({
  init: function(option) {
    if (!this.objectType) {
      throw Error('objectType must be assigned to this object');
    }
    if (!this.name) {
      throw 'No object name defined';
    }
    // yes, I want a deep copy, not a friggen reference
    this.config = JSON.parse(JSON.stringify(option || {}));
    this.log = this.log || logger;
    this.info = this.info.bind(this);
    this.debug = this.debug.bind(this);
    this.error = this.error.bind(this);
    // do I know what I'm doing? obviously not.
    this.bound_fx = this.bound_fx || [];
    this.bound_fx.forEach(function(fx) {
      this[fx] = this[fx].bind(this);
    }, this);
  },

  formatLogs: function(args) {
    args = Array.prototype.slice.call(args);
    args[0] = (typeof args[0] === 'string') ?
      args[0] : args[0].toString();
    args[0] =  logPrepend(this.objectType, this.name) + args[0];
    return args;
  },

  info: function() {
    this.log.info.apply(this.log, this.formatLogs(arguments));
  },

  debug: function() {
    this.log.debug.apply(this.log, this.formatLogs(arguments));
  },

  error: function() {
    this.log.error.apply(this.log, this.formatLogs(arguments));
  },

  logForObject: function(obj) {
    return JSON.stringify(obj).substring(0, 64) + '...';
  }
});
