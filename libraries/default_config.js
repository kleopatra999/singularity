function defaults() {
  return {
    port: 8080,
    log: {
      console: {
        level: 'info',
        colorize: false
      }
    },
    build: {
      plugin: 'jenkins',
      jenkins: {
        protocol: 'http',
        host: 'localhost:8080',
        auth: {
          user: 'jenkins',
          password: 'password',
          project_token: 'token'
        },
        projects: []
      }
    },
    db: {},
    vcs: {
      plugin: 'github',
      github: {
        ignore_statuses: false,
        auth: {
          token: false,
          type: 'oauth',
          username: ''
        },
        repos: []
      }
    },
    publisher: {
      plugin: 'github',
      github: {
        auth: {
          token: false,
          type: 'oauth',
          username: ''
        }
      }
    },
    cache: {
      max: 64,
      maxAge: 60 * 1000
    }
  };
}

module.exports = defaults();
