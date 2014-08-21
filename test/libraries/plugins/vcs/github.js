"use strict";

var Plugin = require('../../../../libraries/plugins/vcs/github'),
    q = require('q'),
    chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon');

chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));

describe('plugins/vcs/github', function() {
  var instance, logDebugSpy, sinonSandbox, pluginConfig, repo = 'real_repo';

  beforeEach(function(done) {
    pluginConfig = {
      host: 'foo',
      port: 'bar',
      ignore_statuses: false,
      auth: {
        token: 'my_token',
        type: 'oauth',
        username: 'my_ci_user'
      },
      repos: [repo]
    };
    instance = new Plugin(pluginConfig);
    sinonSandbox = sinon.sandbox.create();
    logDebugSpy = sinonSandbox.spy(instance.log, 'debug');
    done();
  });

  afterEach(function(done) {
    sinonSandbox.restore();
    done();
  });

  describe('#init', function() {
    it('authenticates with github API', function() {
      expect(instance._api.auth).to.deep.equal(pluginConfig.auth);
    });
  });

  describe('#validatePayload', function() {
    it('throws error when no headers given', function() {
      expect(function() {
        instance.validatePayload({});
      })
      .to.throw('invalid payload - no __headers field');
    });

    it('throws error when no x-github-event header', function() {
      expect(function() {
        instance.validatePayload({ __headers: {} });
      })
      .to.throw('not a github event, ignoring');
    });

    it('throws error when unrecognized event sent', function() {
      expect(function() {
        instance.validatePayload({
          __headers: {'x-github-event': 'foo'}
        });
      })
      .to.throw(/unrecognized event/);
    });
  });

  describe('#ensureNewPull', function() {
    var testPr, statusStub;

    beforeEach(function(done) {
      testPr = require('./test_pr')();
      done();
    });

    it('respects the ignore_statuses config', function() {
      pluginConfig.ignore_statuses = true;
      instance = new Plugin(pluginConfig);
      statusStub = sinonSandbox.stub(instance, '_getShaStatus');
      return expect(instance.ensureNewPull(testPr))
      .to.eventually.be.fulfilled
      .then(function(payload) {
        expect(payload).to.deep.equal(testPr);
        expect(statusStub).to.not.have.been.called;
      });
    });

    it('rejects the PR if it has a known status', function() {
      statusStub = sinon.stub(instance, '_getShaStatus');
      statusStub.returns(q({ state: 'pending' }));
      return expect(instance.ensureNewPull(testPr))
      .to.eventually.be
      .rejectedWith(/status already created for/)
      .then(function() {
        expect(statusStub).to.be.calledOnce;
      });
    });

    it('accepts the PR if it has an empty status', function() {
      statusStub = sinon.stub(instance, '_getShaStatus');
      statusStub.returns(q({ state: null }));
      return expect(instance.ensureNewPull(testPr))
      .to.eventually.be
      .fulfilled
      .then(function(payload) {
        expect(payload).to.deep.equal(testPr);
        expect(statusStub).to.be.calledOnce;
      });
    });
  });

  describe('#generateVcsPayload', function() {
    var testPr, testPush, testComment, apiStub, newPullStub;

    beforeEach(function(done) {
      testPr = require('./test_pr')();
      newPullStub = sinonSandbox.stub(
        instance,
        'ensureNewPull',
        function(payload) {
          return q(payload);
        }
      );
      done();
    });

    describe('=> pull_request', function() {
      it('processes plain pull_request payloads', function() {
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.be.become(require('./test_proposal')());
      });

      it('accepts hook PR payloads for synchronize actions', function() {
        testPr = {
          __headers: { 'x-github-event': 'pull_request' },
          pull_request: testPr,
          action: 'synchronize'
        };
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.become(require('./test_proposal')());
      });

      it('accepts hook PR payloads for opened actions', function() {
        testPr = {
          __headers: { 'x-github-event': 'pull_request' },
          pull_request: testPr,
          action: 'opened'
        };
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.become(require('./test_proposal')());
      });

      it('rejects hook PR payloads for unrecognized actions', function() {
        testPr = {
          __headers: { 'x-github-event': 'pull_request' },
          pull_request: testPr,
          action: 'bad_event'
        };
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.be.rejectedWith(/ignoring pull action/);
      });

      it('rejects PR payloads that cannot be merged', function() {
        testPr.mergeable = false;
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.be.rejectedWith(/PR cannot be merged, ignoring/);
      });

      it('rejects PR payloads where the user specifies us to ignore', function() {
        testPr.body = '@' + pluginConfig.auth.username + ' ignore';
        return expect(instance.generateVcsPayload(testPr))
        .to.eventually.be.rejectedWith(/user requested for PR to be ignored - /);
      });
    });

    describe('=> issue_comment', function() {
      it('rejects non-PR issue comments', function() {
        testComment = {
          __headers: {'x-github-event': 'issue_comment'},
          issue: {}
        };
        return expect(instance.generateVcsPayload(testComment))
        .to.eventually.be
        .rejectedWith('Ignoring non-pull request issue notification');
      });

      it('ignores comments not directed @ CI user', function() {
        testComment = require('./test_comment')();
        testComment.comment.body = '@chr0n1x retest';
        return expect(instance.generateVcsPayload(testComment))
        .to.eventually.be
        .rejectedWith(/Not addressed @ me/);
      });

      it('ignores unknown commands', function() {
        testComment = require('./test_comment')();
        testComment.comment.body = '@' + pluginConfig.auth.username + ' ohai';
        return expect(instance.generateVcsPayload(testComment))
        .to.eventually.be
        .rejectedWith(/Ignoring unknown request: /);
      });

      it('can process issue_comment payloads', function() {
        apiStub = sinonSandbox.stub(instance, '_getPull');
        apiStub.returns(q(testPr));
        testComment = require('./test_comment')();
        testComment.comment.body = '@' + pluginConfig.auth.username + ' retest';
        return expect(instance.generateVcsPayload(testComment))
          .to.be.fulfilled
          .then(function(payload) {
            return expect(payload)
              .to.deep.equal(require('./test_proposal')());
          });
      });
    });

    describe('=> push', function() {
      it('can process push payloads', function() {
        testPush = require('./test_push')();
        return expect(instance.generateVcsPayload(testPush))
        .to.eventually.be.fulfilled
        .then(function(payload) {
          return expect(payload).to.deep.equal(require('./test_change')());
        });
      });
    });
  });

  describe('#addConfig', function() {
    var httpPayload, infoStub, debugStub, _createCfgPlStub;

    beforeEach(function() {
      infoStub = sinonSandbox.stub(instance, 'info');
      debugStub = sinonSandbox.stub(instance, 'debug');
      _createCfgPlStub = sinonSandbox.stub(instance, '_createConfigPayload');
    });

    it('throws when repo is already being tracked', function() {
      httpPayload = { repository: repo };
      expect(function() {
        instance.addConfig(httpPayload);
      }).to.throw(/already a tracked repo/);
      expect(_createCfgPlStub).to.not.have.been.called;
      expect(instance.config.repos).to.contain(repo);
    });

    it('actually updates config', function() {
      httpPayload = { repository: 'new_repo' };
      instance.addConfig(httpPayload);
      expect(infoStub).to.have.been.calledOnce;
      expect(_createCfgPlStub).to.have.been.calledOnce;
      expect(instance.config.repos).to.contain('new_repo');
    });
  });

  describe('#removeConfig', function() {
    var httpPayload, infoStub, debugStub, _createCfgPlStub;

    beforeEach(function() {
      infoStub = sinonSandbox.stub(instance, 'info');
      debugStub = sinonSandbox.stub(instance, 'debug');
      _createCfgPlStub = sinonSandbox.stub(instance, '_createConfigPayload');
      httpPayload = {
        repository: repo,
        changesetType: 'repository'
      };
    });

    it('throws when non-repo changesetType received', function() {
      expect(function() {
        instance.removeConfig({ changesetType: 'foo' });
      })
      .to.throw(/can only remove repos/);
    });

    it('throws when repo DNE', function() {
      expect(function() {
        instance.removeConfig({ changesetType: 'repository', repository: 'foo' });
      })
      .to.throw(/repo not in config/);
    });

    it('deletes configs', function() {
      instance.removeConfig(httpPayload);
      expect(infoStub).to.have.been.calledOnce;
      expect(_createCfgPlStub).to.have.been.calledOnce;
      expect(instance.config.repos).to.not.contain(repo);
    });
  });
});
