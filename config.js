exports.config = {
  host: 'http://192.168.59.103',
  // port that express will run on
  port: '8080',
  // info or debug
  log_level: 'debug',
  // whether to save this configuration into the database
  // and opt to use stored configs over this file
  persist_config: true,
  db: {
      type: 'mongo',
      auth: {
          user: 'username',
          pass: 'password',
          host: '192.168.59.103',
          port: 27017,
          db: 'singularity',
          slaveOk: false
      }
  },
    plugins: {
        github: {
            method: 'hooks',
            auth: {
                type: 'oauth',
                token: 'CI-USER-TOKEN',
                username: 'CI-USER'
            },
            user: 'behance',
            repos: [ 'nbd.js' ],
            skip_file_listing: true
        },
        jenkins:  {
            user: 'jenkins',
            pass: 'password',
            protocol: 'http',
            host: '192.168.59.103',
            token: 'remote-trigger-token',
            push_projects: [
                {
                    repo: 'nbd.js',
                    rules: [ new RegExp(/^master$/) ],
                    name: 'push-job'
                }
            ],
            projects: [
                {
                    name: 'pr-job',
                    repo: 'nbd.js'
                }
            ]
        }
    }
};
