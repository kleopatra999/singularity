var GitHubApi = require('github'),
    q = require('q'),
    allowed_events = ['issue_comment', 'pull_request', 'push'],
    allowed_pr_actions = ['synchronize', 'opened'],
    shaStatuses = ['pending', 'success', 'error', 'failure'];

/**
 * Given a PR, returns a string that represents its state that is recognized by
 * the rest of the system (via the VCS payload)
 *
 * @param {Object} pull Raw github event
 * @return {String} state
 */
function statusOfPull(pull) {
  // During testing there were cases where the mergeable flag was null when using
  // webhooks. We only want to return 'merged' when explicitly set to true
  if (pull.merged) {
    return 'merged';
  }
  return pull.state;
}

/**
 * Generates a VCS Payload from a push
 *
 * @param {Object} push github push payload
 * @return {Object} VCS Payload
 */
function payloadFromPush(push) {
  return {
    repo: push.repository.owner.name + '/' + push.repository.name,
    before: push.before,
    after: push.after,
    actor: push.pusher.name,

    repo_url: push.repository.url,
    base_ref: push.ref,
    fork_url: null,
    fork_ref: null,

    status: null,
    repo_id: push.repository.id,
    change: push.compare.split('/').pop(),
    change_id: push.after,
    type: 'change'
  };
}

/**
 * Generates a VCS Payload from a RAW pull_request (not a webhook payload)
 * ie: webhook_payload.pull_request, not webhook_payload
 *
 * @return {Object} VCS Payload
 */
function payloadFromPull(pull) {
  return {
    repo: pull.base.repo.full_name,
    before: pull.base.sha,
    after: pull.head.sha,
    actor: pull.user.login,

    repo_url: pull.base.repo.ssh_url,
    base_ref: pull.base.ref,
    fork_url: pull.head.repo.ssh_url,
    fork_ref: pull.head.ref,

    status: statusOfPull(pull),
    repo_id: pull.base.repo.id,
    change: pull.number,
    change_id: pull.id,
    type: 'proposal'
  };
}

/**
 * Checks & validates pull object, whether it should be ignored
 */
function validateAndStandardizePull(pull, auth_user) {
  var pr_name;
  // decide whether this came from a webhook or an API call made internally
  if (pull.pull_request) {
    pr_name = pull.pull_request.base.repo.full_name +
              ' #' + pull.pull_request.number;
    if (!~allowed_pr_actions.indexOf(pull.action)) {
      throw 'ignoring pull action [' + pull.action + '] for ' + pr_name;
    }
    pull = pull.pull_request;
  }

  pr_name = pull.base.repo.full_name + ' #' + pull.number;

  if (pull.mergeable === false) {
    throw 'PR cannot be merged, ignoring ' + pr_name;
  }
  if (pull.body && ~pull.body.indexOf('@' + auth_user + ' ignore')) {
    throw 'user requested for PR to be ignored - ' + pr_name;
  }
  return pull;
}

/**
 * Determines if the issue_comment is valid & directed @ me
 *
 * @param {Object} comment github issue_comment payload
 * @throws String on validation error
 */
function validateCommentPayload(comment, auth_user) {
  if (!comment.issue.pull_request ||
      comment.issue.pull_request.html_url == null) {
    throw 'Ignoring non-pull request issue notification';
  }

  var commentArray = comment.comment.body.split(' '),
      addressedIndex = commentArray.indexOf('@' + auth_user),
      command = commentArray[addressedIndex + 1];

  if (!~addressedIndex) {
    throw 'Not addressed @ me';
  }
  if (command !== 'retest') {
    throw "Ignoring unknown request: " + comment.comment.body;
  }
}

/**
 * MUST BIND `this` to this function! Not in object because this is not something
 * that should be exposed, but this needs access to an _api instance that has
 * authenticated.
 *
 * Generates a VCS Payload from a comment.
 *
 * @param {Object} comment github issue_comment payload
 * @return {Object} from payloadFromPull
 */
function pullFromComment(comment, auth_user) {
  return q([comment, auth_user])
  .spread(validateCommentPayload)
  .then(function() {
    this.debug(
      'Received retest request for pull',
      {
        pull_number: comment.issue.number,
        repo: comment.repository.name
      }
    );

    return this._getPull({
      user: comment.repository.owner.login,
      repo: comment.repository.name,
      number: comment.issue.number
    });
  }.bind(this))
  .then(payloadFromPull);
}

/**
 * Github VCS plugin
 */
