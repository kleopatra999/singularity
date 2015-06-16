"use strict";

/**
 * All callbacks must have 2 args, err & item
 */
exports.init = function(config, log) {
  if (!config) {
    return null;
  }

  var mongojs = require('mongojs');
  var collections = ["pulls", "pushes", "merges", "config"];

  var MongoDB = function() {
    this.config = config;

    this.creds = (config.auth.user) ?
                 config.auth.user + ':' + config.auth.pass : '';
    this.url = (config.auth.port) ?
               config.auth.host + ':' + config.auth.port : config.auth.host;
    this.connectionStr = (this.creds.length === 0) ? this.url : this.creds + '@' + this.url;
    this.connectionStr += '/' + config.auth.db;

    this.connection = mongojs(this.connectionStr, collections);
    this.connection.createCollection('config', {});
  };

  MongoDB.prototype.saveSingularityConfig = function(config, callback) {
    this.connection.config.remove({}, function(err) {
      if (err) {
        log.error('failed to update config', err);
        return;
      }
    });
    this.connection.config.insert(config, callback);
  };

  MongoDB.prototype.getSingularityConfig = function(callback) {
    this.connection.config.findOne({}, callback);
  };

  MongoDB.prototype.insertMerge = function(merge, callback) {
    this.connection.merges.insert({
      organization: merge.organization,
      repo: merge.repo,
      number: merge.number,
      merger: merge.merger,
      result: merge.result
    }, callback);
  };

  MongoDB.prototype.findPush = function(repo, ref, head, callback) {
    this.connection.pushes.findOne({ repo: repo, ref: ref, sha: head }, callback);
  };

  MongoDB.prototype.insertPush = function(push, callback) {
    this.connection.pushes.insert({
      repo: push.repository.name,
      ref: push.ref,
      sha: push.after,
    }, callback);
  };

  MongoDB.prototype.findPull = function(pull_number, pull_repo, callback) {
    this.connection.pulls.findOne({ number: pull_number, repo: pull_repo }, callback);
  };

 MongoDB.prototype.findPullByID = function(pull_id, callback) {
    pull_id = parseInt(pull_id),

    // Check for record with new pull_id field
    this.connection.pulls.findOne({ pull_id: pull_id }, function(err, item) {

      // If not found, check for record with old opening_event.id field
      if (!item) {
        log.debug('pull_request with pull_id field for ' + pull_id + ' not found');
        log.debug('checking using old style opening_event.id field');
        this.connection.pulls.findOne({ 'opening_event.id': pull_id }, callback);
      }
      else {
        callback(err, item);
      }

    }.bind(this));
  };

  MongoDB.prototype.findPullByRepoId = function(pull_number, pull_repo_id, callback) {
    pull_number = parseInt(pull_number);
    pull_repo_id = parseInt(pull_repo_id);
    this.connection.pulls.findOne({ number: pull_number, repo_id: pull_repo_id }, callback);
  };

  MongoDB.prototype.updatePull = function(pull_number, pull_repo, update_columns, callback) {
    this.connection.pulls.update({ number: pull_number, repo: pull_repo }, { $set: update_columns }, callback);
  };

  MongoDB.prototype.insertPull = function(pull, callback) {
    this.connection.pulls.insert({
      number: pull.number,
      repo_id: pull.base.repo.id,
      repo: pull.repo,
      pull_id: pull.id,
      created_at: pull.created_at,
      updated_at: pull.updated_at,
      head: pull.head.sha,
      merged: false,
      status: 'open',
      merge_result: null,
      files: pull.files,
      opening_event: pull
    }, callback);
  };

  MongoDB.prototype.findRepoPullsByStatuses = function(params, callback) {
    var repo = params.repo,
        sort = params.sort && ('ascending' === params.sort) ? 1 : -1,
        statuses = params.statuses ? params.statuses.split(',') : ['open'];

    if (!repo) {
      callback('no repo given, or invalid value', null);
      return;
    }

    this.connection.pulls.find({ repo: repo, status: { $in: statuses } })
                         .sort([['_id', sort]])
                         .forEach(callback);
  };

  MongoDB.prototype.findByJobStatus = function(statuses, callback) {
    this.connection.pulls.find({ 'jobs.status': { $in: statuses }}).forEach(callback);
  };

  MongoDB.prototype.findPushJobsByStatus = function(statuses, callback) {
    this.connection.pushes.find({ 'job.status': { $in: statuses } }).forEach(callback);
  };

  MongoDB.prototype.insertJob = function(pull, job) {
    if (typeof pull.jobs === 'undefined') {
      pull.jobs = [];
    }

    pull.jobs.push(job);

    this.updatePull(pull.number, pull.repo, { jobs: pull.jobs });
  };

  MongoDB.prototype.insertPushJob = function(push, job_id) {
    var query = {
      ref: push.ref,
      repo: push.repository.name,
      sha: push.after
    };
    this.findPush(push.repository.name, push.ref, push.after, function(err, res) {
      // something went terribly wrong, SHOULD die
      if (err) {
        log.error('failed to insert a push job', err);
        process.exit(1);
      }

      this.connection.pushes.update(query, { $set: { 'job.id': job_id, 'job.result': 'BUILDING', 'job.status': 'new' } });
    }.bind(this));
  };

  MongoDB.prototype.updatePushJobStatus = function(job_id, status, result, callback) {
    this.connection.pushes.update({ 'job.id': job_id }, { $set: { 'job.status': status, 'job.result': result }}, callback);
  };

  MongoDB.prototype.updatePRJobStatus = function(job_id, status, result, callback) {
    this.connection.pulls.update({ 'jobs.id': job_id }, { $set: { 'jobs.$.status': status, 'jobs.$.result': result }}, callback);
  };

  MongoDB.prototype.insertLineStatus = function(pull, filename, line_number) {
    this.connection.pulls.update({ _id: pull.number, 'files.filename': filename }, { $push: { 'files.$.reported': line_number } });
  };

  return new MongoDB();
};
