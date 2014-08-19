var q = require('q'),
    app = require('flatiron').app,
    postal = require('postal');

/**
 * Iterate through an array of postal envelopes & publish
 *
 * @param {Array} events Objects that have channel, topic & data fields
 */
function publishEvents(events) {
  events.forEach(function(event) {
    postal.publish(event);
  });
}

/**
 * Given an object, attempt to create postal objects that *may* be
 * recognizable internally
 *
 * @param {Object} meta Loops through the fields of meta, except for
 *                      body & status, formats the data into postal
 *                      postal envelopes. The returned promise
 *                      resolves with an array of these objects
 * @return {Object} A promise
 */
function packageMeta(meta) {
  return q.resolve(Object.keys(meta))
  .then(function(metaFields) {
    // honestly have no idea if this resolves synchronously
    return metaFields.map(function(field) {
      return {
        channel: field.substring(0, field.indexOf('.')),
        topic: field.substring(field.indexOf('.') + 1, field.length),
        data: meta[field]
      };
    });
  });
}

/**
 * Maps channel events to adapter callbacks
 *
 * @param {Object} trigger    creates an event trigger, mapping a {channel,topic}
 *                            to a {adapter,callback}
 * @return {Object} A promise
 */
function createTrigger(trigger) {
  this.debug('[trigger.add]', trigger);
  var channelObj = postal.channel(trigger.channel),
  callback = function(data, envelope) {
    this.debug('[channel.topic -> adapter.callback]', trigger);
    q.resolve(data)
    .then(app[trigger.adapter][trigger.callback].bind(app[trigger.adapter]))
    .catch(this.error)
    .done();
  }.bind(this);
  channelObj.subscribe(trigger.topic, callback);
}

/**
 * Ensures that a given trigger is valid
 *
 * @param {Object} trigger    trigger to validate
 * @return {Object} A promise
 */
function validateTrigger(trigger) {
  return q.fcall(function() {
    ['channel', 'topic', 'adapter', 'callback'].forEach(function(param) {
      if (!trigger[param]) {
        throw 'missing param "' + param + '" in ' + JSON.stringify(event);
      }
    });
    return trigger;
  });
}

/**
 * @module EventMapper
 */
module.exports = require('./core_component').extend({
  name: 'event_mapper',

  init: function(option) {
    this._super(option);
    this.react = this.react.bind(this);
  },

  react: function(data) {
    return packageMeta(data)
    .then(publishEvents);
  },

  addTrigger: function(trigger) {
    validateTrigger(trigger)
    .then(createTrigger.bind(this))
    .catch(this.error)
    .done();
  }
});
