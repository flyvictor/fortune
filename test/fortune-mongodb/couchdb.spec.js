var should = require('should');

var adapter = require('../../lib/adapters/couchdb');

var RSVP = require('rsvp');
var Promise = RSVP.Promise;
var _ = require('lodash');

RSVP.on('error', function (err) {
    console.log('rsvp err handler', err);
    throw err;
});

//module.exports = function (options) {

    describe('MongoDB adapter', function () {
        var ids;

        describe('Creation', function () {
            it('should be able to create document with provided id', function (done) {
              
                var doc = {
                    id: '123456789012345678901234'
                };
                
                adapter.create(doc.id, doc).then(function () {
                    adapter.find('', doc.id).then(function (doc) {
                        should.exist(doc);
                        done();
                    });
                });
                
            });
        });

    });

//};
