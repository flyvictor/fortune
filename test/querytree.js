const querytree = require('../lib/querytree');
require('should');
const sinon = require('sinon');
const neighbourhood = require('./neighbourhood');

module.exports = function (options) {
  let ids;
  beforeEach(function () {
    ids = options.ids;
  });
  describe('Query tree', function () {
    describe('Nodes', function () {
      let tree, req, director;
      beforeEach(function () {
        req = {};

        director = {
          methods: {
            get: sinon.stub(),
          },
        };

        director.methods.get.withArgs('people').returns(
          new Promise(function (resolve) {
            resolve({
              body: {
                people: [{ id: 'resource-id' }],
              },
            });
          }),
        );

        director.methods.get.withArgs('pets').returns(
          new Promise(function (resolve) {
            resolve({
              body: {
                pets: [{ id: 'resource-id' }],
              },
            });
          }),
        );

        tree = querytree.init({
          _resources: options.app._resources,
          inflect: options.app.inflect,
          director: director,
        });
      });
      describe('Query preprocessing', function () {
        it('it should not modify query to plain fields', function (done) {
          director.methods.get.returns(
            new Promise(function (resolve) {
              resolve({ body: { people: [] } });
            }),
          );
          const node = new tree._QueryNode(req, 'person', { name: 'Dilbert' });
          node.resource.should.eql('person');
          node.query.then(function (parsed) {
            parsed.should.eql({ name: 'Dilbert' });
            done();
          });
        });
        it('should handle case of reference defined with object', function (done) {
          const node = new tree._QueryNode(
            req,
            'person',
            { soulmate: { name: 'Wally' } },
            true,
          );
          node.resource.should.eql('person');
          node.query
            .then(function (parsed) {
              director.methods.get.callCount.should.equal(1);
              const args = director.methods.get.getCall(0).args;
              args[0].should.equal('people');
              args[1].should.eql({
                query: {
                  filter: { name: 'Wally' },
                  fields: 'id',
                  limit: 0,
                },
                linker: undefined,
              });
              parsed.should.eql({ soulmate: { $in: ['resource-id'] } });
              done();
            })
            .catch(done);
        });
        it('should handle case of reference defined with array', function (done) {
          const node = new tree._QueryNode(
            req,
            'person',
            { lovers: { name: 'Sally' } },
            true,
          );
          node.resource.should.eql('person');
          node.query
            .then(function (parsed) {
              director.methods.get.callCount.should.equal(1);
              const args = director.methods.get.getCall(0).args;
              args[0].should.equal('people');
              args[1].should.eql({
                query: {
                  filter: { name: 'Sally' },
                  fields: 'id',
                  limit: 0,
                },
                linker: undefined,
              });
              parsed.should.eql({ lovers: { $in: ['resource-id'] } });
              done();
            })
            .catch(done);
        });
        it('should handle case of reference defined with a string in array', function (done) {
          const node = new tree._QueryNode(
            req,
            'person',
            { pets: { name: 'Tobi' } },
            true,
          );
          node.resource.should.eql('person');
          node.query
            .then(function (parsed) {
              director.methods.get.callCount.should.equal(1);
              const args = director.methods.get.getCall(0).args;
              args[0].should.equal('pets');
              args[1].should.eql({
                query: {
                  filter: { name: 'Tobi' },
                  fields: 'id',
                  limit: 0,
                },
                linker: undefined,
              });
              parsed.should.eql({ pets: { $in: ['resource-id'] } });
              done();
            })
            .catch(done);
        });
        it('should handle case of object that defines business PK', function (done) {
          const node = new tree._QueryNode(
            req,
            'person',
            { lovers: { email: 'dilbert@mailbert.com' } },
            true,
          );
          node.resource.should.eql('person');
          node.query
            .then(function (parsed) {
              director.methods.get.callCount.should.equal(1);
              const args = director.methods.get.getCall(0).args;
              args[0].should.equal('people');
              args[1].should.eql({
                query: {
                  filter: { email: 'dilbert@mailbert.com' },
                  fields: 'id',
                  limit: 0,
                },
                linker: undefined,
              });
              parsed.should.eql({ lovers: { $in: ['resource-id'] } });
              done();
            })
            .catch(done);
        });
      });
    });
    describe('Integration to fortune', function () {
      let adapter, tree, request;
      before(function () {
        adapter = options.app.adapter;
        tree = querytree.init(options.app);
      });
      beforeEach(function (done) {
        request = {};
        //Create little social network
        neighbourhood(adapter, ids).then(function () {
          done();
        });
      });
      it('should be able to handle complex query', function (done) {
        //should lead to ids.houses[0]
        const query = {
          // give me a house
          owners: {
            //whose owner is the guy
            soulmate: {
              //whose soulmate is that girl
              pets: {
                //who owns a pet
                name: 'Dogbert', //named Dogbert
              },
              cars: {
                //and drives this car
                licenseNumber: ids.cars[1],
              },
            },
          },
        };
        tree.parse(request, 'house', query).then(function (result) {
          //ids.houses[0] owner is ids.people[0]
          result.should.eql({ owners: { $in: [ids.people[0]] } });
          done();
        });
      });
      describe('query operators handling', function () {
        it('should work with regex', function (done) {
          const query = {
            //give me a house
            owners: {
              //whose owner is a guy
              soulmate: {
                //who loves that girl
                pets: {
                  //who owns a pet
                  name: {
                    //i don't know it's name exactly
                    regex: 'dog', //but i'm sure it's something like a dog
                    options: 'i',
                  },
                },
              },
            },
          };
          tree.parse(request, 'house', query).then(function (result) {
            result.should.eql({ owners: { $in: [ids.people[0]] } });
            done();
          });
        });
        it('should work with gt/lt/lte/gte', function (done) {
          const query = {
            owners: {
              appearances: {
                gt: 1000,
                lt: 2000,
              },
            },
          };
          tree.parse(request, 'house', query).then(function (result) {
            result.should.eql({ owners: { $in: [ids.people[1]] } });
            done();
          });
        });
        it('should pass all $-prefixed fields transparently', function (done) {
          const query = {
            owners: {
              $exists: true,
            },
          };
          tree.parse(request, 'house', query).then(function (result) {
            result.should.eql({ owners: { $exists: true } });
            const complexQuery = {
              $or: [{ owners: { $exists: true } }],
            };
            tree.parse(request, 'house', complexQuery).then(function (result) {
              result.should.eql({ $or: [{ owners: { $exists: true } }] });
              done();
            });
          });
        });
      });
    });
  });
};
