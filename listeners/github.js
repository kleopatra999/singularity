/**
 * The GitHub integration plugin
 * @module GitHub
 */
"use strict";

var async = require('async'),
    Emitter = require('events').EventEmitter,
    GitHubApi = require('github');

/**
 * @class GitHub
 * @param config {Object} The plugins configs
 * @param application {application} An instance of the main application object
 * @param events {Object} An EventDispatcher instance used when handling webhook events
 * @constructor
 */
var GitHub = function(config, application, events) {
  var self = this;

  config.api = config.api || {};

  self.config = config;
  self.application = application;
  self.events = events || new Emitter();
  self.api = new GitHubApi({
    version: '3.0.0',
    host: config.api.host || null,
    port: config.api.port || null
  });

  self.api.authenticate(config.auth);

  self.application.on('github.config_reload', function(new_config) {
    self.config = new_config;
    self.application.log.info('github: reloaded config');
    self.application.emit('singularity.configuration.updated', 'github');
  });

  self.application.on('github.new_repo', function(repo) {
    self.setupRepoHook(repo, function(err, res) {
      // log error but still store repo - no harm & makes it easier to sync up configs between plugins
      if (err) {
        self.application.log.error(err, res);
      }

      // yay for references - directly updates in application config :|
      self.config.repos.push(repo);
      self.application.log.info('Github Listener: updated config & hook', { repo: repo, api_res: res });
      self.application.emit('singularity.configuration.updated', 'github');
    });
  });

  self.application.on('pull.validated', function(pull) {
    self.processPull(pull);
  });

  self.application.on('build.queued', function(job, pull, build_url) {
    self.createStatus(job.head, config.user, pull.repo, 'pending', build_url, 'Singularity Build Queued');
  });

  self.application.on('build.started', function(job, pull, build_url) {
    self.createStatus(job.head, config.user, pull.repo, 'pending', build_url, 'Singularity Build Started');
  });

  self.application.on('build.failure', function(job, pull, build_url) {
    self.createStatus(job.head, config.user, pull.repo, 'failure', build_url, 'Singularity Build Failed');
  });

  self.application.on('build.success', function(job, pull, build_url) {
    self.createStatus(job.head, config.user, pull.repo, 'success', build_url, 'Singularity Build Succeeded');
  });

  self.application.on('build.aborted', function(job, pull, build_url) {
    self.createStatus(job.head, config.user, pull.repo, 'error', build_url, 'Singularity Build Aborted');
  });

  self.application.on('pull.inline_status', function(pull, sha, file, position, comment) {
    self.createComment(pull, sha, file, position, comment) ;
  });

  self.application.on('pull.status', function(pull, comment) {
    self.createComment(pull, comment);
  });

  self.application.on('issue_comment', function(data) {
    self.handleIssueComment(data);
  });

  self.application.on('push', function(data) {
    self.handlePush(data);
  });

  self.application.on('pull_request', function(pull) {
    self.handlePullRequest(pull);
  });

  self.application.on('pull.comment', function(meta) {
    self.commentOnPr(meta);
  });

  self.events.on('pull_request', function(pull) {
    self.handlePullRequest(pull);
  });
};

GitHub.prototype.commentOnPr = function(meta) {
  var self = this;
  self.api.issues.createComment({
    user: meta.organization,
    repo: meta.repo,
    number: meta.pull_request,
    body: meta.message
  },
  function(err, res) {
    if (err) {
      self.log.error('error while creating comment', err);
      return;
    }
  });
};

/**
 * Sets up the GitHub plugin. Depending on the selecting configs either a webserver
 * will be setup for receiving webhook events or asynchronous polling will be setup.
 *
 * @method start
 */
GitHub.prototype.start = function() {
  if (!this.application.db) {
    this.application.log.error('Github Listener: missing app db... (╯°□°）╯︵ ┻━┻');
    return this;
  }

  if (this.config.method === 'hooks') {
    this.checkRepos();
  }
  else {
    var self = this;
    async.parallel({
      github: function() {
        var run_github = function() {
          self.checkRepos();
          setTimeout(run_github, self.config.frequency);
        };

        run_github();
      }
    });
  }

  return this;
};

