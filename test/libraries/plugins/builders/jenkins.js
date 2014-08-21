"use strict";

require('replay');

var Plugin = require('../../../../libraries/plugins/builders/jenkins'),
    chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon'),
    q = require('q'),
    uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

describe('plugins/builders/jenkins', function() {
  var instance, config, sinonSandbox;

  beforeEach(function(done) {
    config = {
        host: 'test_host',
        auth: {
            project_token: 'global_project_token'
        },
        projects: {
            test_repo_string: 'string_project',
            test_repo_obj: {
                change: {
                    project: 'non_array_project'
                },
                proposal: [
                    {
                        project: 'array_project1'
                    },
                    {
                        project: 'array_project2'
                    }
                ]
            },
            test_repo_with_token: {
                project_token: 'repo_project_token',
                change: {
                    project: 'non_array_project'
                },
                proposal: [
                    {
                        project: 'array_project_no_token'
                    },
                    {
                        project: 'array_project_with_token',
                        project_token: 'project_token'
                    }
                ]
            }
        }
    };
    instance = new Plugin(config);
    sinonSandbox = sinon.sandbox.create();
    done();
  });

  afterEach(function(done) {
    sinonSandbox.restore();
    done();
  });

  describe('#validateChange', function() {
    var vcsPayload;

    beforeEach(function(done) {
      vcsPayload = require('../vcs/test_change')();
      done();
    });

    it('throws when a base param not present', function(done) {
      vcsPayload.repo = false;
      expect(instance.validateChange(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "repo"/)
      .notify(done);
    });

    it('throws when no `before` field', function(done) {
      vcsPayload.before = false;
      expect(instance.validateChange(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "before"/)
      .notify(done);
    });

    it('validates change payload', function(done) {
      expect(instance.validateChange(vcsPayload))
      .to.eventually.deep.eql(vcsPayload)
      .notify(done);
    });
  });

  describe('#validateProposal', function() {
    var vcsPayload;

    beforeEach(function(done) {
      vcsPayload = require('../vcs/test_proposal')();
      done();
    });

    it('throws when a base param not present', function(done) {
      vcsPayload.repo = false;
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "repo"/)
      .notify(done);
    });

    it('throws when no `repo_url` field', function(done) {
      vcsPayload.repo_url = false;
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "repo_url"/)
      .notify(done);
    });

    it('throws when no `base_ref` field', function(done) {
      vcsPayload.base_ref = false;
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "base_ref"/)
      .notify(done);
    });

    it('throws when no `fork_ref` field', function(done) {
      vcsPayload.fork_ref = false;
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "fork_ref"/)
      .notify(done);
    });

    it('throws when no `fork_url` field', function(done) {
      vcsPayload.fork_url = false;
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.be.rejectedWith(/missing "fork_url"/)
      .notify(done);
    });

    it('validates proposal payload', function(done) {
      expect(instance.validateProposal(vcsPayload))
      .to.eventually.deep.eql(vcsPayload)
      .notify(done);
    });
  });

  describe('#validateBuildUpdate', function() {
    var httpPayload;

    beforeEach(function(done) {
      httpPayload = { __headers: {}, build: {} };
      done();
    });

    it('throws when no __headers', function() {
      httpPayload.__headers = false;
      expect(function() { instance.validateBuildUpdate(httpPayload); })
      .to.throw(/no __headers/);
    });

    it('throws when no build', function() {
      httpPayload.build = false;
      expect(function() { instance.validateBuildUpdate(httpPayload); })
      .to.throw(/no parameters for build/);
    });

    it('throws when no build params', function() {
      expect(function() { instance.validateBuildUpdate(httpPayload); })
      .to.throw(/no parameters for build/);
    });

    it('throws when host does not match', function() {
      httpPayload.build.parameters = { host: false };
      expect(function() { instance.validateBuildUpdate(httpPayload); })
      .to.throw(/unable to determine jenkins instance/);
    });

    it('throws when no build url', function() {
      httpPayload.build.parameters = { host: 'test_host' };
      expect(function() { instance.validateBuildUpdate(httpPayload); })
      .to.throw(/no build URL/);
    });
  });

  describe('#addConfig', function() {
    var httpPayload, infoStub, debugStub, _createCfgPlStub;

    beforeEach(function() {
      infoStub = sinonSandbox.stub(instance, 'info');
      debugStub = sinonSandbox.stub(instance, 'debug');
      _createCfgPlStub = sinonSandbox.stub(
        instance,
        '_createConfigPayload',
        function() {}
      );
    });

    it('calls update config when repo project exists', function() {
      var updateConfigStub = sinonSandbox.stub(
        instance,
        'updateConfig',
        function() {}
      );
      httpPayload = { repository: 'test_repo_string' };
      instance.addConfig(httpPayload);
      expect(updateConfigStub).to.be.calledWith(httpPayload);
      expect(debugStub).to.have.been.calledOnce;
      expect(debugStub).to.have.been.calledWithMatch(/repo already exists/);
      expect(_createCfgPlStub).to.not.have.been.called;
    });

    it('actually updates config', function() {
      httpPayload = {
        repository: 'new_repo',
        project: 'new_repo_project',
        changesetType: 'change'
      };
      instance.addConfig(httpPayload);
      expect(infoStub).to.have.been.calledOnce;
      expect(_createCfgPlStub).to.have.been.calledOnce;
      expect(instance.config.projects.new_repo).to.exist;
      expect(instance.config.projects.new_repo).to.deep.equal({
        change: { project: 'new_repo_project' }
      });
    });
  });

  describe('#removeConfig', function() {
    var httpPayload, infoStub, debugStub, _createCfgPlStub;

    beforeEach(function() {
      infoStub = sinonSandbox.stub(instance, 'info');
      debugStub = sinonSandbox.stub(instance, 'debug');
      httpPayload = {
        repository: 'test_repo_string',
        changesetType: 'repo'
      };
      _createCfgPlStub = sinonSandbox.stub(
        instance,
        '_createConfigPayload',
        function() {}
      );
    });

    it('throws when non-repo changesetType received', function() {
      expect(function() {
        instance.removeConfig({ changesetType: 'foo' });
      })
      .to.throw(/feature not supported/);
    });

    it('throws when repo DNE', function() {
      expect(function() {
        instance.removeConfig({ changesetType: 'repo', repository: 'foo' });
      })
      .to.throw(/No config found/);
    });

    it('deletes configs', function() {
      instance.removeConfig(httpPayload);
      expect(infoStub).to.have.been.calledOnce;
      expect(_createCfgPlStub).to.have.been.calledOnce;
      expect(instance.config.projects.test_repo_string).to.equal(undefined);
    });
  });

  describe('#_determineBuildStatus', function() {
    var httpPayload;

    beforeEach(function(done) {
      httpPayload = { build: {} };
      done();
    });

    it('maps "STARTED" to "building"', function() {
      httpPayload.build.phase = 'STARTED';
      expect(instance._determineBuildStatus(httpPayload)).to.eql('building');
    });

    it('maps "FINIALIZED/SUCCESS" to "success"', function() {
      httpPayload.build.phase = 'FINALIZED';
      httpPayload.build.status = 'SUCCESS';
      expect(instance._determineBuildStatus(httpPayload)).to.eql('success');
    });

    it('maps "FINIALIZED/anything" to "failure"', function() {
      httpPayload.build.phase = 'FINALIZED';
      httpPayload.build.status = 'blah';
      expect(instance._determineBuildStatus(httpPayload)).to.eql('failure');
    });

    it('maps "ANYTHING" to "finishing"', function() {
      httpPayload.build.phase = 'SOMETHING';
      expect(instance._determineBuildStatus(httpPayload)).to.eql('finishing');
    });
  });

  describe('#_buildProject', function() {
    it('resolves with a build payload', function() {
      var triggerStub = sinonSandbox.stub(
            instance,
            '_triggerBuild',
            function() { return q(''); }
          ),
          project = {project: 'foobar', token: 'token'},
          payload = {repo: 'foo/bar'};
      return expect(instance._buildProject(project, payload))
      .to.eventually.be.fulfilled
      .then(function(res) {
        expect(res.artifacts).to.deep.eql({});
        expect(res.buildId).to.match(uuidRegex);
        expect(res.link).to.eql('');
        expect(res.project).to.eql('foobar');
        expect(res.repo).to.eql('foo/bar');
        expect(res.status).to.eql('queued');
        expect(res.type).to.eql('queued');
        expect(triggerStub).to.have.been.calledOnce;
      });
    });
  });

  describe('#_buildForVcs', function() {
    it('rejects when config has no projects', function(done) {
    instance = new Plugin({});
      expect(instance._buildForVcs({}))
      .to.eventually.be.rejectedWith('no projects given in config')
      .notify(done);
    });

    it('rejects when repo config DNE', function(done) {
      expect(instance._buildForVcs({repo: 'dne_repo'}))
      .to.eventually.be.rejectedWith(/associated with any projects/)
      .notify(done);
    });

    it('rejects when repo object config has no matching type', function(done) {
      expect(instance._buildForVcs({repo: 'test_repo_obj', type: 'foo'}))
      .to.eventually.be.rejectedWith(/no foo/)
      .notify(done);
    });

    it('builds when project for repo is string & vcs is a change', function() {
      var triggerSpy = sinonSandbox.stub(instance, '_buildProject', function() {
        return {test: 'single_string_project'};
      }),
      payload = {repo: 'test_repo_string', type: 'change'};

      return expect(instance._buildForVcs(payload))
      .to.eventually.be.fulfilled
      .then(function(result) {
        expect(result).to.deep.eql([{test: 'single_string_project'}]);
        expect(triggerSpy).to.have.been.calledOnce;
      });
    });

    it('builds a single project object & uses global_token', function() {
      var triggerSpy = sinonSandbox.stub(instance, '_buildProject', function(project, payload) {
        expect(project.project_token).to.eql('global_project_token');
        return {test: 'single_change_project'};
      }),
      payload = {repo: 'test_repo_obj', type: 'change'};
      return expect(instance._buildForVcs(payload))
      .to.eventually.be.fulfilled
      .then(function(result) {
        expect(result).to.deep.eql([{test: 'single_change_project'}]);
        expect(triggerSpy).to.have.been.calledOnce;
      });
    });

    it('builds an array of project objects & falls back to global_token', function() {
      var projectCount = 1,
          triggerSpy = sinonSandbox.stub(instance, '_buildProject', function(project, payload) {
            expect(project.project_token).to.eql('global_project_token');
            return {test: 'single_change_project' + projectCount++};
          }),
          payload = {repo: 'test_repo_obj', type: 'proposal'};

      return expect(instance._buildForVcs(payload))
      .to.eventually.be.fulfilled
      .then(function(result) {
        expect(result).to.deep.eql([
            {test: 'single_change_project1'},
            {test: 'single_change_project2'}
        ]);
        expect(triggerSpy).to.have.been.calledTwice;
      });
    });

    it('builds an array of project objects & falls back to global_token', function() {
      var projectCount = 1,
          triggerSpy = sinonSandbox.stub(
            instance,
            '_buildProject',
            function(project, payload) {
              expect(project.project_token).to.eql('global_project_token');
              return {test: 'single_change_project' + projectCount++};
            }
          ),
          payload = {repo: 'test_repo_obj', type: 'proposal'};

      return expect(instance._buildForVcs(payload))
      .to.eventually.be.fulfilled
      .then(function(result) {
        expect(result).to.deep.eql([
            {test: 'single_change_project1'},
            {test: 'single_change_project2'}
        ]);
        expect(triggerSpy).to.have.been.calledTwice;
      });
    });

    it('builds triggers with the correct trigger tokens', function() {
      var projectCount = 1,
          triggerSpy = sinonSandbox.stub(
            instance,
            '_buildProject',
            function(project, payload) {
              var token = project.project === 'array_project_no_token' ?
              'repo_project_token' : 'project_token';
              expect(project.project_token).to.eql(token);
              return {test: 'single_change_project' + projectCount++};
            }
          ),
          payload = {repo: 'test_repo_with_token', type: 'proposal'};

      return expect(instance._buildForVcs(payload))
      .to.eventually.be.fulfilled
      .then(function(result) {
        expect(result).to.deep.eql([
            {test: 'single_change_project1'},
            {test: 'single_change_project2'}
        ]);
        expect(triggerSpy).to.have.been.calledTwice;
      });
    });
  });
});
