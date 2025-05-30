var inflect= require('i')();
var should = require('should');
var _ = require('lodash');
var RSVP = require('rsvp');
var request = require('supertest');
var Promise = RSVP.Promise;
var fixtures = require('../fixtures.json');
var neighbourhood = require('../neighbourhood');
var sinon = require('sinon');

module.exports = function(options){
  describe('fields and filters', function(){
    var app, baseUrl, ids, adapter, clock;
    beforeEach(function(){
      app = options.app;
      baseUrl = options.baseUrl;
      ids = options.ids;
      adapter = options.app.adapter;
    });

    afterEach(function () {
      if(clock) clock.restore();
    });

    describe("patching nested objects", function() {
      it("should support replacing just one of the values", function(done) {
        request(baseUrl).patch('/people/' + ids.people[0])
          .set('content-type', 'application/json')
          .send(JSON.stringify([{op: "replace", path: "/people/0/nested/field1", value: "value1"}]))
          .expect(200)
          .end(function(error, response) {
            if (error) return done(error);
            JSON.parse(response.text).people[0].nested.should.eql({field1: "value1"});
            request(baseUrl).patch('/people/' + ids.people[0])
              .set('content-type', 'application/json')
              .send(JSON.stringify([{op: "replace", path: "/people/0/nested/field2", value: "value2"}]))
              .expect(200)
              .end(function(error, response) {
                if (error) return done(error);
                JSON.parse(response.text).people[0].nested.should.eql({field1: "value1", field2: "value2"});
                done();
              });
          });
      });
    });

    describe("sparse fieldsets", function(){
      beforeEach(function(done){
        var update = [{
          op: 'add',
          path: '/people/0/links/pets/-',
          value: ids.pets[0]
        }];
        request(baseUrl).patch('/people/' + ids.people[0])
          .set('content-type', 'application/json')
          .send(JSON.stringify(update))
          .expect(200)
          .end(done);
      });
      it("should return specific fields for documents", function(done){
        request(baseUrl).get('/people/' + ids.people[0] + '?fields=name,email,pets')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(error, response){
            should.not.exist(error);
            var body = JSON.parse(response.text);
            should.not.exist(body.people[0].appearances);
            should.exist(body.people[0].name);
            should.exist(body.people[0].email);
            should.exist(body.people[0].links.pets);
            done();
          });
      });

      it("should return specific fields for a single document", function(done){
        request(baseUrl).get('/people/'+ids.people[0] + "?fields=name,email,pets")
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(error, response){
            should.not.exist(error);
            var body = JSON.parse(response.text);
            should.not.exist(body.people[0].appearances);
            should.exist(body.people[0].name);
            should.exist(body.people[0].email);
            should.exist(body.people[0].links.pets);
            done();
          });
      });

      it("should return specific fields for linked document of a collection", function(done){
        request(baseUrl).get('/people?include=pets&fields[pets]=name')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.not.exist(body.linked.pets[0].appearances);
            should.exist(body.linked.pets[0].name);
            done();
          });
      });

      it("should return specific fields for linked document of single doc", function(done){
        request(baseUrl).get('/people/' + ids.people[0] + '?include=pets&fields[pets]=name')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.not.exist(body.linked.pets[0].appearances);
            should.exist(body.linked.pets[0].name);
            done();
          });
      });
    });

    describe("filters", function(){
      it("should allow top-level resource filtering for collection routes", function(done){
        request(baseUrl).get('/people?filter[name]=Robert')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(error, response){
            should.not.exist(error);
            var body = JSON.parse(response.text);
            body.people.length.should.equal(1);
            done();
          });
      });

      it("should allow top-level resource filtering based on a numeric value", function(done) {
        request(baseUrl).get('/people?filter[appearances]=1934')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(error, response){
            should.not.exist(error);
            var body = JSON.parse(response.text);
            body.people.length.should.equal(1);
            done();
          });
      });
      it("should allow resource sub-document filtering based on a numeric value", function(done){
        request(baseUrl).get("/cars?filter[additionalDetails.seats]=2")
          .end(function(err, res){
            var body = JSON.parse(res.text);

            body.cars.length.should.be.equal(1);
            body.cars[0].id.should.be.equal('XYZ890');
            done();
          });
      });
      it("should allow top-level resource filtering based on Date string", function(done) {
        request(baseUrl).get('/people?filter[birthday][gte]=1995-01-01')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.people);
            (body.people.length).should.eql(3);
            done();
          });
      });
      it("should return correct error if date is not recognized", function(done) {
        request(baseUrl).get('/people?filter[birthday]=time of big bang')
          .expect(400)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            body.should.eql({
              error: 'Request was malformed.',
              detail: 'CastError: Cast to date failed for value "time of big bang" (type string) at path "birthday" for model "person"'
            });
            done();
          });
      });
      it.skip("should allow resource filtering based on wordy dates, like 'today', 'yesterday', 'tomorrow', etc", function(done) {
        clock = sinon.useFakeTimers(new Date(2000, 00, 02).getTime());
        request(baseUrl).get('/people?filter[birthday]=yesterday')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.people);
            (body.people.length).should.eql(1);
            done();
          });
      });
      it.skip("should allow resource filtering based on wordy dates, like 'today', 'yesterday', 'tomorrow', etc used along with $gte, $lte", function(done) {
        clock = sinon.useFakeTimers(new Date(2000, 00, 02).getTime());
        request(baseUrl).get('/people?filter[birthday][gte]=yesterday')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.people);
            (body.people.length).should.eql(1);
            done();
          });
      });
      it("should return correct error if date is not recognized inside of complex filter with $gte, $lte", function(done) {
        request(baseUrl).get('/people?filter[birthday][gte]=time of big bang')
          .expect(400)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            body.should.eql({
              error: 'Request was malformed.',
              detail: 'CastError: Cast to date failed for value "time of big bang" (type string) at path "birthday" for model "person"'
            });
            done();
          });
      });
      it("should correctly accept $exists: true", function(done) {
        request(baseUrl).get('/people?filter[birthday][$exists]=tRue')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people).length.should.eql(4);
            done();
          });
      });
      it("should correctly accept $exists: false", function(done) {
        request(baseUrl).get('/people?filter[birthday][$exists]=faLse')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people).length.should.eql(0);
            done();
          });
      });
      it('should be possible to filter related resources by ObjectId', function(done){
        var cmd = [
          {
            op: 'replace',
            path: '/people/0/pets',
            value: [ids.pets[0], ids.pets[1]]
          }
        ];
        //Give a man a pet
        request(baseUrl).patch('/people/' + ids.people[0])
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(cmd))
          .expect(200)
          .end(function(err){
            should.not.exist(err);
            request(baseUrl).get('/people?filter[pets]=' + ids.pets[0])
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var data = JSON.parse(res.text);
                (data.people).should.be.an.Array;
                //Make sure filtering was run by ObjectId
                (/[0-9a-f]{24}/.test(ids.pets[0])).should.be.ok;
                (/[0-9a-f]{24}/.test(data.people[0].links.pets[0])).should.be.ok;
                done();
              });
          });
      });
      it('should support filtering by id for one-to-one relationships', function(done){
        new Promise(function(resolve){
          var upd = [{
            op: 'replace',
            path: '/people/0/soulmate',
            value: ids.people[1]
          }];
          request(baseUrl).patch('/people/' + ids.people[0])
            .set('content-type', 'application/json')
            .send(JSON.stringify(upd))
            .expect(200)
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        })
          .then(function(){
            request(baseUrl).get('/people?filter[soulmate]=' + ids.people[1])
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                (body.people[0].id).should.equal(ids.people[0]);
                done();
              });
          });
      });
      it('should support regex query', function(done){
        request(baseUrl).get('/people?filter[email][regex]=Bert@&filter[email][options]=i')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people.length).should.equal(2);
            done();
          });
      });
      it('should support `in` query', function(done){
        new Promise(function(resolve){
          var upd = [{
            op: 'add',
            path: '/people/0/links/houses/-',
            value: ids.houses[0]
          },{
            op: 'add',
            path: '/people/0/links/houses/-',
            value: ids.houses[1]
          }];
          request(baseUrl).patch('/people/' + ids.people[0])
            .set('content-type', 'application/json')
            .send(JSON.stringify(upd))
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              resolve();
            });
        })
          .then(function(){
            return new Promise(function(resolve){
              var upd = [{
                op: 'add',
                path: '/people/0/links/houses/-',
                value: ids.houses[1]
              },{
                op: 'add',
                path: '/people/0/links/houses/-',
                value: ids.houses[2]
              }];
              request(baseUrl).patch('/people/' + ids.people[1])
                .set('content-type', 'application/json')
                .send(JSON.stringify(upd))
                .expect(200)
                .end(function(err, res){
                  should.not.exist(err);
                  resolve();
                });
            });
          })
          .then(function(){
            request(baseUrl).get('/people?filter[houses][in]=' + ids.houses[0] + ',' + ids.houses[1])
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                (body.people.length).should.equal(2);
                done();
              });
          });
      });
      it('should support $in query against one-to-one refs', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch("/people/robert@mailbert.com")
            .set("content-type", "application/json")
            .send(JSON.stringify([
              {
                path: '/people/0/soulmate',
                op: 'replace',
                value: 'dilbert@mailbert.com'
              }
            ]))
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
          request(baseUrl).get("/people?filter[soulmate][$in]=robert@mailbert.com&filter[soulmate][$in]=dilbert@mailbert.com")
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.people.length).should.equal(2);
              done();
            });
        });
      });
      it('should support $in query against many-to-many refs', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch("/people/robert@mailbert.com")
            .set("content-type", "application/json")
            .send(JSON.stringify([
              {
                path: '/people/0/lovers',
                op: 'replace',
                value: ['dilbert@mailbert.com']
              }
            ]))
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
          request(baseUrl).get("/people?filter[lovers][$in]=robert@mailbert.com&filter[lovers][$in]=dilbert@mailbert.com")
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.people.length).should.equal(2);
              done();
            });
        });
      });
      it('should support $in query against external refs values', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch("/cars/" + ids.cars[0])
            .set("content-type", "application/json")
            .send(JSON.stringify([{
              path: "/cars/0/MOT",
              op: "replace",
              value: "Pimp-my-ride"
            }]))
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
          request(baseUrl).get("/cars?filter[MOT][$in]=Pimp-my-ride")
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.cars.length).should.equal(1);
              done();
            });
        });
      });
      it('should be able to run $in query against nested fields', function(done){
        request(baseUrl).get("/cars?filter[additionalDetails.seats][in]=2")
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.cars[0].additionalDetails.seats).should.equal(2);
            (body.cars.length).should.equal(1);
            done();
          });
      });
      it('should be able to run in query against links', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch("/people/" + ids.people[1])
            .set('content-type', 'application/json')
            .send(JSON.stringify([
              {op: "replace", path: '/people/0/soulmate', value: ids.people[0]}
            ]))
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
          request(baseUrl).get("/people?filter[soulmate][in]=" + ids.people[0] + "," + ids.people[1])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              body.people.length.should.equal(2);
              done();
            });
        });
      });
      it('should support special mongo $prefixed queries against external resources', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch("/cars/" + ids.cars[0])
            .set("content-type", "application/json")
            .send(JSON.stringify([{
              path: "/cars/0/links/MOT",
              op: "replace",
              value: "Pimp-my-ride"
            }]))
            .end(function(err){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
            request(baseUrl).get("/cars?filter[MOT][$exists]=true")
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                (body.cars.length).should.equal(1);
                done();
              });
          });
      });
      it('should support or query', function(done){
        request(baseUrl).get('/people?filter[or][0][name]=Dilbert&filter[or][1][email]=robert@mailbert.com&sort=name')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people.length).should.equal(2);
            (body.people[0].name).should.equal('Dilbert');
            (body.people[1].name).should.equal('Robert');
            done();
          });
      });
      it('should have id filter', function(done){
        request(baseUrl).get('/cars?filter[id]=' + ids.cars[0])
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.cars[0].id).should.equal(ids.cars[0]);
            done();
          });
      });
      it('should let hooks modify req.query.filter', function(done){
        request(baseUrl).get('/people/' + ids.people[0])
          .set('hookFilter', ids.people[1])
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            body.people[0].id.should.equal(ids.people[1]);
            body.people.length.should.equal(1);
            done();
          });
      });
      it('should let hooks modify req.query.filter for subresource requests', function(done){
        new Promise(function(resolve){
          request(baseUrl).patch('/people/' + ids.people[0]).set('content-type', 'application/json')
            .send(JSON.stringify([{op: 'replace', path: '/people/0/links/cars', value: [ids.cars[0]]}]))
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              resolve();
            });
        }).then(function(){
          return new Promise(function(resolve){
            request(baseUrl).patch('/people/' + ids.people[1]).set('content-type', 'application/json')
              .send(JSON.stringify([{op: 'replace', path: '/people/0/links/cars', value: [ids.cars[1]]}]))
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                resolve();
              });
          });
        }).then(function(){
          request(baseUrl).get('/people/' + ids.people[0] + '/cars')
            .set('hookFilter', ids.people[1])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              body.cars[0].id.should.equal(ids.cars[1]);
              done();
            });
        });
      });
      describe('filtering by related objects fields', function(){
        beforeEach(function(done){
          neighbourhood(adapter, ids).then(function(){
            done();
          });
        });
        it('should be able to filter by related resource fields', function(done){
          request(baseUrl).get('/cars?filter[owner][soulmate]=' + ids.people[0])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.cars[0].id).should.equal(ids.cars[1]);
              done();
            });
        });
        it('should be able to filter by two and more parameters', function(done){
          new Promise(function(resolve){
            request(baseUrl).get('/pets?filter[owner][name][regex]=ally&filter[owner][soulmate]=' + ids.people[0])
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                (body.pets.length).should.equal(1);
                (body.pets[0].id).should.equal(ids.pets[0]);
                resolve();
              });
          }).then(function(){
            request(baseUrl).get('/pets?filter[owner][name][regex]=ally')
              .expect(200)
              .end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                (body.pets.length).should.equal(2);
                done();
              });
          });
        });
        it('should be able to apply OR filter to related resources', function(done){
          request(baseUrl).get('/cars?filter[or][0][owner][soulmate]=' + ids.people[0] + '&filter[or][1][id]=' + ids.cars[0])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.cars.length).should.equal(2);
              var one = _.find(body.cars, {id: ids.cars[0]});
              var two = _.find(body.cars, {id: ids.cars[1]});
              should.exist(one);
              should.exist(two);
              done();
            });
        });
        it('should be able to apply AND filter to related resources', function(done){
          request(baseUrl).get('/pets?filter[and][0][owner][soulmate][email]=' + ids.people[0] + '&filter[and][1][owner][email]=' + ids.people[1])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.pets.length).should.equal(1);
              (body.pets[0].id).should.equal(ids.pets[0]);
              done();
            })
        });
        describe('should rewrite id to resource PK for', function(){
          it('$and filters', function(done){
            request(baseUrl).get('/people?filter[$and][0][id]=' + ids.people[0])
              .expect(200).end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                body.people.length.should.equal(1);
                body.people[0].id.should.equal(ids.people[0]);
                done();
              });
          });
          it('$or filters', function(done){
            request(baseUrl).get('/people?filter[$or][0][id]=' + ids.people[0])
              .expect(200).end(function(err, res){
                should.not.exist(err);
                var body = JSON.parse(res.text);
                body.people.length.should.equal(1);
                body.people[0].id.should.equal(ids.people[0]);
                done();
              });
          });
        });
        it('should be able to nest OR and AND filters', function(done){
          request(baseUrl).get('/houses?filter[or][0][and][0][owners][in]=' + ids.people[0])
            .expect(200)
            .end(function(err, res){
              should.not.exist(err);
              var body = JSON.parse(res.text);
              (body.houses.length).should.equal(1);
              (body.houses[0].id).should.equal(ids.houses[0]);
              done();
            })
        });
      });
    });

    describe('limits', function(){
      it('should be possible to tell how many documents to return', function(done){
        request(baseUrl).get('/people?limit=1')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people.length).should.equal(1);
            done();
          });
      });
    });

    describe('sort', function(){
      beforeEach(function(done){
        var update = [{
          op: 'add',
          path: '/people/0/links/pets/-',
          value: ids.pets[0]
        },{
          op: 'add',
          path: '/people/0/links/pets/-',
          value: ids.pets[1]
        }];
        request(baseUrl).patch('/people/' + ids.people[0])
          .set('content-type', 'application/json')
          .send(JSON.stringify(update))
          .expect(200)
          .end(function(err){
            done(err);
          });
      });

      it('should be possible to sort by name', function(done){
        request(baseUrl).get('/people?sort=name')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Dilbert", "Robert", "Sally", "Wally"]);
            done();
          });
      });

      it('should be possible to sort by name desc', function(done){
        request(baseUrl).get('/people?sort=-name')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Wally", "Sally", "Robert", "Dilbert"]);
            done();
          });
      });


      it('should be possible to sort by name desc as an object with number direction', function(done){
        request(baseUrl).get('/people?sort[name]=-1')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Wally", "Sally", "Robert", "Dilbert"]);
            done();
          });
      });

      it('should be possible to sort by name desc as an object with asc/desc direction', function(done){
        request(baseUrl).get('/people?sort[name]=desc')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Wally", "Sally", "Robert", "Dilbert"]);
            done();
          });
      });

      it('should be possible to sort by appearances', function(done){
        request(baseUrl).get('/people?sort=appearances')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Sally", "Robert", "Wally", "Dilbert"]);
            done();
          });
      });
      it('should sort based on default sort order', function(done){
        request(baseUrl).get('/people')
          .expect(200)
          .end(function(err, res){
            var body = JSON.parse(res.text);
            _.map(body.people, "name").should.eql(["Dilbert", "Wally", "Sally", "Robert"]);
            done();
          });
      });
      it('should sort linked resources based on default sort order', function(done){
        request(baseUrl).get('/people?include=pets')
          .expect(200)
          .end(function(err, res){
            var body = JSON.parse(res.text);
            _.map(body.linked.pets, "name").should.eql(["Ratbert", "Dogbert"]);
            done();
          });
      });
    });

    describe('paging', function(){
      it('should be possible to get page 1', function(done){
        request(baseUrl).get('/people?sort=name&page=1&pageSize=2')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people.length).should.equal(2);
            _.map(body.people, "name").should.eql(["Dilbert", "Robert"]);
            done();
          });
      });

      it('should be possible to get page 2', function(done){
        request(baseUrl).get('/people?sort=name&page=2&pageSize=2')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            (body.people.length).should.equal(2);
            _.map(body.people, "name").should.eql(["Sally", "Wally"]);
            done();
          });
      });
    });
    describe('counting', function() {
      it('should not return any counts if not requested', function(done) {
        request(baseUrl).get('/people?sort=name&page=2&pageSize=2')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.not.exist(body.meta);
            done();
          });
      });
      it('should return total count in if meta requested', function(done) {
        request(baseUrl).get('/people?sort=name&page=2&pageSize=2&includeMeta=true')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.meta);
            should.exist(body.meta.count);
            (body.meta.count).should.eql(4);
            done();
          });
      });
      it('should apply extension queries to the count', function(done){
        request(baseUrl).get('/people?includeMeta=true')
          .set('set-fortune-extension', 'dilbert')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            body.meta.count.should.equal(1);
            done();
          });
      });
      it('should return filter total count in if meta requested and any filter used', function(done) {
        request(baseUrl).get('/people?sort=name&page=2&pageSize=2&includeMeta=true&filter[birthday][gte]=1995-01-01')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.meta);
            should.exist(body.meta.count);
            (body.meta.count).should.eql(4);
            (body.meta.filterCount).should.eql(3);
            done();
          });
      });
      it('should restrict total count to the fortune extension query', function(done){
        request(baseUrl).get('/people?filter[name]=Wally&includeMeta=true')
          .set('set-fortune-extension', 'born-in-1995')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            body.meta.count.should.equal(2);
            body.meta.filterCount.should.equal(1);
            done();
          });
      });
      it('should set metadata when total count matched 0 items and metadata was requested', function(done){
        request(baseUrl).get('/people?includeMeta=true')
          .set('set-fortune-extension', 'nobody')
          .expect(200)
          .end(function(err, res){
            should.not.exist(err);
            var body = JSON.parse(res.text);
            should.exist(body.meta);
            body.meta.count.should.equal(0);
            body.meta.filterCount.should.equal(0);
            done();
          });
      });
    });
  });
};