/**
 * Iterates over the configured list of repositories and uses the GitHub API to check each one for pull requests.
 *
 * @method checkRepos
 */
GitHub.prototype.checkRepos = function() {
  this.application.log.debug('Polling github for new and updated Pull Requests');

  var self = this,
      emitPrFound = function(error, pull) {
        if (error) {
          self.application.log.error(error);
          return;
        }

        self.events.emit('pull_request', pull);
      };
  this.config.repos.forEach(function(repo) {
    self.api.pullRequests.getAll({ user: self.config.user, repo: repo, state: 'open' }, function(error, resp) {
      if (error) {
        self.application.log.error(error);
        return;
      }

      for (var i in resp) {
        var pull = resp[i],
        number = pull.number;

        if (!number || number === 'undefined') {
          continue;
        }

        // Currently the GitHub API doesn't provide the same information for polling as
        // it does when requesting a single, specific, pull request. So we have to
        self.api.pullRequests.get({user: self.config.user, repo: repo, number: number}, emitPrFound);
      }
    });
  });
};

/**
 * Uses the GitHub API to pull the list of files and diffs for the provided pull request.
 * These will be parsed and saved on the pull object to be saved to the database later.
 *
 * @method checkFiles
 * @param pull {Object}
 */
GitHub.prototype.checkFiles = function(pull) {
  this.application.log.debug('Checking files for pull request', { pull_number: pull.number, repo: pull.repo });

  var self = this;
  this.api.pullRequests.getFiles({ user: this.config.user, repo: pull.repo, number: pull.number }, function(err, files) {
    if (err) {
      self.application.log.error(err);
      return;
    }

    pull.files = [];
    files.forEach(function(file) {
      if (!file.filename || file.filename === 'undefined') {
        return;
      }

      var start = null,
          length = null,
          deletions = [],
          modified_length,
          offset = 0,
          line_number = 0;

      file.ranges = [];
      file.reported = [];
      if (!!!file.blob_url) {
        return;
      }
      file.sha = file.blob_url.match(/blob\/([^\/]+)/)[1];

      // The GitHub API doesn't return the actual patch when it's exceedingly large
      if (file.patch) {
        file.patch.split('\n').forEach(function(line) {
          var matches = line.match(/^@@ -\d+,\d+ \+(\d+),(\d+) @@/);
          if (matches) {
            if (start == null && length == null) {
              start = parseInt(matches[1], 10);
              length = parseInt(matches[2], 10);
              line_number = start;
            }
            else {
              // The one is for the line in the diff block containing the line numbers
              modified_length = 1 + length + deletions.length;
              file.ranges.push([start, start + length, modified_length, offset, deletions]);

              deletions = [];
              start = parseInt(matches[1], 10);
              length = parseInt(matches[2], 10);
              offset += modified_length;
              line_number = start;
            }
          }
          else if (line.indexOf('-') === 0) {
            deletions.push(line_number);
          }
          else {
            line_number += 1;
          }
        });
      }

      if (start != null && length != null) {
        file.ranges.push([start, start + length, 1 + length + deletions.length, offset, deletions]);
      }

      pull.files.push(file);
    });

    if (pull.files.length > 0) {
      self.application.emit('pull.found', pull);
    }
    else {
      self.application.log.info('Skipping pull request, no modified files found', { pull_number: pull.number, repo: pull.repo });
    }
  });
};

/**
 * Starts the process of processing a pull request. Will retrieve the pull request from the database or insert a new
 * record for it if needed. The pull request is then checked to see if it should be processed or not and dispatches
 * the appropriate event if so.
 *
 * @method processPull
 * @param pull {Object}
 */
