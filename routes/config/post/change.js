var configRoute = require('../config'),
    route = configRoute('change');

route.method = "post";
module.exports = route;
