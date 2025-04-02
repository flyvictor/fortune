'use strict';
var should = require('should');
var request = require('supertest');

module.exports = function (options) {
  describe('resource aggregates', function () {
    var baseUrl;
    beforeEach(function () {
      baseUrl = options.baseUrl;
    });

    describe('reject all methods except GET', function () {
      it('should respond 403 to POST', function (done) {
        request(baseUrl).post('/aggregates')
          .set('content-type', 'application/json')
          .send(JSON.stringify({}))
          .expect(403)
          .end(function (err, res) {
            should.not.exist(err);

            done();
          });
      });

      it('should respond 403 to PUT', function (done) {
        request(baseUrl).put('/aggregates')
          .set('content-type', 'application/json')
          .send(JSON.stringify({}))
          .expect(403)
          .end(function (err, res) {
            should.not.exist(err);

            done();
          });
      });

      it('should respond 403 to PATCH', function (done) {
        request(baseUrl).patch('/aggregates')
          .set('content-type', 'application/json')
          .send(JSON.stringify({}))
          .expect(403)
          .end(function (err, res) {
            should.not.exist(err);

            done();
          });
      });

      it('should respond 403 to DELETE', function (done) {
        request(baseUrl).delete('/aggregates')
          .set('content-type', 'application/json')
          .send(JSON.stringify({}))
          .expect(403)
          .end(function (err, res) {
            should.not.exist(err);

            done();
          });
      });

      it('should respond 200 to GET', function (done) {
        request(baseUrl).get('/aggregates')
          .set('content-type', 'application/json')
          .send(JSON.stringify({}))
          .expect(200)
          .end(function (err, res) {
            should.not.exist(err);

            done();
          });
      });


    });


    it('should create a new aggregates resource route', function (done) {
      request(baseUrl).get('/aggregates')
        .set('content-type', 'application/json')
        .send(JSON.stringify({}))
        .end(function (err, res) {
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.data.should.be.an.Array;
          body.data.length.should.equal(0);

          done();
        });
    });

    it('should create a new aggregates resource route', function (done) {
      request(baseUrl).get('/aggregates')
        .set('content-type', 'application/json')
        .send(JSON.stringify({}))
        .expect(200)
        .end(function (err, res) {
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.data.should.be.an.Array;
          body.data.length.should.equal(0);

          done();
        });
    });

    it('should return an empty dataset when an invalid dataset is specified', function (done) {
      request(baseUrl).get('/aggregates?dataset=nonExistentDataset')
        .set('content-type', 'application/json')
        .send(JSON.stringify({}))
        .expect(200)
        .end(function (err, res) {
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.data.should.be.an.Array;
          body.data.length.should.equal(0);

          done();
        });
    });

    it('should return a collection of objects when a valid dataset is specified', function (done) {
      request(baseUrl).get('/aggregates?dataset=aggregate-by-day')
        .set('content-type', 'application/json')
        .send(JSON.stringify({}))
        .expect(200)
        .end(function (err, res) {
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.data.should.be.an.Array;
          body.data.length.should.be.greaterThanOrEqual(1);
          body.data[0].should.be.an.Object;

          done();
        });
    });
  });
};