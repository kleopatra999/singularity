var configRoute = require('../config'),
    route = configRoute('proposal', ['repository']);

route.method = "delete";
module.exports = route;
