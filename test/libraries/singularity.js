var chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon'),
    Singularity = require('../../libraries/singularity');

chai.use(require('sinon-chai'));

describe('libraries/singularity', function() {
  var test = this,
      checkSparseConfig = function(config) {
        expect(config).to.have.keys(['github', 'jenkins']);

        expect(config.github).to.have.keys(['ci_user', 'repositories']);
        expect(config.github.ci_user).to.be.false;
        expect(config.github.repositories).to.be.an('Array');
        expect(config.github.repositories).to.be.empty;

        expect(config.jenkins).to.have.keys(['has_global_trigger_token', 'projects', 'push_projects']);
        expect(config.jenkins.has_global_trigger_token).to.be.false;
        expect(config.jenkins.projects).to.be.an('Array');
        expect(config.jenkins.projects).to.be.empty;
        expect(config.jenkins.push_projects).to.be.an('Array');
        expect(config.jenkins.push_projects).to.be.empty;
      };

  beforeEach(function(done) {
    test.log = {
      error: function() {},
      debug: function() {},
      info: function() {}
    };

    test.config = require('../../config.js').config;
    // don't want to test the db...
    test.config.db = null;
    done();
  });

  describe('getDomain', function() {
    it('builds default domain correctly', function() {
      var app = new Singularity({}, test.log);

      expect(app.getDomain()).to.equal('localhost:80');
    });

    it('can take host & endpoint overrides', function() {
      var app = new Singularity({ host: 'blah', port: '8889' }, test.log);

      expect(app.getDomain()).to.equal('blah:8889');
    });
  });

  describe('getConfig', function(done) {
    it('sets defaults correctly', function() {
      checkSparseConfig(new Singularity({}, test.log).getConfig());
    });

    it('filters data correctly', function() {
      // rebind values so it's easier to test...
      // todo: really think of a better way to do this
      test.config.plugins.jenkins.push_projects = {
        test_repo: {
          name: 'test_job'
        }
      };
      var instanceCfg = test.config;

      instanceCfg.persist_config = false;

      var config = new Singularity(instanceCfg, test.log).getConfig();

      expect(config).to.have.keys(['github', 'jenkins']);
      expect(config.github).to.have.keys(['ci_user', 'repositories']);
      expect(config.github.ci_user).to.equal(test.config.plugins.github.auth.username);
      expect(config.github.repositories).to.deep.equal(test.config.plugins.github.repos);
    });

    // a stupid bug where `config` was used instead of `app.config`
    it('does not reference old config after update', function() {
      var instance = new Singularity({}, test.log);
      instance.config.plugins.github.repos.push('new_test_repo');

      expect(instance.getConfig().github.repositories).to.contain('new_test_repo');
    });
  });

  describe('addRepo', function() {
    var self = this,
        config = {
          plugins: {
            github: {
              repos: ['test_repo']
            }
          }
        };

    beforeEach(function(done) {
      self.app = new Singularity(config, test.log);
      self.logSpy = sinon.spy(),
      self.emitSpy = sinon.spy();
      sinon.stub(self.app.log, 'info', self.logSpy);
      sinon.stub(self.app, 'emit', self.emitSpy);

      done();
    });

    it('does not update when repo is already in github config', function() {
      var args = { repo: 'test_repo', project: 'test_repo_project' };
      expect(self.app.addRepo(args)).to.be.false;
      expect(self.logSpy).to.have.been.calledWithExactly('duplicate github repo', args);
      expect(self.emitSpy).to.not.have.been.called;
    });

    it('updated config when new repo is added', function() {
      var args = { repo: 'new_test_repo', project: 'new_test_project' };
      expect(self.app.addRepo(args)).to.be.true;
      expect(self.emitSpy).to.have.been.calledWithExactly('github.new_repo', 'new_test_repo');
    });

  });

  describe('addRepoPRJob', function() {
    var self = this,
        config = {
          plugins: {
            github: {
              repos: ['test_repo']
            },
            jenkins: {
              projects: [
                {
                  repo: 'test_repo',
                  name: 'test_repo_project'
                },
                {
                  repo: 'test_repo2',
                  name: 'test_repo2_project'
                }
              ]
            }
          }
        };

    beforeEach(function(done) {
      self.app = new Singularity(config, test.log);
      self.logSpy = sinon.spy(),
      self.emitSpy = sinon.spy();
      sinon.stub(self.app.log, 'info', self.logSpy);
      sinon.stub(self.app, 'emit', self.emitSpy);

      done();
    });

    it('does not update when repo is already in a jenkins config', function() {
      var args = { repo: 'test_repo2', project: 'new_test_repo2_project' };
      expect(self.app.addRepoPRJob(args)).to.be.false;
      expect(self.logSpy).to.have.been.calledWithExactly('duplicate jenkins repo or project', args);
      expect(self.emitSpy).to.not.have.been.called;
    });

    it('does not update when project is already in a jenkins config', function() {
      var args = { repo: 'new_test_repo', project: 'test_repo2_project' };
      expect(self.app.addRepoPRJob(args)).to.be.false;
      expect(self.logSpy).to.have.been.calledWithExactly('duplicate jenkins repo or project', args);
      expect(self.emitSpy).to.not.have.been.called;
    });

    it('actually updates properly', function() {
      var args = { repo: 'new_test_repo', project: 'new_test_project' },
          spy = sinon.spy();

      sinon.stub(self.app, 'addRepo', spy);

      expect(self.app.addRepoPRJob(args)).to.be.true;
      expect(spy).to.be.called;
      expect(self.logSpy).to.have.been.called;
      expect(self.emitSpy).to.have.been.calledWith('jenkins.new_pr_job');
    });
  });

  describe('addRepoPushJob', function() {
    var self = this,
        config = {
          plugins: {
            github: {
              repos: ['test_repo']
            },
            jenkins: {
              projects: [
                {
                  repo: 'new_test_repo',
                  name: 'new_test_project'
                }
              ],
              push_projects: [
                {
                  repo: 'test_repo',
                  name: 'test_repo_project'
                },
                {
                  repo: 'test_repo2',
                  name: 'test_repo2_project'
                }
              ]
            }
          }
        };

    beforeEach(function(done) {
      self.app = new Singularity(config, test.log);
      self.logSpy = sinon.spy(),
      self.emitSpy = sinon.spy();
      sinon.stub(self.app.log, 'info', self.logSpy);
      sinon.stub(self.app, 'emit', self.emitSpy);

      done();
    });

    it('does not update when repo is already in a jenkins config', function() {
      var args = { repo: 'test_repo2', project: 'new_test_repo2_project' };
      expect(self.app.addRepoPushJob(args)).to.be.false;
      expect(self.logSpy).to.have.been.calledWithExactly('duplicate jenkins repo or project', args);
      expect(self.emitSpy).to.not.have.been.called;
    });

    it('does not update when project is already in a jenkins config', function() {
      var args = { repo: 'new_test_repo', project: 'test_repo2_project' };
      expect(self.app.addRepoPushJob(args)).to.be.false;
      expect(self.logSpy).to.have.been.calledWithExactly('duplicate jenkins repo or project', args);
      expect(self.emitSpy).to.not.have.been.called;
    });

    it('actually updates properly', function() {
      var args = { repo: 'new_test_repo', project: 'new_test_project', rules: ['^master$'] },
          spy = sinon.spy();

      sinon.stub(self.app, 'addRepo', spy);

      expect(self.app.addRepoPushJob(args)).to.be.true;
      expect(spy).to.be.called;
      expect(self.logSpy).to.have.been.called;
      expect(self.emitSpy).to.have.been.calledWith('jenkins.new_push_job');
    });
  });

  describe('attemptDbConfigLoad', function() {
    it('uses passed config when no db connection', function() {
      var instance = new Singularity({}, test.log);

      instance.attemptDbConfigLoad();
      checkSparseConfig(instance.getConfig());
    });

    it('ignores saved config with persist_config is false', function() {
      var instance = new Singularity({ persist_config: false }, test.log);

      instance.db = {
        getSingularityConfig: function(callback) { callback(null, test.config); }
      };

      instance.attemptDbConfigLoad();
      checkSparseConfig(instance.getConfig());
    });

    it('uses passed config when it cannot connect to db', function() {
      var instance = new Singularity({ persist_config: true }, test.log);

      instance.db = {
        getSingularityConfig: function(callback) { callback('error!', {}); }
      };

      instance.attemptDbConfigLoad();
      checkSparseConfig(instance.getConfig());
    });

    it('uses passed config when stored db config is empty', function() {
      var instance = new Singularity({ persist_config: true }, test.log),
          dbSpy = sinon.spy();

      instance.config.plugins.github.repos.push('test_repo');

      instance.db = {
        getSingularityConfig: function(callback) { callback(null, {}); },
        saveSingularityConfig: function(callback) { callback(null, {}); }
      };

      sinon.stub(instance.db, 'saveSingularityConfig', dbSpy);

      instance.attemptDbConfigLoad();
      expect(dbSpy).to.have.been.calledWith(instance.config);
    });

    it('loads config properly from db if able', function() {
      var instance = new Singularity({ persist_config: true }, test.log),
          dbConfig = { foo: 'bar' };

      instance.db = {
        getSingularityConfig: function(callback) { callback(null, dbConfig); }
      };

      instance.attemptDbConfigLoad();

      expect(instance.config).to.equal(dbConfig);
    });
  });
});
