var Plugin = require('../../../../libraries/plugins/publishers/github'),
    PublisherPayload = require('../../../../libraries/payloads/publisher').PublisherPayload,
    BuildPayload = require('../../../../libraries/payloads/build').BuildPayload,
    chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon');

require('replay');

// dependencies & test lib configuration
chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));
var pluginConfig = {
  method: 'hooks',
  host: null,
  port: null,
  auth: {
    token: 'my_token',
    type: 'oauth'
  }
};

describe('plugins/publishers/github', function() {
  var instance, logDebugSpy, sinonSandbox;

  beforeEach(function(done) {
    instance = new Plugin(pluginConfig);
    sinonSandbox = sinon.sandbox.create();
    logDebugSpy = sinonSandbox.spy(instance.log, 'debug');

    sinonSandbox.stub(instance, 'info');
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

  describe('#createStatus', function() {
    it ('creates queued status', function(done) {
      var payload = new BuildPayload({
        repo: 'octocat/example',
        revision: '1234',
        status: 'queued',
        link: null,
        message: 'my custom message'
      }).data;

      expect(instance.createStatus(payload))
        .to.eventually.eql(new PublisherPayload(
          { owner: 'octocat',
            repo: "example",
            sha: '1234',
            status: 'queued',
            buildLink: null,
            type: 'statusUpdate',
            publishedMessage: 'my custom message' }
        ).data).notify(done);
    });

    it ('creates building status', function(done) {
      var payload = new BuildPayload({
        repo: 'octocat/example',
        revision: '1234',
        status: 'building',
        link: 'https://ci.example.com/1000/output',
        message: 'this is building now'
      }).data;

      expect(instance.createStatus(payload))
        .to.eventually.eql(new PublisherPayload(
          { repo: 'example',
            owner: 'octocat',
            sha: '1234',
            status: 'building',
            buildLink: 'https://ci.example.com/1000/output',
            type: 'statusUpdate',
            publishedMessage: 'this is building now' }
        ).data).notify(done);
    });

    it ('creates success status', function(done) {
      var payload = new BuildPayload({
        repo: 'octocat/example',
        revision: '1234',
        status: 'success',
        link: 'https://ci.example.com/1000/output',
        message: 'successful build'
      }).data;

      expect(instance.createStatus(payload))
        .to.eventually.eql(new PublisherPayload(
          { repo: 'example',
            owner: 'octocat',
            sha: '1234',
            status: 'success',
            buildLink: 'https://ci.example.com/1000/output',
            type: 'statusUpdate',
            publishedMessage: 'successful build' }
        ).data).notify(done);
    });

    it ('creates failure status', function(done) {
      var payload = new BuildPayload({
        repo: 'octocat/example',
        revision: '1234',
        status: 'failure',
        link: 'https://ci.example.com/1000/output',
        message: 'tests failed'
      }).data;

      expect(instance.createStatus(payload))
        .to.eventually.eql(new PublisherPayload(
          { repo: 'example',
            owner: 'octocat',
            sha: '1234',
            status: 'failure',
            buildLink: 'https://ci.example.com/1000/output',
            type: 'statusUpdate',
            publishedMessage: 'tests failed' }
        ).data).notify(done);
    });

    it ('creates error status', function(done) {
      var payload = new BuildPayload({
        repo: 'octocat/example',
        revision: '1234',
        status: 'error',
        link: 'https://ci.example.com/1000/output',
        message: 'error trying to test this'
      }).data;

      expect(instance.createStatus(payload))
        .to.eventually.eql(new PublisherPayload(
          { repo: 'example',
            owner: 'octocat',
            sha: '1234',
            status: 'error',
            buildLink: 'https://ci.example.com/1000/output',
            type: 'statusUpdate',
            publishedMessage: 'error trying to test this' }
        ).data).notify(done);
    });
  });
});
