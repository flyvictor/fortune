require('should');
const sinon = require('sinon');
const request = require('supertest');
const fortune = require('../../lib/fortune');

const port = 9895;
const port2 = 9896;
const baseUrl = `http://localhost:${port}`;

module.exports = function () {
  describe('custom instrumentor', function () {
    let mockInstrumentor, tracerStub;

    before(function () {
      mockInstrumentor = {
        instrumentor: {
          createTracer: sinon.stub().returnsArg(1),
          captureException: sinon.stub(),
        },
        options: {
          tracePrefix: 'Custom trace prefix: ',
        },
      };
      tracerStub = mockInstrumentor.instrumentor.createTracer;

      fortune({
        adapter: 'mongodb',
        port: port,
        connectionString: 'mongodb://localhost/instrumentor-test',
        serviceName: 'user-service',
        customInstrumentorObj: mockInstrumentor,
      })
        .resource('user', {
          userType: String,
          title: String,
          firstName: String,
        })
        .listen(port);
    });

    it('should be called', function (done) {
      request(baseUrl)
        .get('/users')
        .expect(200)
        .end(function () {
          tracerStub.should.be.called;
        });
      done();
    });

    it('traces should be named suitably', function (done) {
      request(baseUrl)
        .get('/users')
        .expect(200)
        .end(function () {
          for (const arg of tracerStub.args) {
            arg[0].should.be
              .type('string')
              .and.startWith(mockInstrumentor.options.tracePrefix);

            arg[1].should.be.type('function');
          }
        });
      done();
    });

    it('should cause error when not valid', function (done) {
      const invalidInstrumentor = {
        methods: {
          createTransaction: sinon.stub().returnsArg(1),
        },
      };
      const invalidInstrumentorApp = function () {
        fortune({
          adapter: 'mongodb',
          port: port,
          connectionString: 'mongodb://localhost/instrumentor-test2',
          serviceName: 'user-service2',
          customInstrumentorObj: invalidInstrumentor,
        })
          .resource('user', {
            userType: String,
            title: String,
            firstName: String,
          })
          .listen(port2);
      };

      invalidInstrumentorApp.should.throwError('Invalid instrumentor');
      done();
    });
  });
};
