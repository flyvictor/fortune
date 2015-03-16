/**
 * Created by Alexander Semchenkov on 16.03.2015.
 */
'use strict';
var should = require('should');
var request = require('supertest');

module.exports = function(options){
  describe('custom types', function(){
    var baseUrl;
    beforeEach(function(){
      baseUrl = options.baseUrl;
    });
    it('checking custom type defined correctly', function(done){
      request(baseUrl).post('/car')
        .set('content-type', 'application/vnd.api+json')
        .send(JSON.stringify({
          licenseNumber: "GHJ353",
          model: "TestCarWithCustomPrice",
          additionalDetails: {
            seats: 2,
            price: {
              value : 15550.20,
              currency : "USD"
            }
          }
        }))
        .expect(200)
        .end(function(err, res){
          should.not.exist(err);
          res.additionalDetails.price.should.equal({
            value : 15550.20,
            currency : "USD"
          });
        });
      done();
    });
  });
};

