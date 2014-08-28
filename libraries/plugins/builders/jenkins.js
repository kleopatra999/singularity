"use strict";

var request = require('request'),
    url = require('url'),
    q = require('q'),
    uuid = require('node-uuid'),
    reqBaseVcsParams = ['repo', 'after', 'change', 'actor'],
    reqChangeVcsParams = ['before'],
    reqProposalVcsParams = ['repo_url', 'base_ref', 'fork_ref', 'fork_url'],
    validBuildCodes = [200, 201],
    getRepoProjects,
    buildPayloadFromVcs,
    createJobParams;

function matchesRegex(thing, regex) {
  return String(thing).match(new RegExp(String(regex)));
}

function ruleMatch(field, rule) {
  return !!(field === rule || matchesRegex(field, rule));
}

/**
 * Utility fx that takes a string or object & return name of an object
 *
 * @param {String|Object} obj
 * @return {String}
 */
function getProjectFromObject(obj) {
  if (typeof obj === 'string') {
    return obj;
  }
  return obj.project;
}

/**
 * Given a repo, type & config, goes through the projects in the config, looks
 * for any projects associated with the given repo & returns an list of projects
 * and the tokens required to trigger them
 *
 * @param {String} repo Name of the repo
 * @param {String} type Type of change required
 * @param {Object} config plugin config containing repo-project mappings
 * @return {Array} Array of objects, each with two fields: project (name of
 *                 project) & project_token (token to use to trigger the project)
 */
function getRepoProjects(repo, type, config) {
  var masterToken = (config.auth) ? config.auth.project_token : null;

  config = config.projects;
  if (!config) {
    throw 'no projects given in config';
  }
  if (!config[repo]) {
    throw 'repo ' + repo + ' not associated with any projects';
  }

  var repoProjectToken = config[repo].project_token || null;

  if (typeof config[repo] === 'string') {
    return [
        {
            project: config[repo],
            project_token: repoProjectToken || masterToken,
            rules: false
        }
    ];
  }

  if (!config[repo][type]) {
    if (config[repo].project) {
      var token = config[repo].project_token || repoProjectToken || masterToken,
          rules = config[repo].rules ? JSON.parse(JSON.stringify(config[repo].rules)) : false;
      return [
          {
              project: config[repo].project,
              project_token: token,
              rules: rules
          }
      ];
    }
    throw 'no ' + type + ' project(s) associated with ' + repo;
  }

  // conform to array - allow singular objects
  // also, reference modification, what can go wrong?
  if (!Array.isArray(config[repo][type])) {
    config[repo][type] = [config[repo][type]];
  }

  return config[repo][type].map(function(obj) {
    return {
        project: getProjectFromObject(obj),
        project_token: obj.project_token || repoProjectToken || masterToken,
        rules: obj.rules
    };
  });
}

/**
 * @param {Object} project internally build object from getRepoProjects()
 * @param {Object} vcsPayload given vcsPayload from the event_mapper
 * @param {String} host the jenkins instance that this plugin is tied to
 * @return {Object} a buildPayload
 */
function buildPayloadFromVcs(project, vcsPayload, host) {
  return {
      artifacts: {},
      buildId: uuid.v1(),
      cause: 'vcsPayload',
      link: '',
      host: host,
      project: project.project,
      repo: vcsPayload.repo,
      revision: vcsPayload.after,
      status: 'queued',
      type: 'queued',
      triggeringPayload: vcsPayload
  };
}

/**
 * @param {Object} buildPayload A build payload
 * @param {Object} project internally build object from getRepoProjects()
 * @param {Object} vcsPayload given vcsPayload from the event_mapper
 * @return {Object} Query params required to trigger a job
 * @TODO: update when the vcsPayload schema has been corrected to use camelcase
 */
function createJobParams(buildPayload, project, vcsPayload) {
  var params = {
      token: project.project_token || '',
      cause: vcsPayload.change,

      repo: vcsPayload.repo,
      buildId: buildPayload.buildId,
      host: buildPayload.host,
      baseUrl: vcsPayload.repo_url,
      baseBranch: vcsPayload.base_ref,
      forkUrl: vcsPayload.fork_url || '',
      forkRef: vcsPayload.fork_ref || '',
      before: vcsPayload.before || '',
      after: vcsPayload.after || ''
  };

  return params;
}

