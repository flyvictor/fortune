var should = require('should');

var adapterInit = require('../../lib/adapters/couchdb');

var RSVP = require('rsvp');
var Promise = RSVP.Promise;
var _ = require('lodash');

RSVP.on('error', function (err) {
    console.log('rsvp err handler', err);
    throw err;
});

describe('CouchDB adapter', function () {
  var ids;

  describe('Creation', function () {
    it('should be able to create document with provided id @now', function (done) {
      
      adapterInit({
        host: process.env.WERCKER_COUCHDB_HOST || 'localhost',
        port: process.env.WERCKER_COUCHDB_PORT || 5984
      })
      .then(function(adapter) {
        console.log("adapter initialised", adapter);
        var doc = {
            id: '123456789012345678901234'
        };
        
        adapter.create(doc.id, doc).then(function () {
          adapter.find('', doc.id).then(function (doc) {
            should.exist(doc);
            done();
          });
        });
      })
    });
  });

});