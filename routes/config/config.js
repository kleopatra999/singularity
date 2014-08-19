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

module.exports = function(type, fields) {
  var configRoute = function(request) {
    return q([request, fields])
    .spread(validateFields)
    .then(function() {
      return ['config.request.' + type, request];
    })
    .spread(payload.preparePayload);
  }

  return configRoute;
}
