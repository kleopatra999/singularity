/**
 * The Jenkins integration plugin
 * @module Jenkins
 */
"use strict";

var request = require('request'),
    url = require('url'),
    uuid = require('node-uuid'),
    async = require('async');

/**
 * @class Jenkins
 * @param config {Object} The plugins configs
 * @param application {application} An instance of the main application object
 * @constructor
 */
var Jenkins = function(config, application, idGen, requester) {
  var self = this;

  self.request = requester || request;
  self.uuid = idGen || uuid;
  self.config = config;
  self.application = application;

  self.application.on('jenkins.config_reload', function(new_config) {
    self.config = new_config;
    self.application.log.info('jenkins: reloaded config');
    self.application.emit('singularity.configuration.updated', 'jenkins');
  });

  self.application.on('jenkins.new_pr_job', function(job) {
    // yay for references - directly updates in application config :|
    self.config.projects.push(job);
    self.application.log.info('jenkins: updated config');
    self.application.emit('singularity.configuration.updated', 'jenkins');
  });

  self.application.on('jenkins.new_push_job', function(job) {
    // yay for references - directly updates in application config :|
    self.config.push_projects.push(job);
    self.application.log.info('jenkins: updated config');
    self.application.emit('singularity.configuration.updated', 'jenkins');
  });

  self.application.on('push.found', function(push) {
    self.triggerBuildsForOpenPRs(push.repository.name);
    self.pushFound(push);
  });

  self.application.on('pull.processed', function(pull, pull_number, sha, ssh_url, branch, updated_at) {
    self.buildPull(pull, pull_number, sha, ssh_url, branch, updated_at);
  });

  self.application.on('pull.found', function(pull) {
    self.pullFound(pull);
  });

  self.application.on('build.download_artifact', function(build, pull, artifact) {
    self.downloadArtifact(build, pull, artifact);
  });

  self.application.on('build.trigger', function(job_name, url_options) {
    self.triggerBuild(job_name, url_options, function(error) {
      if (error) {
        self.application.log.info(
          'Received error from Jenkins when triggering build',
          { job_name: job_name, url_options: url_options }
        );
      }
    });
  });

  self.application.on('process_artifacts', function(job_name, build, pull) {
    self.processArtifacts(job_name, build, pull);
  });
};

/**
 * Retrigger jobs for all pulls associated with a repo
 *
 * @method triggerBuildsForOpenPRs
 * @param pull {String}
 */
Jenkins.prototype.triggerBuildsForOpenPRs = function(repo_name) {
  var params = { limit: 1, repo: repo_name },
      self = this;
  this.application.db.findRepoPullsByStatuses(params, function(pulls, err) {
    if (err) {
      self.application.log.error("Could not retrigger PR tests for " + repo_name + " : " + err);
      return;
    }

    pulls.forEach(function(pull) {
      pull.opening_event.head.sha = pull.head;
      pull = pull.opening_event;
      pull.skip_comments = true;
      self.application.emit('pull.validated', pull);
    });
  });
};

/**
 * Finds unfinished jobs for a PR
 *
 * @method findUnfinishedJob
 * @param pull {Object}
 * @returns {Object}
 */
Jenkins.prototype.findUnfinishedJob = function(pull) {
  for (var x in pull.jobs) {
    if (pull.jobs[x].status !== 'finished') {
      return pull.jobs[x];
    }
  }
};

/**
 * Searches through the configs to find the appropriate project for the provided repo.
 *
 * @method findProjectByRepo
 * @param repo {String}
 * @returns {Object}
 */
Jenkins.prototype.findProjectByRepo = function(repo) {
  var found = null;
  this.config.projects.forEach(function(project) {
    if (repo === project.repo) {
      found = project;
    }
  });

  return found;
};

/**
 * Sets up an asynchronous job that polls the Jenkins API to look for jobs that are finished.
 *
 * @method start
 */
Jenkins.prototype.start = function() {
  if (!this.application.db) {
    this.application.log.error('Jenkins Listener: missing app db... (╯°□°）╯︵ ┻━┻');
    return this;
  }

  var self = this;
  async.parallel({
    jenkins: function() {
      var run_jenkins = function() {
        self.application.db.findByJobStatus(['new', 'started'], function(err, pull) {
          if (err) {
            self.application.log.error(err);
            process.exit(1);
          }
          if (!pull) {
            return;
          }
          self.checkPRJob(pull);
        });

        self.application.db.findPushJobsByStatus(['new', 'started'], function(err, push) {
          if (err) {
            self.application.log.error(err);
            process.exit(1);
          }
          if (!push) {
            return;
          }
          self.checkPushJob(push);
        });

        setTimeout(run_jenkins, self.config.frequency);
      };

      run_jenkins();
    }
  });

  return this;
};

