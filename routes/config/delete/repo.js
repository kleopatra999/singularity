var configRoute = require('../config'),
    route = configRoute('repo', ['repository']);

route.method = "delete";
module.exports = route;
