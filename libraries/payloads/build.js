"use strict";

module.exports.BuildPayload = require('./payload').extend({
  payload: 'build',

  // TODO: flesh this out, this is just what the publisher needs
  required_fields: [
      'cause',
      'artifacts',
      'buildId',
      'host',
      'link',
      'project',
      'repo',
      'revision',
      'status',
      'triggeringPayload'
  ],
  field_vals: {
    // also used as type (for jenkins plugin at least)
    // 'finishing' is a NOOP (for jenkins plugin at least)
    status: ['queued', 'building', 'success', 'failure', 'error', 'finishing']
  }
});
