module.exports = [
    {
        path: 'build/update',
        routes: require('./routes/build/update')
    },
    {
        path: 'hook',
        routes: require('./routes/hook')
    },
    {
        path: 'config/repo',
        routes: require('./routes/config/delete/repo')
    },
    {
        path: 'config/change',
        routes: require('./routes/config/post/change')
    },
    {
        path: 'config/proposal',
        routes: require('./routes/config/post/proposal')
    }
];