/**
 * Generate headers for a build trigger based on a given plugin config
 *
 * @param {Object} config Jenkins plugin config
 * @return {Object} headers used for request
 * @todo Research other ways for auth
 */
function buildHeaders(config) {
  var auth = config.auth || {};
  if (auth.user && auth.password) {
    return {
      authorization: 'Basic ' +
      (new Buffer(auth.user + ":" + auth.password, 'ascii')
      .toString('base64'))
    };
  }
  return false;
}

/**
 * Ensure that a given vcsPayload has the given required fields, PLUS
 * the base-required fields
 *
 * @param {Object} vcsPayload
 * @return {Promise} resolves with vcsPayload if valid
 */
function validateVcsParams(vcsPayload, required) {
  required = reqBaseVcsParams.concat(required);

  return q.all(
    required.map(function(param) {
      return q(param)
      .then(function() {
        if (!vcsPayload[param]) {
          throw 'given VCS payload missing "' + param + '"';
        }
        return vcsPayload[param];
      });
    }, this)
  )
  .thenResolve(vcsPayload);
}

module.exports = require('../plugin').extend({
  name: 'jenkins',
  bound_fx: ['_buildForVcs', '_buildProject', '_triggerBuild'],

  validateChange: function(vcsPayload) {
    return validateVcsParams(vcsPayload, reqChangeVcsParams);
  },

  validateProposal: function(vcsPayload) {
    return validateVcsParams(vcsPayload, reqProposalVcsParams);
  },

  buildChange: function(vcsPayload) {
    return this._buildForVcs(vcsPayload);
  },

  buildProposal: function(vcsPayload) {
    return this._buildForVcs(vcsPayload);
  },

  /**
   * @param httpPayload {Object} Internally build httpPayload, based on the
   *                             the payload built by the notification-plugin
   * @return {Object} httpPayload
   */
  validateBuildUpdate: function(httpPayload) {
    if (!httpPayload.__headers) {
      throw 'no __headers field; payload was not built internally';
    }
    if (!httpPayload.build || !httpPayload.build.parameters) {
      throw 'no parameters for build';
    }
    if (httpPayload.build.parameters.host !== this.config.host) {
      throw 'unable to determine jenkins instance that sent this payload';
    }
    if (!httpPayload.build.url) {
      throw 'no build URL in http payload, ignoring';
    }
    return httpPayload;
  },

  /**
   * @param httpPayload {Object} Internally build httpPayload, based on the
   *                             the payload built by the notification-plugin
   * @return {Promise} Object that represents a complete buildPayload
   */
  createUpdatePayload: function(httpPayload) {
    return q({
        buildId: httpPayload.build.parameters.buildId,
        repo: httpPayload.build.parameters.repo,
        revision: httpPayload.build.parameters.after,
        project: httpPayload.name,
        cause: 'build status update',
        status: this._determineBuildStatus(httpPayload),
        link: httpPayload.build.full_url + 'consoleFull',
        host: httpPayload.build.parameters.host,
        artifacts: httpPayload.build.artifacts,
        type: this._determineBuildStatus(httpPayload),
        triggeringPayload: httpPayload
    });
  },

  addConfig: function(pl) {
    if (this.config.projects[pl.repository]) {
      this.debug(
        'project for repo already exists, attempting to update',
        { repository: pl.repository }
      );
      return this.updateConfig(pl);
    }
    var project = {
      project: pl.project
    };
    if (pl.changesetType === 'change') {
      var rules = this.config.default_rules || {base_ref: /^master$/};
      if (pl.rules) {
        rules = JSON.parse(pl.rules);
      }
      project.rules = rules;
    }

    this.config.projects[pl.repository] = {};
    this.config.projects[pl.repository][pl.changesetType] = [];
    this.config.projects[pl.repository][pl.changesetType].push(project);

    this.info(
      'added config',
      this.config.projects[pl.repository][pl.changesetType],
      { repository: pl.repository }
    );

    return this._createConfigPayload();
  },

  removeConfig: function(pl) {
    if (pl.changesetType !== 'repository') {
      throw 'feature not supported: removing ' + pl.changesetType + ' configs';
    }
    if (!this.config.projects[pl.repository]) {
      throw 'No config found for repo: ' + pl.repository;
    }
    this.info('removing config', this.config.projects[pl.repository]);
    delete this.config.projects[pl.repository];

    return this._createConfigPayload();
  },

  /**
   * Reads an httpPayload from the notification-plugin
   * Maps the status of the payload to an internally recognized status
   *
   * @param httpPayload {Object} internally built payload
   * @return {String}
   */
  _determineBuildStatus: function(httpPayload) {
    if (httpPayload.build.phase === 'STARTED') {
      return 'building';
    }
    if (httpPayload.build.phase === 'FINALIZED') {
      return (httpPayload.build.status === 'SUCCESS') ? 'success' : 'failure';
    }
    this.debug('build has not been finalized: ' + this.logForObject(httpPayload));
    return 'finishing';
  },

  /**
   * POST to the Jenkins API to start a build
   *
   * @function triggerBuild
   * @param project {Object} internally built project object based on config
   * @param params {Object} internally built params from createJobParams
   * @return {Promise} ninvoke on mikael/request
   *                   (POST to /job/name_name/buildWithParameters)
   */
  _triggerBuild: function(project, params) {
    var headers = buildHeaders(this.config),
        options = {
          url: url.format({
            protocol: this.config.protocol,
            host: this.config.host,
            pathname: '/job/' + project.project + '/buildWithParameters',
            query: params
          }),
          method: 'GET'
        };

    if (headers) { options.headers = headers; }

    this.info('jenkins build trigger', project.project);
    this.debug('trigger options', options);

    return q.nfcall(request, options)
    .spread(function(response, body) {
      if (!response.statusCode ||
          !~validBuildCodes.indexOf(response.statusCode)) {
        this.debug(body);
        throw '[' + response.statusCode +
        '] failed to trigger build for ' +
          this.logForObject(project);
      }
    }.bind(this));
  },

  /**
   * @param project {Object} internally built project object based on config
   * @param vcsPayload {Object} payloads/vcs
   * @return {Promise} Resolves with build payload, queued status only
   */
  _buildProject: function(project, vcsPayload) {
    var publishPayload;

    return q([project, vcsPayload, this.config.host])
    .spread(buildPayloadFromVcs)
    .then(function(buildPayload) {
      publishPayload = buildPayload;
      return [buildPayload, project, vcsPayload];
    })
    .spread(createJobParams)
    .then(function(params) {
      return [project, params];
    })
    .spread(this._triggerBuild)
    .then(function() {
      return publishPayload;
    });
  },

  /**
   * @param vcsPayload {Object} payloads/vcs
   * @return {Promise} Maps out projects to trigger for this plugin instance
   *                   calls _buildProject to trigger them
   */
  _buildForVcs: function(vcsPayload) {
    return q([vcsPayload.repo, vcsPayload.type, this.config])
    .spread(getRepoProjects)
    .then(function(projects) {
      return q.all(
        projects.filter(function(project) {
          if (!project.rules) {
            return project;
          }
          return Object.keys(project.rules).every(function(field) {
            if (!vcsPayload[field]) {
              this.debug('vcsPayload did not contain field: ' + field);
              return false;
            }
            var matches = ruleMatch(vcsPayload[field], project.rules[field]);
            if (!matches) {
              this.debug('not building vcsPayload', this.logForObject(project.rules));
            }
            return matches;
          }, this);
        }, this)
        .map(function(project) {
          return this._buildProject(project, vcsPayload);
        }, this)
      );
    }.bind(this))
    .then(function(payloads) {
      return payloads.filter(function(pl) {
        return !!pl;
      });
    });
  }
});