/**
 * Uses the Jenkins REST API to trigger a new build for the provided PR
 *
 * @method buildPull
 * @param pull {Object}
 * @param number {String}
 * @param sha {String}
 * @param ssh_url {String}
 * @param branch {String}
 * @param updated_at {String}
 * @todo Do we need to pass all these parameters, is just passing pull enough?
 */
Jenkins.prototype.buildPull = function(pull, number, sha, ssh_url, branch, updated_at) {
  var project = this.findProjectByRepo(pull.repo),
      self = this,
      job_id = self.uuid.v1(),
      trigger_token = project.token || self.config.token;

  this.application.log.info('Starting build for pull', { pull_number: pull.number, project: project.name });

  this.triggerBuild(project.name, {
    token: trigger_token,
    cause: 'Testing PR: ' + number,
    REPOSITORY_URL: ssh_url,
    BRANCH_NAME: branch,
    JOB: job_id,
    PULL: number,
    BASE_BRANCH_NAME: pull.base.ref,
    SHA: sha
  },
  function(error) {
    if (error) {
      self.application.log.error(error);
      return;
    }

    var job = {
          id: job_id,
          status: 'new',
          result: 'BUILDING',
          head: sha
        },
        job_url = url.format({
          protocol: self.config.protocol,
          host: self.config.host,
          pathname: '/job/' + project.name
        });

    self.application.log.debug('Updating PR, inserting job', job);
    self.application.db.updatePull(
      number,
      pull.repo,
      {head: sha, updated_at: updated_at},
      function() {
        self.application.db.insertJob(pull, job);
        self.application.emit('build.queued', job, pull, job_url);
      }
    );
  });
};

/**
 * Called when a new pull is being checked to see if it should be processed. This method will iterate
 * over the configured projects to find the right one and check that ones rules to see if a build should
 * be triggered for it based on the files that were modified.
 *
 * @method pullFound
 * @param pull {Object}
 */
Jenkins.prototype.pullFound = function(pull) {
  var project = this.findProjectByRepo(pull.repo);

  if (!project) {
    this.application.log.error('No jenkins job found for PR', { pull: pull.number, repository: pull.base.repo.fullname || pull.base.repo.name });
    return;
  }

  if (!project.rules) {
    this.application.log.debug('Validating pull with no rules', { pull: pull.number, project: project.name });
    this.application.emit('pull.validated', pull);
    return;
  }

  for (var x in pull.files) {
    if (!pull.files[x].filename || typeof pull.files[x].filename !== 'string') {
      continue;
    }

    for (var y in project.rules) {
      if (pull.files[x].filename.match(project.rules[y])) {
        this.application.log.debug('Validating pull with rules', { pull: pull.number, project: project.name });
        this.application.emit('pull.validated', pull);
        return;
      }
    }
  }

  this.application.log.debug('Invalidating pull with rules', { pull: pull.number, project: project.name });
};

/**
 * Validate that a push can be used to trigger a build, given the config
 * @method validatePush
 * @param push {Object}
 */
Jenkins.prototype.validatePush = function(push) {
  var repo = push.repository.name,
      log_info = { repo: repo, reference: push.ref, head: push.after };

  if (!this.config.push_projects) {
    this.application.log.debug('No push_projects config for jenkins plugin', log_info);
    return false;
  }

  var project = this.findPushProjectForRepo(repo);

  if (!project) {
    this.application.log.debug('repo not configured for push events', log_info);
    return false;
  }

  if (!project.name) {
    this.application.log.error('No jenkins project given for repo', log_info);
    return false;
  }

  return true;
};

/**
 * @method findPushProjectForRepo
 * @param repo {String}
 */
Jenkins.prototype.findPushProjectForRepo = function(repo) {
  if (!Array.isArray(this.config.push_projects) || !this.config.push_projects) {
    return {};
  }
  return this.config.push_projects.filter(function(project) {
    return project.repo === repo;
  })
  .pop();
};

/**
 * Called when a push event is given, looks at the ref and sees if it matches any rules. If it does, triggers
 * a given project.
 *
 * @method pushFound
 * @param push {Object}
 */