GitHub.prototype.processPull = function(pull) {
  var self = this;
  this.application.db.findPull(pull.number, pull.repo, function(error, item) {
    if (!pull.head || !pull.head.repo) {
      self.application.log.error('Skipping pull request, invalid payload given', { pull_number: pull.number, repo: pull.repo });
      return;
    }

    var new_pull = false,
        ssh_url = pull.head.repo.ssh_url,
        branch = pull.head.ref;

    if (!item) {
      new_pull = true;
      self.application.db.insertPull(pull, function(err) {
        if (err) {
          self.application.log.error(err);
          process.exit(1);
        }
      });
      pull.jobs = [];
    }
    else {
      // Before updating the list of files in db we need to make sure the set of reported lines is saved
      item.files.forEach(function(file) {
        pull.files.forEach(function(pull_file, i) {
          if (pull_file.filename === file.filename) {
            pull.files[i].reported = file.reported;
          }
        });
      });
      self.application.db.updatePull(pull.number, pull.repo, { files: pull.files });
      pull.jobs = item.jobs;
    }

    if (new_pull || pull.head.sha !== item.head) {
      self.application.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
      return;
    }

    if (typeof pull.skip_comments !== 'undefined' && pull.skip_comments) {
      self.application.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
      return;
    }

    self.api.issues.getComments({
      user: self.config.user,
      repo: pull.repo,
      number: pull.number,
      per_page: 100
    },
    function(error, resp) {
      for (var i in resp) {
        if (i === 'meta') {
          continue;
        }

        var comment = resp[i];
        if (
          self.config.retry_whitelist &&
          self.config.retry_whitelist.indexOf(comment.user.login) === -1 &&
          comment.user.login !== pull.head.user.login
          ) {
          continue;
        }

        if (comment.created_at > item.updated_at && comment.body.indexOf('@' + self.config.auth.username + ' retest') !== -1) {
          self.application.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
          return;
        }
      }
    });
  });
};

/**
 * Uses the GitHub API to create a Merge Status for a pull request.
 *
 * @method createStatus
 * @param sha {String}
 * @param user {String}
 * @param repo {String}
 * @param state {String}
 * @param build_url {String}
 * @param description {String}
 */
GitHub.prototype.createStatus = function(sha, user, repo, state, build_url, description) {
  var self = this,
      args = arguments,
      status = {
          user: user,
          repo: repo,
          sha: sha,
          state: state,
          context: 'singularity-ci',
          description: description
      };

  if (build_url) {
    status.target_url = build_url;
  }

  self.application.log.info('creating status ' + state + ' for sha ' + sha + ' for build_url ' + build_url);

  this.api.statuses.create(
    status,
    function(error) {
      if (error) {
        self.application.log.error(error);
        self.application.log.error(args);
        return;
      }
    }
  );
};

/**
 * Uses the GitHub API to create an inline comment on the diff of a pull request.
 *
 * @method createComment
 * @param pull {Object}
 * @param sha {String}
 * @param file {String}
 * @param position {String}
 * @param comment {String}
 */
GitHub.prototype.createComment = function(pull, sha, file, position, comment) {
  if (!file && !position && !comment) {
    this.api.issues.createComment({
      user: this.config.user,
      repo: pull.repo,
      number: pull.number,
      body: sha
    });
  }
  else {
    this.api.pullRequests.createComment({
      user: this.config.user,
      repo: pull.repo,
      number: pull.number,
      body: comment,
      commit_id: sha,
      path: file,
      position: position
    });
  }
};

/**
 * Receives a pull request at the very beginning of the process, either from a webhook event or from the REST API,
 * and checks to make sure we care about it.
 *
 * @method handlePullRequest
 * @param pull {Object}
 */
