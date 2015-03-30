var inflect= require('i')();
var should = require('should');
var _ = require('lodash');
var RSVP = require('rsvp');
var request = require('supertest');
var Promise = RSVP.Promise;
var fortune = require('../../lib/fortune.js')

module.exports = function(options){

describe('Fortune', function () {
  this.timeout(10000);
  var ids, baseUrl, app;
  beforeEach(function(){
    ids = options.ids;
    baseUrl = options.baseUrl;
    app = options.app;
  });


  require('./actions')(options);
  require('./custom-types')(options);
  require('./routing')(options);
  require('./associations')(options);
  require('./fields_and_filters')(options);
  require('./compound_document')(options);
  require('./documents_with_links')(options);
  require('./includes')(options);
  require('./hooks')(options);
  require('./direct')(options);
  require('./plugins')(options);
  require('./linking_booster')(options);
  require('./non-destructive-deletes')(options);
  require('./should-upsert')(options);

  describe("Business key", function(){
    it("can be used as primary key for individual resource requests", function(done){
      request(baseUrl).get("/cars/ABC123")
        .expect('Content-Type', /json/)
        .expect(200)
        .end(function(error, response){
          should.not.exist(error);
          var body = JSON.parse(response.text);
          body.cars.length.should.equal(1);
          body.cars[0].id.should.equal("ABC123");
          done();
        });
    });

    it("is indexed and unique", function(done){
      var model;
      
      (model = app.adapter.model("person")).collection.getIndexes(function(err,indexData){
        model.pk.should.be.ok;
        indexData[model.pk+"_1"].should.be.ok
        done();
      });
    });
  });

  describe("Init", function() {
    it("should pass 'debug' option to underlying adapter", function(done) {
      var remoteDB = process.env.WERCKER_MONGODB_URL ? process.env.WERCKER_MONGODB_URL + '/fortune' : null;
      var app = fortune({
        adapter: 'mongodb',
        debug: true,
        connectionString: remoteDB || "mongodb://localhost/fortune_test",
        inflect: true,
        enableWebsockets: true
      });

      app.adapter.mongoose.options.debug.should.equal(true);
      app.adapter.mongoose.options.debug = false; // Set the global variable back to not log all requests in test env
      done();
    });
  });
});
};
