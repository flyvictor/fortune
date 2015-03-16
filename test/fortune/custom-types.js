/**
 * Created by Mirror on 16.03.2015.
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
      request(baseUrl).post('/cars')
        .set('content-type', 'application/json')
        .send(JSON.stringify({
          cars : [{
              //Generates unique license number
              licenseNumber: "GG" + (Math.random() + "").replace('0.', ''),
              model: "TestCarWithCustomPrice",
              additionalDetails: {
                seats: 2,
                price: {
                  value : 15550.20,
                  currency : "USD"
                }
              }
          }]
        }))
        .expect(201)
        .end(function(err, res){
          should.not.exist(err);
          var body = JSON.parse(res.text);
          var car = body.cars[0];
          should.exist(car.additionalDetails.price);
          should.exist(car.additionalDetails.price.currency);
          should.exist(car.additionalDetails.price.value);
          car.additionalDetails.price.currency.should.equal("USD");
          car.additionalDetails.price.value.should.equal(15550.20);
          done();
        });
    });
  });
};
