var configRoute = require('../config'),
    route = configRoute('proposal');

route.method = "post";
module.exports = route;
