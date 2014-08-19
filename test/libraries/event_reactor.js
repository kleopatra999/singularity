"use strict";

var Reactor = require('../../libraries/event_reactor'),
    chai = require('chai'),
    expect = chai.expect,
    sinon = require('sinon');

chai.use(require('sinon-chai'));

var TestReactor = Reactor.extend({
  objectType: 'testObject',
  name: 'test-object'
});

describe('event_reactor', function() {
  var debugSpy, instance, sinonSandbox;

  beforeEach(function() {
    instance = new TestReactor({});
    sinonSandbox = sinon.sandbox.create();
    debugSpy = sinonSandbox.spy(instance.log, 'debug');
  });

  afterEach(function() {
    sinonSandbox.restore();
  });

  describe('#publishPayload', function() {
    it('notifies when no payload given', function() {
      expect(instance.publishPayload()).to.equal(undefined);
      expect(debugSpy).to.have.been.calledWithMatch(/no payload/);
    });

    it('notifies when no payload type given', function() {
      expect(instance.publishPayload({})).to.equal(undefined);
      expect(debugSpy).to.have.been.calledWithMatch(/no type/);
    });
  });
});
