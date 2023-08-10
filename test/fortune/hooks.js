var request = require('supertest');
var should = require('should');
var RSVP = require('rsvp');

module.exports = function(options){
  var ids, app, baseUrl;
  beforeEach(function(){
    ids = options.ids;
    app = options.app;
    baseUrl = options.baseUrl;
  });

  describe("hooks", function(){
    it("should stop processing a POST request if a before hook returns false", function(done) {
      var petCount;
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          petCount = JSON.parse(res.text).pets.length;
          request(baseUrl).post('/pets/?failbeforeAllWrite=boolean')
          .set('content-type', 'application/json')
          .send(JSON.stringify({pets: [{name: 'dave'}]}))
          .end(function(req, res) {
            res.statusCode.should.equal(321);
            request(baseUrl).get('/pets/')
              .end(function(err, res) {
                JSON.parse(res.text).pets.length.should.equal(petCount);
                done();
            });
        });
      });
    });
    it("should stop processing a POST request if a before hook returns undefined", function(done) {
      var petCount;
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          petCount = JSON.parse(res.text).pets.length;
          request(baseUrl).post('/pets/?failbeforeAllWrite=undefined')
            .set('content-type', 'application/json')
            .send(JSON.stringify({pets: [{name: 'dave'}]}))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/')
                .end(function(err, res) {
                  JSON.parse(res.text).pets.length.should.equal(petCount);
                  done();
                });
            });
        });
    });

    it("should stop processing a PATCH request if a before hook returns false", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).patch('/pets/' + pet.id + '?failbeforeAllWrite=boolean')
          .set('content-type', 'application/json')
          .send(JSON.stringify([
            {op: 'replace', path: '/pets/0/name', value: 'new name'}
          ]))
          .end(function(req, res) {
            res.statusCode.should.equal(321);
            request(baseUrl).get('/pets/' + pet.id)
            .end(function(err, res) {
              JSON.parse(res.text).pets[0].name.should.not.eql('new name');
              done();
            });
        });
      });
    });
    it("should stop processing a PATCH request if a before hook returns undefined blablabla", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).patch('/pets/' + pet.id + '?failbeforeAllWrite=undefined')
            .set('content-type', 'application/json')
            .send(JSON.stringify([
              {op: 'replace', path: '/pets/0/name', value: 'new name'}
            ]))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/' + pet.id)
                .end(function(err, res) {
                  JSON.parse(res.text).pets[0].name.should.not.eql('new name');
                  done();
                });
            });
        });
    });

    it("should stop processing a PUT request if a before hook returns false", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).put('/pets/' + pet.id + '?failbeforeAllWrite=boolean')
          .set('content-type', 'application/json')
          .send(JSON.stringify({pets: [{name: 'new pet'}]}))
          .end(function(req, res) {
            res.statusCode.should.equal(321);
            request(baseUrl).get('/pets/' + pet.id)
            .end(function(err, res) {
              JSON.parse(res.text).pets[0].name.should.not.eql('new pet');
              done();
            });
        });
      });
    });
    it("should stop processing a PUT request if a before hook returns undefined", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).put('/pets/' + pet.id + '?failbeforeAllWrite=boolean')
            .set('content-type', 'application/json')
            .send(JSON.stringify({pets: [{name: 'new pet'}]}))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/' + pet.id)
                .end(function(err, res) {
                  JSON.parse(res.text).pets[0].name.should.not.eql('new pet');
                  done();
                });
            });
        });
    });

    it("should stop processing a POST request if a before hook returns false via a promise", function(done) {
      var petCount;
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          petCount = JSON.parse(res.text).pets.length;
          request(baseUrl).post('/pets/?failbeforeAllWrite=promise')
          .set('content-type', 'application/json')
          .send(JSON.stringify({pets: [{name: 'dave'}]}))
          .end(function(req, res) {
            res.statusCode.should.equal(321);
            request(baseUrl).get('/pets/')
              .end(function(err, res) {
                JSON.parse(res.text).pets.length.should.equal(petCount);
                done();
            });
        });
      });
    });
    it("should stop processing a POST request if a before hook returns undefined via a promise", function(done) {
      var petCount;
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          petCount = JSON.parse(res.text).pets.length;
          request(baseUrl).post('/pets/?failbeforeAllWrite=undefined_promise')
            .set('content-type', 'application/json')
            .send(JSON.stringify({pets: [{name: 'dave'}]}))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/')
                .end(function(err, res) {
                  JSON.parse(res.text).pets.length.should.equal(petCount);
                  done();
                });
            });
        });
    });

    it("should stop processing a PATCH request if a before hook returns false via promise", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).patch('/pets/' + pet.id + '?failbeforeAllWrite=promise')
            .set('content-type', 'application/json')
            .send(JSON.stringify([
              {op: 'replace', path: '/pets/0/name', value: 'new name'}
            ]))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/' + pet.id)
                .end(function(err, res) {
                  JSON.parse(res.text).pets[0].name.should.not.eql('new name');
                  done();
                });
        });
      });
    });
    it("should stop processing a PATCH request if a before hook returns undefined via promise", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).patch('/pets/' + pet.id + '?failbeforeAllWrite=undefined_promise')
            .set('content-type', 'application/json')
            .send(JSON.stringify([
              {op: 'replace', path: '/pets/0/name', value: 'new name'}
            ]))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/' + pet.id)
                .end(function(err, res) {
                  JSON.parse(res.text).pets[0].name.should.not.eql('new name');
                  done();
                });
            });
        });
    });

    it("should stop processing a PUT request if a before hook returns false via promise", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).put('/pets/' + pet.id + '?failbeforeAllWrite=promise')
          .set('content-type', 'application/json')
          .send(JSON.stringify({pets: [{name: 'new pet'}]}))
          .end(function(req, res) {
            res.statusCode.should.equal(321);
            request(baseUrl).get('/pets/' + pet.id)
            .end(function(err, res) {
              JSON.parse(res.text).pets[0].name.should.not.eql('new pet');
              done();
            });
        });
      });
    });
    it("should stop processing a PUT request if a before hook returns undefined via promise", function(done) {
      request(baseUrl).get('/pets/')
        .end(function(err, res) {
          var pet = JSON.parse(res.text).pets[0];
          request(baseUrl).put('/pets/' + pet.id + '?failbeforeAllWrite=undefined_promise')
            .set('content-type', 'application/json')
            .send(JSON.stringify({pets: [{name: 'new pet'}]}))
            .end(function(req, res) {
              res.statusCode.should.equal(321);
              request(baseUrl).get('/pets/' + pet.id)
                .end(function(err, res) {
                  JSON.parse(res.text).pets[0].name.should.not.eql('new pet');
                  done();
                });
            });
        });
    });

    it("should apply global hooks in priority order", function(done){
      request(baseUrl).get("/people")
        .end(function(err, res){
          should.not.exist(err);
          res.headers.globalpriority.should.equal("correct");
          done();
        });
    });
    it("should apply resource hooks in priority order", function(done){
      request(baseUrl).get("/houses")
        .end(function(err, res){
          should.not.exist(err);
          res.headers.resourcepriority.should.equal("correct");
          done();
        });
    });
    it("should apply asynchronous hooks in series according to priority", function(done){
      request(baseUrl).get("/pets")
        .end(function(err, res){
          should.not.exist(err);
          res.headers.asyncseries.should.equal("correct");
          done();
        });
    });

    it("should not change req.body in the hook on PATCH", function(done) {
      request(baseUrl).get('/people')
        .end(function(err, res) {
          var people = JSON.parse(res.text).people[0];
          var replace = JSON.stringify([
            {op: 'replace', path: '/people/0/nested', value: {
              field3: {
                name: "nested field3"
              }
            }}
          ]);
          request(baseUrl).patch('/people/' + people.id + '?changeNestedProperty=true')
            .set('content-type', 'application/json')
            .send(replace)
            .end(function(req, res) {
              res['headers'].reqbody.should.eql(replace);
              done();
            });
        });
    });
    it("after write hook throws an error on resource creating", function(done) {
      request(baseUrl).post('/people')
        .set('content-type', 'application/json')
        .send(JSON.stringify({people: [
            {email: 'testing'}
          ]}))
        .set('throw-after-write-error', true)
        .end(function(err, res){
          res.statusCode.should.equal(500);
          done();
        });
    });

  });
  describe('onResponseSend hooks', function(){
    it('should call beforeResponseSend hooks once per request', function(done){
      request(baseUrl).get('/people')
        .set('apply-before-response-send', 1)
        .end(function(err, res){
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.hookCallCount.should.equal(1);
          done();
        });
    });
    it('should be able to change response status code', function(done){
      request(baseUrl).get('/people')
        .set('overwrite-response-status-code', 404)
        .end(function(err, res){
          should.not.exist(err);
          res.statusCode.should.equal(404);
          done();
        });
    });
    it('should call beforeResponseSend hooks for any type of operation', function(done){
      request(baseUrl).post('/people')
        .set('content-type', 'application/json')
        .send(JSON.stringify({people: [
          {email: 'testing'}
        ]}))
        .set('apply-before-response-send', 1)
        .end(function(err, res){
          should.not.exist(err);
          var body = JSON.parse(res.text);
          body.hookCallCount.should.equal(1);
          request(baseUrl).patch('/people/testing')
            .set('content-type', 'application/json')
            .send(JSON.stringify([
              {op: 'replace', path: '/people/0/name', value: 'updated'}
            ]))
            .set('apply-before-response-send', 1)
            .end(function(err, res) {
              should.not.exist(err);
              var body = JSON.parse(res.text);
              body.hookCallCount.should.equal(1);
              request(baseUrl).put('/people/testing')
                .set('content-type', 'application/json')
                .send(JSON.stringify({people: [{email: 'testing', name: 'changed'}]}))
                .set('apply-before-response-send', 1)
                .end(function(err, res) {
                  should.not.exist(err);
                  var body = JSON.parse(res.text);
                  body.hookCallCount.should.equal(1);
                  done();
                });
            })
        });
    });
  });

  describe('onErrorResponseSend hooks', function(){
    it('should not call beforeErrorResponseSend hooks per successfull request', function(done){
      request(baseUrl).get('/people')
        .set('apply-before-error-response-send', 1)
        .end(function(err, res){
          should.not.exist(err);
          var body = JSON.parse(res.text);
          should.not.exist(body.hookCallCount);
          done();
        });
    });
    it('should call beforeErrorResponseSend hooks once per error request', function(done){
      request(baseUrl)
        .patch("/people/" + ids.people[0])
        .set('content-type', 'application/json')
        .set('apply-before-error-response-send', 1)
        .send(JSON.stringify([
          {op: 'inc', path: '/people/0/name', value: 'any'}
        ]))
        .end(function(err, res){
          should.not.exist(err);
          console.log(res.text);
          var body = JSON.parse(res.text);
          body.hookCallCount.should.equal(1);
          done();
        });
    });
    it('should be able to change response status code', function(done){
      request(baseUrl)
        .patch("/people/" + ids.people[0])
        .set('content-type', 'application/json')
        .set('overwrite-error-response-status-code', 404)
        .send(JSON.stringify([
          {op: 'inc', path: '/people/0/name', value: 'any'}
        ]))
        .end(function(err, res){
          should.not.exist(err);
          res.statusCode.should.equal(404);
          done();
        });
    });
  });
  describe.skip("native mongoose middleware", function(){
    it("should be able to expose mongoose api to resources", function(done){
      new RSVP.Promise(function(resolve){
        request(baseUrl).post("/houses")
          .set("content-type", "application/json")
          .send(JSON.stringify({
            houses: [{
              address: "mongoose-"
            }]
          }))
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            resolve(body.houses[0].id);
          });
      }).then(function(createdId){
        request(baseUrl).get("/houses/" + createdId)
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.houses[0].address).should.match(/mongoosed$/);
            done();
          });
      });
    });
  });
};
