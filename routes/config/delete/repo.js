var configRoute = require('../config'),
    route = configRoute('repository', ['repository']);

route.method = "delete";
module.exports = route;
