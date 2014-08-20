var q = require('q'),
    payload = require('../../libraries/payloads/http'),
    requiredFields = ['repository', 'project'];

function validateFields(request, fields) {
  if (!fields) {
    fields = requiredFields;
  }
  return q.all(
    fields.map(function(field) {
      if (!request.body[field]) {
        throw {
          body: 'Missing param ' + field,
          status: 400
        };
      }
      return request.body[field];
    })
  );
}

function validateType(type) {
  if (!~['change', 'proposal'].indexOf(type)) {
    throw 'Unknown changeset type: ' + type;
  }
}

module.exports = function(type, fields) {
  var configRoute = function(request) {
    return q(validateType(type))
    .thenResolve([request, fields])
    .spread(validateFields)
    .then(function() {
      return ['config.request.' + type, request];
    })
    .spread(payload.preparePayload)
    .then(function(httpPayload) {
      return q(Object.keys(httpPayload))
      .then(function(payloadNames) {
        return q.allSettled(
          payloadNames.map(function(name) {
            httpPayload[name].changesetType = type;
            return httpPayload[name];
          })
        );
      })
      .thenResolve(httpPayload);
    });
  }

  return configRoute;
}
