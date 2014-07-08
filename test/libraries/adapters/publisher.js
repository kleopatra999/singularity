var Plugin = require('../../../libraries/plugins/plugin'),
    Publisher = require('../../../libraries/adapters/publisher'),
    chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon');

    chai.use(require('sinon-chai'));
    chai.use(require('chai-as-promised'));

describe('adapters/publisher', function() {
  var publisher,
      sinonSandbox,
      pluginInstance,
      publishPayloadStub,

      config = {
        plugin: [{
          publisher: {
            tester: {}
          }
        }]
      },

      TestPlugin = Plugin.extend({
        name: 'tester',

        createStatus: function(payload) {
          return {
            type: 'statusUpdate',
            repo: payload.repo,
            owner: payload.owner,
            sha: payload.sha,
            status: payload.status,
            buildLink: payload.link,
            publishedMessage: payload.message
          };
        }
      });

  beforeEach(function(done) {
    sinonSandbox = sinon.sandbox.create();
    publisher = new Publisher(config);

    // Stub out attachPlugin so I can attach my fake plugin
    sinonSandbox.stub(publisher, 'attachPlugin', function(plugin) {
      plugin.log = this.log;
      this.plugins.push(plugin);
    });

    // stub out the publishing to postal
    publishPayloadStub = sinonSandbox.stub(publisher, 'publishPayload');

    // Attach my fake publisher plugin
    pluginInstance = new TestPlugin();
    publisher.attachPlugin(pluginInstance);

    done();
  });

  afterEach(function(done) {
    sinonSandbox.restore();
    done();
  });

  describe('#createStatus', function() {
    describe('successfully creates', function() {
      var buildPayload = {
        status: '',
        artifacts: '',
        buildId: 302,
        link: 'http://build-server/302',
        owner: 'owner',
        repo: 'test',
        sha: '1234sdf',
        type: ''
      };

      function publishedWithMessage(payload, message) {
        return publisher.createStatus(buildPayload)
        .then(function() {
          expect(publishPayloadStub).to.have.been.called;
          expect(publishPayloadStub).to.have.been.calledWithExactly({
            buildLink: buildPayload.link,
            owner: buildPayload.owner,
            publishedMessage: message,
            repo: buildPayload.repo,
            sha: buildPayload.sha,
            status: buildPayload.status,
            type: 'statusUpdate'
          });
        });
      }

      it('queued status', function() {
        buildPayload.status = 'queued';

        publishedWithMessage(buildPayload, 'job has been added to queue')
        .done();
      });

      it('building status', function() {
        buildPayload.status = 'building';

        publishedWithMessage(buildPayload, 'currently running')
        .done();
      });

      it('success status', function() {
        buildPayload.status = 'success';

        publishedWithMessage(buildPayload, 'successfully built')
        .done();
      });

      it('failure status', function() {
        buildPayload.status = 'failure';

        publishedWithMessage(buildPayload, 'failed to build')
        .done();
      });

      it('error status', function() {
        buildPayload.status = 'error';

        publishedWithMessage(buildPayload, 'There was an error trying to test this pr')
        .done();
      });

    });
  });

  // TODO test build payloads that fail validation
  // TODO test returned publisher payload that fail validation
});