GitHub.prototype.handlePullRequest = function(pull) {
  // Check if this came through a webhooks setup
  if (pull.action !== undefined) {
    var base_repo_name = pull.pull_request.base.repo.name;

    if (pull.action === 'closed') {
      this.application.db.updatePull(pull.number, base_repo_name, { status: pull.action });
      if (pull.pull_request.merged) {
        this.application.log.debug('pull was merged, skipping');
        this.application.emit('pull.merged', pull);
        this.application.db.updatePull(pull.number, base_repo_name, { status: 'merged' });
      }
      else {
        this.application.log.debug('pull was closed, skipping');
        this.application.emit('pull.closed', pull);
      }

      return;
    }

    if (pull.action !== 'synchronize' && pull.action !== 'opened') {
      this.application.log.debug('Not building pull request, action not supported', { pull_number: pull.number, action: pull.action });
      return;
    }

    pull = pull.pull_request;
  }

  // During testing there were cases where the mergeable flag was null when using webhooks.
  // In that case we want to allow the build to be attempted. We only want to prevent it when
  // the mergeable flag is explicitly set to false.
  if (pull.mergeable !== undefined && pull.mergeable === false) {
    this.application.log.debug('Not building pull request, not in mergeable state', { pull_number: pull.number, mergeable: pull.mergeable });
    return;
  }

  if (pull.body && pull.body.indexOf('@' + this.config.user + ' ignore') !== -1) {
    this.application.log.debug('Not building pull request, flagged to be ignored', { pull_number: pull.number });
    return;
  }

  pull.repo = pull.base.repo.name;
  if (this.config.skip_file_listing) {
    this.application.log.debug('skipping file listing for PR');
    pull.files = [];
    this.application.emit('pull.found', pull);
  }
  else {
    this.checkFiles(pull);
  }
};

/**
 * Receives an issue comment from a webhook event and checks to see if we need to worry about it. If so the
 * associated pull request will be loaded via the REST API and sent on its way for processing.
 *
 * @method handleIssueComment
 * @param comment {Object}
 */
GitHub.prototype.handleIssueComment = function(comment) {
  // This event will pick up comments on issues and pull requests but we only care about pull requests
  if (comment.issue.pull_request.html_url == null) {
    this.application.log.debug('Ignoring non-pull request issue notification');
    return;
  }

  if (comment.comment.body.indexOf('@' + this.config.auth.username + ' retest') !== -1) {
    this.application.log.debug('Received retest request for pull', { pull_number: comment.issue.number, repo: comment.repository.name });

    var self = this;
    this.api.pullRequests.get({user: this.config.user, repo: comment.repository.name, number: comment.issue.number}, function(error, pull) {
      if (error) {
        self.application.log.error(error);
        return;
      }

      pull.skip_comments = true;
      self.events.emit('pull_request', pull);
    });
  }
};

/**
 * Processes & validates push events
 *
 * @method handlePush
 * @param payload {Object}
 */
GitHub.prototype.handlePush = function(payload) {
  var self = this;

  if (!payload.repository.name || !payload.ref || !payload.before || !payload.after || !payload.pusher.name || !payload.pusher.email) {
    self.application.log.error('Invalid push payload event', payload);
    return;
  }

  self.application.db.findPush(payload.repository.name, payload.ref, payload.after, function(err, item) {
    var log_item = { repo: payload.repository.name, ref: payload.ref, sha: payload.after };

    if (err) {
      self.application.log.error(err);
      return;
    }

    if (item) {
      self.application.log.debug('Push event already triggered.', log_item);
      return;
    }

    self.application.log.debug('Push event found', log_item);
    self.application.db.insertPush(payload, function(err, res) {
      if (err) {
        self.application.log.error(err);
        return;
      }
      self.application.emit('push.found', payload);
    });
  });
};

/**
 * Create / configure webhooks for a given list of repos
 *
 * @method setupRepoHook
 * @param repos {Array}
 */
GitHub.prototype.setupRepoHook = function(repo, callback) {
  var self = this;

  if (self.config.repos.indexOf(repo) !== -1) {
    callback('repo already configured', null);
    return;
  }

  self.createWebhook(repo, function(err, res) {
    if (err) {
      callback('Failed to create webhook', { repo: repo, error: err });
      return;
    }

    callback(null, res);
  });
};

/**
 * Create webhook for a given repo
 *
 * @method createWebhook
 * @param repo {String}
 */
GitHub.prototype.createWebhook = function(repo, callback) {
  var self = this;

  self.api.repos.createHook({
      user: self.config.user,
      repo: repo,
      name: 'web',
      active: true,
      events: [
        'pull_request',
        'issue_comment',
        'push'
      ],
      config: {
        url: self.application.getDomain(),
        content_type: 'json'
      }
    },
    function(err, res) {
      callback(err, res);
    }
  );
};

/**
 * Utility function to load this "plugin" into the application without having to know the object name
 */
exports.init = function(config, application, emitter) {
  return new GitHub(config, application, emitter);
};
