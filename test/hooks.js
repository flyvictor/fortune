const should = require('should');
const hooks = require('../lib/hooks');
const fortune = require('../lib/fortune');

const synchronousHook = [
  {
    name: 'syncHook',
    config: {
      a: 10,
    },
    init: function (hookConfig, fortuneConfig) {
      const a = hookConfig.a;
      const b = (fortuneConfig.options && fortuneConfig.options.b) || 100;
      return function (req, res) {
        this.hooked = a + b;
        return this;
      };
    },
  },
];

describe('hooks', function () {
  it('warning should not affect other hooks', function (done) {
    const fortune = {
      _resources: {
        defined: {},
      },
      options: {},
    };
    (function () {
      hooks.addHook.call(
        fortune,
        'undefined defined',
        synchronousHook,
        '_before',
        'read',
      );
    }.should.not.throw());
    should.exist(fortune._resources.defined.hooks._before.read);
    done();
  });
  describe('integration with fortune', function () {
    let app;
    beforeEach(function () {
      app = fortune({ adapter: 'mongodb', b: 2 });

      app.resource(
        'person',
        {
          name: String,
        },
        {
          hooks: {
            syncHook: {
              a: 1,
            },
          },
        },
      );

      app.resource(
        'pet',
        {
          name: String,
        },
        {
          hooks: {},
        },
      );
    });
    afterEach(function () {
      app._clearGlobalHooks();
    });

    it('should keep track of registered global hooks', function () {
      app.registerGlobalHook('_before', 'read', synchronousHook);
      should.exist(app._globalHooks._before.read[0]);
    });

    it('should be able to extend global hook config along with registration', function () {
      app.registerGlobalHook('_after', 'write', synchronousHook, {
        syncHook: { a: 500 },
      });
      synchronousHook[0].config.a.should.equal(10);
      const resourceConfig = {};
      hooks.initGlobalHooks(resourceConfig, app._globalHooks, {});
      resourceConfig.hooks._after.write[0].fn
        .call({})
        .should.eql({ hooked: 600 });
    });

    it('inline config should not break default hook configuration', function () {
      app.registerGlobalHook('_after', 'write', synchronousHook, {
        syncHook: { a: 500 },
      });
      synchronousHook[0].config.a.should.equal(10);
      app.registerGlobalHook('_before', 'read', synchronousHook, {
        syncHook: { a: 600 },
      });
      synchronousHook[0].config.a.should.equal(10);
    });

    it('should be able to apply registered hooks to provided resource', function () {
      app.registerGlobalHook('_before', 'read', synchronousHook);
      const resourceConfig = {};
      hooks.initGlobalHooks(resourceConfig, app._globalHooks, {});
      should.exist(resourceConfig.hooks);
      resourceConfig.hooks._before.read[0].fn.should.be.a.Function;
    });

    it('should be configurable', function () {
      app.registerGlobalHook('_before', 'read', synchronousHook);
      const resourceConfig = {
        hooksOptions: {
          syncHook: {
            a: 1,
          },
        },
      };
      const resource = {};
      hooks.initGlobalHooks(resourceConfig, app._globalHooks, {
        options: { b: 2 },
      });
      resourceConfig.hooks._before.read[0].fn.call(resource);
      resource.hooked.should.equal(3);
    });

    it('should be possible to disable specific hook in resource config', function (done) {
      app.registerGlobalHook('_before', 'read', synchronousHook);
      const resourceConfig = {
        hooksConfig: {
          syncHook: {
            disable: true,
          },
        },
      };
      hooks.initGlobalHooks(resourceConfig, app._globalHooks, {});
      should.not.exist(resourceConfig.hooks[0]);
      done();
    });
    it('should apply default hook config if resource does not provide one', function (done) {
      app.registerGlobalHook('_before', 'read', synchronousHook);
      const resourceConfig = {};
      const resource = {};
      hooks.initGlobalHooks(resourceConfig, app._globalHooks, {});
      should.exist(resourceConfig.hooks._before.read[0]);
      resourceConfig.hooks._before.read[0].fn.call(resource);
      resource.hooked.should.equal(110);
      done();
    });

    it('should provide method to register a hook for selected resource', function () {
      hooks.addHook.call(app, 'person', synchronousHook, '_after', 'read');
      should.exists(
        app._resources.person.hooks._after.read.find(
          (el) => el.name === 'syncHook',
        ),
      );
    });

    it('should be backward compatible', function () {
      const mockHook = function (req, res) {
        return 'Hello world';
      };
      hooks.addHook.call(app, 'person', mockHook, '_before', 'write');

      const beforeWriteLength =
        app._resources.person.hooks._before.write.length;
      const generatedHook =
        app._resources.person.hooks._before.write[beforeWriteLength - 1].fn;

      should.exist(generatedHook);
      generatedHook().should.equal('Hello world');
    });
    it('should be possible to provide space-separated names of resources to apply hooks to', function () {
      hooks.addHook.call(app, 'person pet', synchronousHook, '_after', 'write');

      const personHook = app._resources.person.hooks._after.write.find(
        (el) => el.name === 'syncHook',
      );
      const petHook = app._resources.pet.hooks._after.write.find(
        (el) => el.name === 'syncHook',
      );

      should.exist(personHook);
      should.exist(petHook);

      const person = {};
      personHook.fn.call(person);
      //Options are defined in hook config and fortune config
      person.hooked.should.equal(3);
      const pet = {};
      petHook.fn.call(pet);
      //Options are defined only in fortune config
      pet.hooked.should.equal(12);
    });
    it('hooks should be provided with full fortune instance', function (done) {
      const mock = [
        {
          name: 'mock',
          init: function (config, fortune) {
            should.exist(fortune);
            fortune._resource.should.equal('pet');
            fortune._resources.should.be.an.Object;
            done();
            //Hook must return a function
            return function () {};
          },
        },
      ];

      try {
        hooks.addHook.call(app, 'person', mock, '_after', 'write');
      } catch (e) {
        done(e);
      }
    });
    it('should expose hook options on resources for registered global hooks', function () {
      const fn = function () {
        return this;
      };
      const hook = [
        {
          name: 'hook-name',
          config: { whatever: 'is here' },
          init: function () {
            return fn;
          },
        },
      ];
      app = fortune({ adapter: 'mongodb', b: 2 });

      app.registerGlobalHook('_after', 'write', hook); // = function(when, type, provider, config){.call(fortune, )

      app.resource(
        'person',
        {
          name: String,
        },
        {
          hooks: {
            syncHook: {
              a: 1,
            },
          },
        },
      );

      app.resource(
        'pet',
        {
          name: String,
        },
        {
          hooks: {},
        },
      );

      const personGlobalHook = app._resources.person.hooks._after.write.find(
        (el) => el.name === 'hook-name',
      );
      personGlobalHook.should.eql({
        _priority: 0,
        name: 'hook-name',
        fn: fn,
        options: { whatever: 'is here' },
      });

      const petGlobalHook = app._resources.person.hooks._after.write.find(
        (el) => el.name === 'hook-name',
      );
      petGlobalHook.should.eql({
        _priority: 0,
        name: 'hook-name',
        fn: fn,
        options: { whatever: 'is here' },
      });
    });
    it('should expose hook options on resources for resource-specific hooks', function () {
      const fn = function () {
        return this;
      };
      const hook = [
        {
          name: 'hook-name',
          config: { whatever: 'is here' },
          init: function () {
            return fn;
          },
        },
      ];
      hooks.addHook.call(app, 'person', hook, '_after', 'write');

      app._resources.person.hooks._after.write.find(
        (el) => el.name === 'hook-name',
      ).should.eql({
          _priority: 0,
          name: 'hook-name',
          fn: fn,
          options: { whatever: 'is here' },
        
      });

      should.not.exist(app._resources.pet.hooks._after.write.find(
        (el) => el.name === 'hook-name',
      ));
    });
  });

  describe('merge', function () {
    it('should merge hooks tree with absent leafs', function () {
      const hookSet = [
        {
          _before: {
            write: [{ name: 'hook1' }, { name: 'hook2' }, { name: 'hook3' }],
          },
          _after: { read: [{ name: 'hook4' }], write: [{ name: 'hook5' }] },
        },
        { _before: { write: [{ name: 'hook6' }], read: [{ name: 'hook7' }] } },
      ];

      hooks
        .merge(hookSet)
        .should.eql({
          _after: { read: [{ name: 'hook4' }], write: [{ name: 'hook5' }] },
          _before: {
            read: [{ name: 'hook7' }],
            write: [
              { name: 'hook1' },
              { name: 'hook2' },
              { name: 'hook3' },
              { name: 'hook6' },
            ],
          },
        });
    });
  });
});
