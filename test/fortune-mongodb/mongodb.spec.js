const should = require('should');
const sinon = require('sinon');
const request = require('supertest');
const RSVP = require('rsvp');

const _ = require('lodash');

module.exports = function (options) {

  describe('MongoDB adapter', function () {
    let adapter, ids, baseUrl;

    beforeEach(function () {
      baseUrl = options.baseUrl;
      ids = options.ids;
      adapter = options.app.adapter;
    });

    describe('Creation', function () {
      it('should be able to create document with provided id', function (done) {
        const doc = {
          id: '123456789012345678901234',
        };
        adapter.create('pet', doc).then(function () {
          const model = adapter.model('pet');
          model
            .findOne({ _id: '123456789012345678901234' }).then(function (doc) {
              should.exist(doc);
              done();
            })
            .catch(done);
        });
      });
      it('should be able to cast provided id to proper type', function (done) {
        const doc = {
          id: '123456789012345678901234',
        };
        adapter.create('person', doc).then(function () {
          const model = adapter.model('person');
          model
            .findOne({ email: '123456789012345678901234' }).then(function (doc) {
              should.exist(doc);
              done();
            })
            .catch(done);
        });
      });
      it('should upsert where the appropriate upsert keys are specified', function () {
        const doc = {
          id: '123456789012345678901234',
          upsertTest: 'foo',
        };

        const model = adapter.model('person');
        model.schema.upsertKeys = ['upsertTest'];

        let response = null,
          origUpsert = adapter._shouldUpsert;

        adapter._shouldUpsert = function () {
          return (response = origUpsert.apply(this, arguments));
        };

        return adapter.create('person', doc).then(function () {
          should.exist(response);
          response.status.should.equal(true);
          response.opts.upsert.should.equal(true);

          return model
            .findOne({ email: '123456789012345678901234' })
            .then(function (doc) {
              should.exist(doc);
              adapter._shouldUpsert = origUpsert;
            })
            .catch();
        });
      });
      it('should not upsert where the appropriate upsert keys are not specified', function (done) {
        const doc = {
          id: '123456789012345678901234',
          upsertTestYYY: 'foo',
        };

        const model = adapter.model('person');
        model.schema.upsertKeys = ['upsertTest'];

        let response = null,
          origUpsert = adapter._shouldUpsert;

        adapter._shouldUpsert = function () {
          return (response = origUpsert.apply(this, arguments));
        };

        adapter.create('person', doc).then(function () {
          should.exist(response);
          response.status.should.equal(false);
          response.opts.upsert.should.equal(false);

          model
            .findOne({ email: '123456789012345678901234' })
            .then(function (doc) {
              should.exist(doc);
              adapter._shouldUpsert = origUpsert;
              done();
            })
            .catch(done);
        });
      });
    });
    describe('Relationships', function () {
      it('mock', function (done) {
        request(baseUrl)
          .post('/people')
          .set('content-type', 'application/json')
          .send(
            JSON.stringify({
              people: [
                {
                  email: 'testing',
                  links: {
                    soulmate: ids.people[0],
                  },
                },
              ],
            }),
          )
          .end(function (err, res) {
            should.not.exist(err);
            res.statusCode.should.equal(201);
            done();
          });
      });
      describe('_updateRelationships', function () {
        let primaryModel, referencedModel;
        let resourceData;
        let originalModels;
        beforeEach(function () {
          originalModels = adapter._models;
          
          sinon.stub(adapter, '_getInverseReferences');
          sinon.stub(adapter, '_updateOneToOne').returns(RSVP.resolve());
          sinon.stub(adapter, '_updateOneToMany').returns(RSVP.resolve());
          sinon.stub(adapter, '_updateManyToOne').returns(RSVP.resolve());
          sinon.stub(adapter, '_updateManyToMany').returns(RSVP.resolve());

          primaryModel = {
            modelName: 'TBD below',
            schema: { tree: {} },
          };
          referencedModel = {
            modelName: 'TBD below',
            schema: { tree: {} },
          };
          resourceData = {};

          adapter._models = {
            person: referencedModel,
            pet: referencedModel,
          };
        });
        afterEach(function () {
          adapter._models = originalModels;
          adapter._getInverseReferences.restore();
          adapter._updateOneToOne.restore();
          adapter._updateOneToMany.restore();
          adapter._updateManyToOne.restore();
          adapter._updateManyToMany.restore();
        });
        describe('one-to-one', function () {
          it('should generate correct linking tasks with no inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = { pet: { ref: 'pet' } };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {};

            adapter._getInverseReferences.returns([]);

            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateOneToOne.callCount.should.equal(0);
                //Nothing to update here as inverse field does not exist
                done();
              })
              .catch(done);
          });
          it('should generate correct linking tasks with inverse', function (done) {
            primaryModel.modelName = 'person';
            referencedModel.schema.tree = {
              soulmate: {
                ref: 'person',
                inverse: 'soulmate',
              },
            };
            const referenceConfig = {
              inverse: 'soulmate',
              isExternal: false,
              model: 'person',
              path: 'soulmate',
              singular: true,
            };
            adapter._getInverseReferences.returns([referenceConfig]);

            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateOneToOne.callCount.should.equal(1);
                const args = adapter._updateOneToOne.getCall(0).args;
                args[0].should.equal(primaryModel);
                args[1].should.equal(referencedModel);
                args[2].should.equal(resourceData);
                args[3].should.equal(referenceConfig);
                args[4].should.eql({
                  inverse: 'soulmate',
                  model: 'person',
                  path: 'soulmate',
                  singular: true,
                });
                done();
              })
              .catch(done);
          });
        });
        describe('one-to-many', function () {
          it('should generate correct linking tasks with no inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = { pet: [{ ref: 'pet' }] };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {};

            adapter._getInverseReferences.returns([]);

            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateOneToMany.callCount.should.equal(0);
                //Nothing to update here as inverse field does not exist
                done();
              })
              .catch(done);
          });
          it('should generate correct linking tasks with inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = {
              pet: { ref: 'pet', inverse: 'owners' },
            };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {
              owners: [{ ref: 'person', inverse: 'pet' }],
            };

            const referenceConfig = {
              inverse: 'owners',
              isExternal: false,
              model: 'pet',
              path: 'pet',
              singular: true,
            };
            adapter._getInverseReferences.returns([referenceConfig]);
            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateOneToMany.callCount.should.equal(1);

                const args = adapter._updateOneToMany.getCall(0).args;
                args[0].should.equal(primaryModel);
                args[1].should.equal(referencedModel);
                args[2].should.equal(resourceData);
                args[3].should.equal(referenceConfig);
                args[4].should.eql({
                  inverse: 'pet',
                  model: 'person',
                  path: 'owners',
                  singular: false,
                });
                done();
              })
              .catch(done);
          });
        });
        describe('many-to-one', function () {
          it('should generate correct linking tasks with no inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = { pets: [{ ref: 'pet' }] };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {};
            adapter._getInverseReferences.returns([]);
            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateManyToOne.callCount.should.equal(0);
                done();
              })
              .catch(done);
          });
          it('should generate correct linking tasks with inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = {
              pets: [{ ref: 'pet', inverse: 'owner' }],
            };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {
              owner: { ref: 'person', inverse: 'pets' },
            };

            const referenceConfig = {
              inverse: 'owner',
              isExternal: false,
              model: 'pet',
              path: 'pet',
              singular: false,
            };
            adapter._getInverseReferences.returns([referenceConfig]);
            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateManyToOne.callCount.should.equal(1);

                const args = adapter._updateManyToOne.getCall(0).args;
                args[0].should.equal(primaryModel);
                args[1].should.equal(referencedModel);
                args[2].should.equal(resourceData);
                args[3].should.equal(referenceConfig);
                args[4].should.eql({
                  inverse: 'pets',
                  model: 'person',
                  path: 'owner',
                  singular: true,
                });
                done();
              })
              .catch(done);
          });
        });
        describe('many-to-many', function () {
          it('should generate correct linking tasks with no inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = { pets: [{ ref: 'pet' }] };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = { owners: [{ ref: 'person' }] };
            adapter._getInverseReferences.returns([]);
            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateManyToMany.callCount.should.equal(0);
                done();
              })
              .catch(done);
          });
          it('should generate correct linking tasks with inverse', function (done) {
            primaryModel.modelName = 'person';
            primaryModel.schema.tree = {
              pets: [{ ref: 'pet', inverse: 'owners' }],
            };
            referencedModel.modelName = 'pet';
            referencedModel.schema.tree = {
              owners: [{ ref: 'person', inverse: 'pets' }],
            };
            const referenceConfig = {
              inverse: 'owners',
              isExternal: false,
              model: 'pet',
              path: 'pets',
              singular: false,
            };
            adapter._getInverseReferences.returns([referenceConfig]);
            adapter
              ._updateRelationships(primaryModel, resourceData, [])
              .then(function () {
                adapter._updateManyToMany.callCount.should.equal(1);

                const args = adapter._updateManyToMany.getCall(0).args;
                args[0].should.equal(primaryModel);
                args[1].should.equal(referencedModel);
                args[2].should.equal(resourceData);
                args[3].should.equal(referenceConfig);
                args[4].should.eql({
                  inverse: 'pets',
                  model: 'person',
                  path: 'owners',
                  singular: false,
                });
                done();
              })
              .catch(done);
          });
        });
      });
      describe('_getAllReferences', function () {
        let model;
        beforeEach(function () {
          model = {
            schema: {
              tree: {},
            },
          };
        });
        it('should return correct to-one config', function () {
          model.schema.tree = {
            pet: { ref: 'pet', inverse: 'owner' },
          };
          adapter._getAllReferences(model).should.eql([
            {
              path: 'pet',
              model: 'pet',
              singular: true,
              inverse: 'owner',
              isExternal: undefined,
            },
          ]);
        });
        it('should return correct to-many config', function () {
          model.schema.tree = {
            pets: [{ ref: 'pet', inverse: 'owner' }],
          };
          adapter._getAllReferences(model).should.eql([
            {
              path: 'pets',
              model: 'pet',
              singular: false,
              inverse: 'owner',
              isExternal: undefined,
            },
          ]);
        });
        it('should include links without inverse fields', function () {
          model.schema.tree = {
            pet: { ref: 'pet' },
            spouse: { ref: 'person', inverse: 'spouse' },
          };
          adapter._getAllReferences(model).should.eql([
            {
              inverse: undefined,
              isExternal: undefined,
              model: 'pet',
              path: 'pet',
              singular: true,
            },
            {
              path: 'spouse',
              model: 'person',
              singular: true,
              inverse: 'spouse',
              isExternal: undefined,
            },
          ]);
        });
      });
      describe('synchronizing many-to-many', function () {
        it('should keep in sync many-to-many relationship', async function () {
          const match = await adapter.preupdate('person', ids.people[0]);
          const updated = await adapter.update('person', match, {
            $push: { houses: { $each: [ids.houses[0]] } },
          });

          updated.links.houses[0]
            .toString()
            .should.equal(ids.houses[0].toString());
          const found = await adapter.find('house', { id: ids.houses[0] });
          found.links.owners[0].should.equal(ids.people[0]);
        });
        it('should sync correctly when many docs have reference', async function () {
          const upd = {
            $push: {
              houses: { $each: ids.houses },
            },
          };
          const match = await adapter.preupdate('person', ids.people[0]);
          const updated = await adapter.update('person', match, upd);
          updated.links.houses.length.should.eql(4);

          const found = await adapter.findMany('house', {
            owners: ids.people[0],
          });

          found.length.should.equal(4);
          //Do some other updates to mix docs in Mongo
          const pushMatch = await adapter.preupdate('person', ids.people[1]);
          await adapter.update('person', pushMatch, {
            $push: { houses: ids.houses[0] },
          });

          const pullMatch = await adapter.preupdate('person', ids.people[0]);
          const pulled = await adapter.update('person', pullMatch, {
            $pull: { houses: ids.houses[0] },
          });

          //Now there should be only three houses that person[0] owns
          pulled.links.houses.length.should.eql(3);
          const relatedHouse = await adapter.findMany('house', {
            owners: ids.people[0],
          });

          relatedHouse.length.should.eql(3);
          //Assert there's no house[0] in found docs
          relatedHouse.forEach(function (item) {
            item.id.toString().should.not.equal(ids.houses[0].toString());
          });
        });
      });
      describe('sync path selection', function () {
        it('should have a method to identify changed paths', function () {
          adapter._getModifiedRefs.should.be.a.Function;
          const update = {
            refPath: 'some new value',
            $push: {
              manyRefOne: 'one',
            },
            $pull: {
              manyRefTwo: 'two',
            },
            $addToSet: {
              manyRefThree: 'three',
            },
            $unset: {
              'nested.ref': 'nested',
            },
          };
          const modifiedPaths = adapter._getModifiedRefs(update);
          modifiedPaths.indexOf('refPath').should.not.equal(-1);
          modifiedPaths.indexOf('manyRefOne').should.not.equal(-1);
          modifiedPaths.indexOf('manyRefTwo').should.not.equal(-1);
          modifiedPaths.indexOf('manyRefThree').should.not.equal(-1);
          modifiedPaths.indexOf('nested.ref').should.not.equal(-1);
        });
        it('should not run updates on related documents which binding path were not modified during the update', async function () {
          const oto = adapter._updateOneToOne;
          const otm = adapter._updateOneToMany;
          const mtm = adapter._updateManyToMany;
          const mto = adapter._updateManyToOne;
          let mockCalled = false;
          adapter._updateOneToOne = function () {
            mockCalled = true;
          };
          adapter._updateOneToMany = function () {
            mockCalled = true;
          };
          adapter._updateManyToMany = function () {
            mockCalled = true;
          };
          adapter._updateManyToOne = function () {
            mockCalled = true;
          };
          const match = await adapter.preupdate('person', ids.people[0]);
          return adapter
            .update('person', match, { $set: { name: 'Filbert' } })
            .then(function () {
              mockCalled.should.equal(false);
              adapter._updateOneToOne = oto;
              adapter._updateOneToMany = otm;
              adapter._updateManyToMany = mtm;
              adapter._updateManyToOne = mto;
            });
        });
        it('should update references if ref path was changed', async function () {
          const oto = adapter._updateOneToOne;
          let mockCalled = false;
          adapter._updateOneToOne = function () {
            mockCalled = true;
            return oto.apply(null, arguments);
          };
          const match = await adapter.preupdate('person', ids.people[0]);
          return adapter
            .update('person', match, { $set: { soulmate: ids.people[1] } })
            .then(function () {
              mockCalled.should.equal(true);
              adapter._updateOneToOne = oto;
            });
        });
      });
    });
    describe('Select', function () {
      describe('count', function () {
        it('should provide interface for counting resources', function () {
          return adapter.count('person').then(function (docs) {
            should.exist(docs);
            docs.should.eql(4);
          });
        });
        it('should count results falling under query', function () {
          return adapter
            .count('person', { birthday: { $gte: new Date(1995, 0, 1) } })
            .then(function (docs) {
              should.exist(docs);
              docs.should.eql(3);
            });
        });
        it('should ignore not valid queries', function () {
          return adapter.count('person', 'some').then(function (docs) {
            should.exist(docs);
            docs.should.eql(4);
          });
        });
      });

      describe('findMany', function () {
        it('should provide interface for selecting fields to return', function () {
          const projection = {
            select: ['name'],
          };
          return adapter
            .findMany('person', {}, projection)
            .then(function (docs) {
              should.exist(docs);
            });
        });
        it('should select specified fields for a collection', function () {
          const projection = {
            select: ['name', 'appearances', 'pets'],
          };
          return adapter
            .findMany('person', {}, projection)
            .then(function (docs) {
              Object.keys(docs[0]).length.should.equal(3);
              should.exist(docs[0].name);
              should.exist(docs[0].appearances);
              should.exist(docs[0].id);
            });
        });
        it('should return all existing fields when no select is specified', function () {
          return adapter.findMany('person').then(function (docs) {
            docs.forEach(function (doc) {
              let expected = 10;

              if (_.has(doc, '_internal')) expected++;
              if (_.has(doc, 'lastAccess')) expected++;
              const keysLen = Object.keys(doc).length;

              keysLen.should.equal(expected);
            });
          });
        });
        it('should not affect business id selection', function () {
          return adapter
            .findMany('person', [ids.people[0]], { select: ['name'] })
            .then(function (docs) {
              docs[0].id.should.equal(ids.people[0]);
              should.not.exist(docs[0].email);
            });
        });
        it('should apply be able to apply defaults for query and projection', function () {
          return adapter.findMany('person');
        });
        it('should be able to work with numerical limits', function () {
          return adapter.findMany('person', 1).then(function (docs) {
            docs.length.should.equal(1);
          });
        });
      });

      describe('find', function () {
        beforeEach(async function () {
          const match = await adapter.preupdate('person', ids.people[0]);
          await adapter.update('person', match, {
            $push: { pets: ids.pets[0] },
          });
          await adapter.update('person', match, {
            $set: { soulmate: ids.people[1] },
          });
          await adapter.update('person', match, {
            $push: { houses: ids.houses[0] },
          });
        });
        it('should provide interface for selecting fields to return', function (done) {
          const projection = {
            select: ['name', 'pets', 'soulmate'],
          };
          (function () {
            adapter
              .find('person', { email: ids.people[0] }, projection)
              .then(function (docs) {
                should.exist(docs);
                done();
              });
          }.should.not.throw());
        });
        it('should select specified fields for a single document', function (done) {
          const projection = {
            select: ['name', 'soulmate', 'pets', 'houses'],
          };
          adapter
            .find('person', ids.people[0], projection)
            .then(function (doc) {
              Object.keys(doc).length.should.equal(3);
              Object.keys(doc.links).length.should.equal(3);
              should.exist(doc.name);
              should.exist(doc.links.pets);
              should.exist(doc.links.soulmate);
              should.exist(doc.links.houses);
              done();
            });
        });
        it('should return all existing fields when no select is specified', function (done) {
          adapter.find('person', ids.people[0]).then(function (doc) {
            //hooks add their black magic here.
            //See what you have in fixtures + what beforeWrite hooks assign in addiction
            //+ soulmate from before each
            let expected = 11;

            if (doc._internal) expected++;
            if (doc.lastAccess) expected++;
            Object.keys(doc).length.should.equal(expected);
            done();
          });
        });
        it('should not affect business id selection', function (done) {
          adapter
            .find('person', ids.people[0], {
              select: ['name', 'soulmate', 'pets', 'houses'],
            })
            .then(function (doc) {
              doc.id.should.equal(ids.people[0]);
              doc.links.soulmate.should.equal(ids.people[1]);
              doc.links.houses[0].toString().should.equal(ids.houses[0]);
              doc.links.pets[0].toString().should.equal(ids.pets[0]);
              should.not.exist(doc.email);
              done();
            });
        });
        it('should apply be able to apply defaults for query and projection', function (done) {
          (function () {
            adapter.find('person', ids.people[0]);
          }.should.not.throw());
          done();
        });
      });
    });
    describe('Filtering', function () {
      it('should be able to filter date by exact value', function (done) {
        adapter
          .findMany('person', { birthday: '2000-01-01' })
          .then(function (docs) {
            docs.length.should.equal(1);
            docs[0].name.should.equal('Robert');
            done();
          });
      });
      it('should be able to filter date range: exclusive', function () {
        const query = {
          birthday: {
            lt: '2000-02-02',
            gt: '1990-01-01',
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(3);
        });
      });
      it('should be able to filter date range: inclusive', function () {
        const query = {
          birthday: {
            gte: '1995-01-01',
            lte: '2000-01-01',
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(3);
        });
      });
      it('should be able to filter date null', function () {
        const query = {
          lastAccess: {
            $ne: null,
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(1);
        });
      });
      it('should be able to filter number range: exclusive', function () {
        const query = {
          appearances: {
            gt: 1934,
            lt: 4000,
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(1);
        });
      });
      it('should be able to filter number range: inclusive', function () {
        const query = {
          appearances: {
            gte: 1934,
            lte: 3457,
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(2);
        });
      });

      it('should be tolerant to $in:undefined queries', function () {
        const query = { $in: undefined };
        return adapter.findMany('person', query);
      });

      it('should be tolerant to $in:null queries', function () {
        const query = { $in: null };

        return adapter.findMany('person', query);
      });

      it('should be able to run regex query with default options', function () {
        const queryLowercase = {
          email: {
            regex: 'bert@',
          },
        };
        const queryUppercase = {
          email: {
            regex: 'Bert@',
          },
        };
        return adapter
          .findMany('person', queryLowercase)
          .then(function (docs) {
            docs.length.should.equal(2);
          })
          .then(function () {
            return adapter
              .findMany('person', queryUppercase)
              .then(function (docs) {
                docs.length.should.equal(0);
              });
          });
      });
      it('should be possible to specify custom options', function () {
        const query = {
          name: {
            regex: 'WALLY',
            options: 'i',
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(1);
          docs[0].name.should.equal('Wally');
        });
      });
      it('should treat empty regex as find all', function () {
        const query = {
          email: {
            regex: '',
          },
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(4);
        });
      });
      it('should deeply parse nested $and, $or, or, and queries', function () {
        const query = {
          $or: [
            {
              or: [
                {
                  $and: [
                    {
                      and: [
                        {
                          name: {
                            regex: 'WALLY',
                            options: 'i',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        };
        return adapter.findMany('person', query).then(function (docs) {
          docs.length.should.equal(1);
          docs[0].name.should.equal('Wally');
        });
      });
    });
  });
};