Jenkins.prototype.pushFound = function(push) {
  if (!this.validatePush(push)) {
    return;
  }

  var self = this,
      repo = push.repository.name,
      project_config = self.findPushProjectForRepo(repo),
      log_info = { repo: repo, reference: push.ref, head: push.after },
      branch = push.ref.split('/').pop();

  if (!branch) {
    self.application.log.error('Bad ref name', { ref: push.ref, parsed: branch });
    return;
  }

  if (!project_config.rules || !(project_config.rules instanceof Array)) {
    self.application.log.info('no ref regex rules for push', log_info);
    self.buildPush(push, branch);
    return;
  }

  project_config.rules.some(function(regex) {
    if (!branch.match(regex)) {
      self.application.log.debug(branch + ' did not match ' + regex);
      return false;
    }

    log_info.jenkins_trigger = { project: project_config.name, branch: branch };
    self.application.log.info('regex rule matched for push', log_info);
    self.buildPush(push, branch);

    return true;
  });
};

/**
 * Build a given push command. Assumes that validatePush was run on push & runs a given project.
 *
 * @method buildPush
 * @param push {Object}
 * @param branch {String}
 */
Jenkins.prototype.buildPush = function(push, branch) {
  var self = this,
      repo = push.repository.name,
      job_id = self.uuid.v1(),
      project = this.findPushProjectForRepo(repo),
      url_opts = {
        token: project.token || self.config.token,
        cause: push.ref + ' updated to ' + push.after,
        BRANCH_NAME: branch,
        BEFORE: push.before,
        AFTER: push.after,
        JOB: job_id
      };

  self.triggerBuild(project.name, url_opts, function(error) {
    if (error) {
      self.application.log.error(error);
    }

    self.application.db.insertPushJob(push, job_id);
  });
};

/**
 * Use this.getJobBuilds to get a build for a project matching a specific job ID.
 * If nothing can be found, returns false
 *
 * @method getBuildById
 * @param project_name {String}
 * @param build_id {String}
 */
Jenkins.prototype.getBuildById = function(project_name, build_id, callback) {
  this.getJobBuilds(project_name, function(err, builds) {
    if (err || !builds) {
      callback(null, false);
      return;
    }

    builds.forEach(function(build) {
      build.parameters.forEach(function(param) {
        if (param.name === 'JOB' && param.value === build_id) {
          callback(null, build);
        }
      });
    });
  });
};

/**
 * Uses the Jenkins REST API to check if the provided PR has any jobs that recently finished. If so
 * their status in the database is updated and events are triggered so other plugins can re-act to the completion
 * of the job.
 *
 * @method checkPRJob
 * @param pull {Object}
 */
Jenkins.prototype.checkPRJob = function(pull) {
  var noun,
      self = this,
      job = self.findUnfinishedJob(pull),
      project = self.findProjectByRepo(pull.repo);

  if (!job || !project) {
    noun = (!job) ? 'job' : 'project';
    self.application.log.error('No ' + noun + ' for ' + pull.repo + ' on ' + self.config.host);
    return;
  }

  self.getBuildById(project.name, job.id, function(err, build) {
    if (!build) {
      return;
    }

    if (job.status === 'new') {
      self.application.db.updatePRJobStatus(job.id, 'started', 'BUILDING', function() {
        self.application.emit('build.started', job, pull, build.url);
      });
    }

    if (job.status === 'finished' || build.building) {
      return;
    }

    var event = 'build.' + build.result.toLowerCase().trim(),
        debugInfo = { event: event, repo: pull.repo, number: pull.number, job: job};

    self.application.log.debug('PR event', debugInfo);
    self.application.db.updatePRJobStatus(job.id, 'finished', build.result, function() {
      self.application.emit(event, job, pull, build.url);
      if (['FAILURE', 'SUCCESS'].indexOf(build.result) !== -1) {
        self.processArtifacts(project.name, build, pull);
      }
    });
  });
};

/**
 * Similar to checkPRJob() but for pushes
 *
 * @method checkPushJob
 * @param push {Object}
 */
