'use strict';
const customTypesHelpers = require('../lib/custom-types');
const _ = require('lodash');
const sinon = require('sinon');
const fortune = require('../lib/fortune');

describe('custom-types util', function () {
  describe('Custom Types', function () {
    let sandbox;
    beforeEach(function () {
      sandbox = sinon.createSandbox();
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('Sandbox', function () {
      let app;
      beforeEach(function () {
        app = fortune({ adapter: 'mongodb' });
        sandbox.stub(app.adapter, 'awaitConnection').returns(Promise.resolve());
        sandbox.stub(app.adapter, 'model').callsFake(function (name, schema) {
          if (!schema) return null;
          return {};
        });
      });
      it('should allow definition of a custom type', function () {
        app.customType('money');
      });
      it('should accept a user-facing schema for a custom type', function () {
        app
          .customType('money', {
            amount: Number,
            currency: String,
          })
          ._customTypes['money'].should.be.ok();
      });
      it('should allow usage of the custom type in any resource via string name', function () {
        app.customType('money', {
          amount: Number,
          currency: String,
        });
        const flight = app.resource('flight', {
          price: 'money',
        });
        const schema = flight._resources['flight'].schema;
        schema.price.should.be.ok();
        schema.price.amount.should.eql(Number);
        schema.price.currency.should.eql(String);
      });

      describe('Hooks', function () {
        beforeEach(function () {
          app
            .customType('distance', {
              km: Number,
              m: Number,
              pc: Number,
            })
            .beforeWrite([
              {
                name: 'writemeter',
                init: function () {
                  return function () {
                    return this;
                  };
                },
              },
            ])
            .afterRead([
              {
                name: 'readmeter',
                init: function () {
                  return function () {
                    return this;
                  };
                },
              },
            ]);
        });

        it('should accept a hook for a custom type', function () {
          app._customTypes['distance'].should.be.ok();
        });

        it('should inject all the hooks to provided resource', function () {
          app.resource('flight', {
            distance: 'distance',
          });

          const hooks = app._resources['flight'].hooks;

          _.find(hooks._before.write, function (hook) {
            return hook.name.match(/writemeter/);
          }).should.be.ok();

          _.find(hooks._after.read, function (hook) {
            return hook.name.match(/readmeter/);
          }).should.be.ok();
        });

        it('should make hook name unique by adding field name to it', function () {
          app.resource('flight', {
            distance: 'distance',
          });

          const hooks = app._resources['flight'].hooks;

          _.find(hooks._before.write, function (hook) {
            //Check beforeEach for this type def
            return hook.name == 'distance-writemeter-distance';
          }).should.be.ok();

          _.find(hooks._after.read, function (hook) {
            return hook.name == 'distance-readmeter-distance';
          }).should.be.ok();
        });

        it('should not hide any existing hooks', function () {
          app
            .customType('wtfmeter', {
              wtf: Number,
              ahas: Number,
            })
            .beforeWrite([
              {
                name: 'wtfwriter',
                init: function () {
                  return function () {
                    return { wtf: 4, ahas: 2 };
                  };
                },
              },
            ])
            .afterRead([
              {
                name: 'wtfreader',
                init: function () {
                  return function () {
                    return this;
                  };
                },
              },
            ]);

          app
            .resource('developer', {
              wtf: 'wtfmeter',
            })
            .beforeWrite([
              {
                name: 'kick',
                init: function () {
                  return function () {
                    return this;
                  };
                },
              },
            ]);
          const hooks = app._resources['developer'].hooks;
          const wtfwriter = _.find(hooks._before.write, function (hook) {
            return hook.name == 'wtfmeter-wtfwriter-wtf';
          });
          const kick = _.find(hooks._before.write, function (hook) {
            return hook.name == 'kick';
          });

          wtfwriter.should.be.ok();
          kick.should.be.ok();
        });

        it('should inject entire hook set for each field in a resource using the custom type', function () {
          app
            .customType('wtfmeter', {
              wtf: Number,
              ahas: Number,
            })
            .beforeWrite([
              {
                name: 'wtfwriter',
                init: function () {
                  return function () {
                    return { wtf: 4, ahas: 2 };
                  };
                },
              },
            ])
            .afterRead([
              {
                name: 'wtfreader',
                init: function () {
                  return function () {
                    return this;
                  };
                },
              },
            ]);

          app.resource('developer', {
            wtfcurrent: 'wtfmeter', //on go-around...
            wtf2end: 'wtfmeter', //forget it
          });

          const hooks = app._resources['developer'].hooks;
          const wtf2end = _.find(hooks._before.write, function (hook) {
            return hook.name == 'wtfmeter-wtfwriter-wtf2end';
          });
          const wtfcurrent = _.find(hooks._before.write, function (hook) {
            return hook.name == 'wtfmeter-wtfwriter-wtfcurrent';
          });

          wtf2end.should.be.ok();
          wtfcurrent.should.be.ok();
        });

        describe('linked data', function () {
          let writewtf, readwtf;
          beforeEach(function () {
            app
              .customType('wtfmeter', {
                wtf: Number,
                ahas: Number,
              })
              .beforeWrite([
                {
                  name: 'writemeter',
                  init: function () {
                    return function () {
                      writewtf = this;
                      return Promise.resolve({ wtf: 4, ahas: 2 });
                    };
                  },
                },
              ])
              .afterRead([
                {
                  name: 'readmeter',
                  init: function () {
                    return function () {
                      readwtf = this;
                      readwtf.ahas = readwtf.ahas + 1;
                      return Promise.resolve(readwtf);
                    };
                  },
                },
              ]);
            app.resource('developer', {
              wtfpersecond: 'wtfmeter',
            });
          });

          it('should bind the custom type\'s inner hooks to the data linked only, skipping entire resource', function () {
            const hook = _.find(
              app._resources['developer'].hooks._before.write,
              function (hook) {
                return hook && hook.name == 'wtfmeter-writemeter-wtfpersecond';
              },
            );
            hook.fn.call({ wtfpersecond: 3 }, {}, {}).then(function () {
              writewtf.should.eql(3);
            });
          });
          it('should set the linked data inside the resource to whatever custom data hooks return', function () {
            const hook = _.find(
              app._resources['developer'].hooks._before.write,
              function (hook) {
                return hook && hook.name == 'wtfmeter-writemeter-wtfpersecond';
              },
            );

            hook.fn
              .call({ wtfpersecond: { wtf: 3 } }, {}, {})
              .then(function (developer) {
                developer.should.eql({ wtfpersecond: { wtf: 4, ahas: 2 } });
              });
          });
        });
      });

      describe('Database Schema', function () {
        it('should be accepted', function () {
          app.customType(
            'wtfmeter',
            {
              wtf: Number,
              ahas: Number,
            },
            {
              dbschema: {
                wtfahas: String,
              },
            },
          );
          app._customTypes['wtfmeter'].should.be.ok();
          app._customTypes['wtfmeter'].dbschema.should.eql({ wtfahas: String });
        });
        it('should be optional', function () {
          app.customType('wtfmeter', {
            wtf: Number,
            ahas: Number,
          });
          app._customTypes['wtfmeter'].should.be.ok();
        });
      });
    });

    describe('Test Drive', function () {
      let app, toDbFormatter, fromDbFormatter;
      before(function () {
        toDbFormatter = sinon.spy(function () {
          return this;
        });

        fromDbFormatter = sinon.spy(function () {
          return Promise.resolve(this);
        });

        app = fortune({ adapter: 'mongodb' });
        app
          .customType('money', {
            amount: Number,
            currency: String,
          })
          .beforeWrite([
            {
              name: 'cast-to-db',
              init: function () {
                return toDbFormatter;
              },
            },
          ])
          .afterRW([
            {
              name: 'card-from-db',
              init: function () {
                return fromDbFormatter;
              },
            },
          ]);

        app.resource(
          'flight',
          {
            price: 'money',
            airport: String,
          },
          {
            hooks: {},
          },
        );
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000); // awaitConnection
        });
      });
      afterEach(function () {
        toDbFormatter.resetHistory();
        fromDbFormatter.resetHistory();
      });

      it('should use provided schema underground', function () {
        return app.direct
          .create('flights', {
            body: { flights: [{ price: { amount: 1000, currency: 'GBP' } }] },
          })
          .then(function (result) {
            result.body.flights[0].price.amount.should.eql(1000);
            result.body.flights[0].price.currency.should.eql('GBP');
          })
          .catch(function (err) {
            console.error(err);
          });
      });
      it('should automatically convert data to appropriate format', function () {
        return app.direct
          .create('flights', {
            body: {
              flights: [{ price: { amount: '1000.0000', currency: 'GBP' } }],
            },
          })
          .then(function (result) {
            result.body.flights[0].price.amount.should.eql(1000);
            result.body.flights[0].price.currency.should.eql('GBP');
          });
      });
      it('should support formatters returning promises', function () {
        return app.direct
          .create('flights', {
            body: {
              flights: [{ price: { amount: '1000.0000', currency: 'GBP' } }],
            },
          })
          .then(function () {
            fromDbFormatter.callCount.should.equal(1);
            fromDbFormatter.calledOn({
              price: { amount: 1000, currency: 'GBP' },
            }).should.be.ok;
          });
      });
      it('should support formatters returning plain results', function () {
        return app.direct
          .create('flights', {
            body: {
              flights: [{ price: { amount: '1000.0000', currency: 'GBP' } }],
            },
          })
          .then(function () {
            toDbFormatter.callCount.should.equal(1);
            toDbFormatter.calledOn({
              price: { amount: '1000.0000', currency: 'GBP' },
            }).should.be.ok;
          });
      });
      it('should not run custom-type formatter if type path does not exist in the body', function () {
        return app.direct
          .create('flights', { body: { flights: [{ airport: 'STN' }] } })
          .then(function () {
            toDbFormatter.callCount.should.equal(0);
          });
      });
    });
  });

  describe('pullCustomTypePaths', function () {
    let types, type;
    beforeEach(function () {
      type = {
        hooks: ['hook'],
        schema: {},
      };
      types = {
        date: type,
      };
    });
    it('should correctly identify custom-types paths in top-level keys', function () {
      const schema = {
        date: 'date',
      };
      customTypesHelpers.mapCustomTypes(schema, types).should.eql([
        {
          hooks: ['hook'],
          path: 'date',
          schema: {},
          type: type,
          typeId: 'date',
        },
      ]);
    });
    it('should correctly identify custom-types in embedded objects', function () {
      const schema = {
        nested: {
          date: 'date',
          a: {
            b: 'date',
          },
        },
      };
      customTypesHelpers.mapCustomTypes(schema, types).should.eql([
        {
          path: 'nested.date',
          hooks: ['hook'],
          schema: {},
          typeId: 'date',
          type: type,
        },
        {
          path: 'nested.a.b',
          hooks: ['hook'],
          schema: {},
          typeId: 'date',
          type: type,
        },
      ]);
    });
    it('should correctly identify custom-types in sub-docs', function () {
      const schema = {
        array: [{ date: 'date' }],
        reference: ['ref'],
      };
      customTypesHelpers.mapCustomTypes(schema, types).should.eql([
        {
          path: 'array.0.date',
          hooks: ['hook'],
          schema: {},
          typeId: 'date',
          type: type,
        },
      ]);
    });
    it('should not pick end schema path options as nested docuemnt', function () {
      const schema = {
        path: {
          type: String,
          default: 'whatever',
        },
      };

      (function () {
        customTypesHelpers.mapCustomTypes(schema, types).should.eql([]);
      }.should.not.throw());
    });
  });
  describe('rewriteSchemaPaths', function () {
    let paths, type;
    beforeEach(function () {
      type = {};
      paths = [];
    });
    it('should rewrite top-level types on schema', function () {
      const schema = { date: 'date' };
      paths.push({ schema: type, path: 'date' });
      customTypesHelpers.rewriteSchema(schema, paths);
      schema.date.should.equal(type);
    });
    it('should rewrite nested object types on schema', function () {
      const schema = { nested: { date: 'date' } };
      paths.push({ schema: type, path: 'nested.date' });
      customTypesHelpers.rewriteSchema(schema, paths);
      schema.nested.date.should.equal(type);
    });
    it('should rewrite embedded documents types on schema', function () {
      const schema = { array: [{ date: 'date' }] };
      paths.push({ schema: type, path: 'array.0.date' });
      customTypesHelpers.rewriteSchema(schema, paths);
      schema.array[0].date.should.equal(type);
    });
  });
  describe('applyHook', function () {
    let fn, doc, req, res;
    beforeEach(function () {
      fn = sinon.stub();
      _.range(10).forEach(function (i) {
        fn.onCall(i).returns(i);
      });

      doc = {
        top: 'a',
      };
      req = {};
      res = {};
    });
    it('should apply hook fn to correct path', function () {
      return customTypesHelpers
        .applyHook(fn, 'top', doc, req, res)
        .then(function () {
          fn.callCount.should.equal(1);
          fn.getCall(0).args[0].should.equal(req);
          fn.getCall(0).args[1].should.equal(res);
          doc.top.should.equal(0);
        });
    });
    it('should apply hook fn to all items of embedded array', function () {
      doc = { array: [{ top: 'a' }, { top: 'b' }] };

      return customTypesHelpers
        .applyHook(fn, 'array.0.top', doc, req, res)
        .then(function () {
          fn.callCount.should.equal(2);

          doc.array[0].should.eql({ top: 0 });
          fn.getCall(0).args[0].should.equal(req);
          fn.getCall(0).args[1].should.equal(res);

          doc.array[1].should.eql({ top: 1 });
          fn.getCall(1).args[0].should.equal(req);
          fn.getCall(1).args[1].should.equal(res);
        });
    });
    it('shoud apply hook to correct nested document branch', function () {
      doc = {
        nested: {
          second: {
            top: 'a',
          },
        },
      };

      return customTypesHelpers
        .applyHook(fn, 'nested.second.top', doc, req, res)
        .then(function () {
          fn.callCount.should.equal(1);

          doc.nested.second.top.should.equal(0);
        });
    });
    it('gets fancy', function () {
      doc = {
        top: 'a',
        nested: {
          top: 'a',
        },
        array: [
          {
            one: [{ two: { three: 'b' } }],
          },
        ],
      };

      const paths = ['top', 'nested.top', 'array.0.one.0.two.three'];

      return Promise.all(
        paths.map(function (path) {
          return customTypesHelpers.applyHook(fn, path, doc, req, res);
        }),
      ).then(function () {
        doc.should.eql({
          top: 0,
          nested: { top: 1 },
          array: [
            {
              one: [
                {
                  two: { three: 2 },
                },
              ],
            },
          ],
        });
      });
    });
  });
  it('gets fancy', function () {
    const schema = {
      a: 'date',
      b: { c: { d: { e: 'date' } } },
      f: [{ g: { h: [{ i: 'date' }] } }],
    };
    const date = {};
    const types = {
      date: { schema: date },
    };
    const config = customTypesHelpers.mapCustomTypes(schema, types);
    console.log(config);
    customTypesHelpers.rewriteSchema(schema, config);
    schema.a.should.equal(date);
    schema.b.c.d.e.should.equal(date);
    schema.f[0].g.h[0].i.should.equal(date);
  });
});