module.exports = require('../plugin').extend({
  name: 'github',

  /**
   * @param {Object} payload Raw github PR payload object
   * @return {Promise} Github status object for the fork SHA
   */
  _getShaStatus: function(payload) {
    var query = {
      user: payload.base.user.login,
      repo: payload.base.repo.name,
      sha: payload.head.sha
    };
    return q.ninvoke(this._api.statuses, 'get', query)
    .then(function(statuses) {
      if (statuses && statuses[0]) {
        return statuses[0];
      }
      throw 'no statuses found for ' + JSON.stringify(query);
    });
  },

  /**
   * Util function to wrap API calls to get PR data
   * also makes other functions a bit easier to test
   * Forces the user to create a query object because the params
   * may be vastly different, depending on the type of payload
   *
   * @param {Object} query containing `user`, `repo`, `number`
   * @return {Promise} that resolves with a Github PR payload
   */
  _getPull: function(query) {
    var reqPromise = q.defer();

    q.ninvoke(this._api.pullRequests, 'get', query)
    .done(function(pull) {
      if (!pull) {
        reqPromise.reject(
          'could not get PR for issue_comment; ' +
          JSON.stringify(query)
        );
        return;
      }
      reqPromise.resolve(pull);
    },
    function(reason) {
      reqPromise.reject(reason);
    });

    return reqPromise.promise;
  },

  /**
   * Called via plugin / nbd/Class
   *
   * @param {Object} option
   */
  init: function(option) {
    this._super(option);
    this._api = new GitHubApi({
      version: '3.0.0',
      host: option.host,
      port: option.port
    });
    this._api.authenticate(this.config.auth);
  },

  addConfig: function(pl) {
    if (~this.config.repos.indexOf(pl.repository)) {
      throw pl.repository + ' already a tracked repo';
    }
    this.info('adding repo', pl.repository);
    this.config.repos.push(pl.repository);

    return this._createConfigPayload();
  },

  removeConfig: function(pl) {
    if (pl.changesetType !== 'repo') {
      throw 'can only remove repos, requested to remove ' + pl.changesetType;
    }
    if (!~this.config.repos.indexOf(pl.repository)) {
      throw 'github repo not in config: ' + pl.repository;
    }
    this.info('removing repo', pl.repository);
    this.config.repos.splice(this.config.repos.indexOf(pl.repository), 1);

    return this._createConfigPayload();
  },

  updateConfig: function(pl) {
    this.debug(
      'request to update received, redirecting to "add"',
      this.logForObject(pl)
    );
    return this.addConfig(pl);
  },

  /**
   * Validates that a given payload is ok to parse / use, returns it
   *
   * @param {Object} payload Raw github event with a __headers array appended from
   *                         the HTTP Payload object
   * @return {Object} the same payload
   */
  validatePayload: function(payload) {
    if (!payload.__headers) {
      throw 'invalid payload - no __headers field';
    }
    if (!payload.__headers['x-github-event']) {
      throw 'not a github event, ignoring';
    }
    if (!~allowed_events.indexOf(payload.__headers['x-github-event'])) {
      throw 'unrecognized event "' +
        payload.__headers['x-github-event'] +
        '"';
    }
    return payload;
  },

  /**
   * Gets the latest status of a given PR github event
   *
   * @param {Object} payload Raw github event
   * @return {Promise} resolves with the payload after validation
   */
  ensureNewPull: function(payload) {
    if (this.config.ignore_statuses) {
      return q(payload);
    }
    return this._getShaStatus(payload)
    .then(function(latestStatus) {
      if (~shaStatuses.indexOf(latestStatus.state)) {
        throw 'status already created for ' +
          payload.base.repo.full_name + ' #' + payload.number;
      }
    })
    .thenResolve(payload);
  },

  /**
   * Required for Singularity VCS adapter API
   *
   * @param {Object} payload raw github event
   * @return {Promise} resolves with an internal VCS payload
   */
  generateVcsPayload: function(payload) {
    var event = payload.__headers['x-github-event'],
    auth_user = this.config.auth.username;

    if (event === 'issue_comment') {
      // yes, returns a promise
      return pullFromComment.call(this, payload, auth_user);
    }
    if (event === 'pull_request') {
      // called because there is a *slight* difference between hook pull_request
      // objects and ones pulled directly from the API
      return q([payload, auth_user])
      .spread(validateAndStandardizePull)
      .then(this.ensureNewPull.bind(this))
      .then(payloadFromPull);
    }
    if (event === 'push') {
      return q(payload).then(payloadFromPush);
    }

    throw 'invalid payload ' + JSON.stringify(payload).substring(0, 64) + '...';
  },

  /**
   * Iterates over the configured list of repositories and uses
   * the GitHub API to check each one for pull requests.
   *
   * TODO: OHHHH MY GODDDD WHYYY
   *
   * @method pollRepos
   */
  pollRepos: function() {
    var pullList = [];
    return q.allSettled(this.config.repos.map(function(repo) {
      var repo_owner = repo.split('/')[0],
      repo_name = repo.split('/')[1];
      // Getting PRs for each repo
      return q.ninvoke(this._api.pullRequests, 'getAll', {
        user: repo_owner,
        repo: repo_name,
        state: 'open'
      })
      .then(function getPRs(resp) {
        return q.allSettled(Object.keys(resp)
        .map(function(i) { return resp[i]; })
        .filter(function(pull) {
          return pull.number && pull.number !== 'undefined';
        })
        .map(function getPRDetails(pull) {
          // Currently the GitHub API doesn't provide the same information for
          // polling as it does when requesting a single, specific, pull request
          return this._getPull({
            user: repo_owner,
            repo: repo_name,
            number: pull.number
          })
          .then(function(pull) {
            return pull;
          });
        }, this))
        .then(function fulfilledRequests(promiseSnapshots) {
          return promiseSnapshots.filter(function(snapshot) {
            return snapshot.state === 'fulfilled';
          })
          .map(function(snapshot) {
            return snapshot.value;
          });
        });
      }.bind(this))
      .then(function composePrList(repoPulls) {
        pullList = pullList.concat(repoPulls);
      });
    }, this))
    // have all values of promises that got PR details
    // (composed in pullList)
    .then(function buildVcsPayloads() {
      return q.all(
        pullList.map(function(pull) {
          return q(pull)
          .then(this.ensureNewPull.bind(this))
          .then(payloadFromPull)
          .catch(this.error);
        }.bind(this))
      )
      // filter out any undefined vals
      .then(function(allPayloads) {
        return allPayloads.filter(function(payload) {
          return !!payload;
        });
      });
    }.bind(this));
  }
});