Jenkins.prototype.checkPushJob = function(push) {
  var self = this,
      job = push.job,
      project = this.findPushProjectForRepo(push.repo);

  if (!project) {
    self.application.log.error('No push project found for repo', { repo: push.repo });
    return;
  }

  self.getBuildById(project.name, job.id, function(err, build) {
    if (err || !build) {
      return;
    }

    if (build.building) {
      self.application.db.updatePushJobStatus(job.id, 'started', 'BUILDING');
      return;
    }

    var event = 'push.build.' + build.result.toLowerCase().trim();

    self.application.log.debug('Push updated', { project: project, job: job.id, event: event });
    self.application.emit(event, build);
    self.application.db.updatePushJobStatus(job.id, 'finished', build.result);

    if (['FAILURE', 'SUCCESS'].indexOf(build.result) !== -1) {
      self.processArtifacts(project.name, build, push);
    }
  });
};

/**
 * GET to the Jenkins API to start a build
 *
 * @method triggerBuild
 * @param job_name {String}
 * @param url_options {Options}
 * @param callback {Function}
 */
Jenkins.prototype.triggerBuild = function(job_name, url_options, callback) {
  var options = {
    url: url.format({
      protocol: this.config.protocol,
      host: this.config.host,
      pathname: '/job/' + job_name + '/buildWithParameters',
      query: url_options
    }),
    method: 'GET'
  };

  if (this.config.user && this.config.pass) {
    options.headers = {
      authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
    };
  }

  this.application.log.debug('jenkins build trigger', options);

  this.request(options, callback);
};

/**
 * Checks the Jenkins API for the status of a job
 *
 * @method getJobBuilds
 * @param job_name {String}
 * @param callback {Function}
 */
Jenkins.prototype.getJobBuilds = function(job_name, callback) {
  var self = this,
      options = {
        url: url.format({
          protocol: this.config.protocol,
          host: this.config.host,
          pathname: '/job/' + job_name + '/api/json',
          query: {
            tree: 'builds[number,url,actions[parameters[name,value]],building,result]'
          }
        }),
        json: true
      };

  if (this.config.user && this.config.pass) {
    options.headers = {
      authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
    };
  }

  self.request(options, function(error, response) {
    if (error) {
      self.application.log.error('error when getting job builds', error);
      return;
    }
    if (response.body && response.body.builds) {
      response = response.body.builds.filter(function(build) {
        return build.actions && build.actions.some(function(action) {
          return !!action.parameters;
        });
      })
      .map(function(build) {
        build.url += 'consoleFull';
        build.actions.forEach(function(action) {
          if (action.parameters) {
            build.parameters = action.parameters;
          }
        });
        return build;
      });
    }
    else {
      error = 'invalid response - no builds';
    }
    callback(error, response);
  });
};

/**
 * Downloads the artifact list for a build and dispatches an event for each one. This lets other
 * plugins parse and process results from the build however they like.
 *
 * @method processArtifacts
 * @param job_name {String}
 * @param build {String}
 * @param pull {Object}
 */
Jenkins.prototype.processArtifacts = function(job_name, build, pull) {
  var options = {
    url: url.format({
      protocol: this.config.protocol,
      host: this.config.host,
      pathname: '/job/' + job_name + '/' + build.number + '/api/json',
      query: {
        tree: 'artifacts[fileName,relativePath]'
      }
    }),
    json: true
  };

  if (this.config.user && this.config.pass) {
    options.headers = {
      authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
    };
  }

  var self = this;
  self.request(options, function(err, response) {
    if (err) {
      self.application.log.error(err);
      return;
    }

    self.application.log.debug('Retrieved artifacts for build', { build: build.number, project: job_name });

    response.body.artifacts.forEach(function(artifact) {
      artifact.url = self.config.protocol + '://' + self.config.host + '/job/' + job_name + '/' + build.number + '/artifact/' + artifact.relativePath;

      self.application.log.debug('Found artifact for build', { build: build.number, url: artifact.url });
      self.application.emit('build.artifact_found', build, pull, artifact);
    });
  });
};

/**
 * Downloads a specific artifact and dispatches an event with its contents.
 *
 * @method downloadArtifact
 * @param build {String}
 * @param pull {Object}
 * @param url {String}
 */
Jenkins.prototype.downloadArtifact = function(build, pull, artifact) {
  var self = this,
      options = { url: artifact.url };

  if (this.config.user && this.config.pass) {
    options.headers = {
      authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
    };
  }

  self.request(options, function(err, response) {
    if (err) {
      self.application.log.error(err);
      return;
    }

    self.application.emit('build.artifact_downloaded', build, pull, artifact.relativePath, response.body);
  });
};

/**
 * Utility function to load this "plugin" into the application without having to know the object name
 */
exports.init = function(config, application, idGenerator, request) {
  return new Jenkins(config, application, idGenerator, request);
};
