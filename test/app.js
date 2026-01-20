var fortune = require('../lib/fortune');
var personHooks = require('./personHooks');
var _ = require("lodash");
var RSVP = require("rsvp");
var mongoosePlugin = require('./mongoose_middleware');

var hooks = {};

['beforeAll', 'beforeAllRead', 'beforeAllWrite', 'afterAll', 'afterAllRead', 'afterAllWrite'].forEach(function(type){
  hooks[type] = [{
    name: type,
    config: {
      option: type
    },
    init: function(hookOptions){
      return function(req, res){
        res.setHeader(hookOptions.option, '1');

        if (req.query['fail' + type]) {
          console.log('Failing hook',type);
          _.defer(function() {
            res.sendStatus(321);
          });
          if (req.query['fail' + type] === 'boolean')
            return false;
          else if (req.query['fail' + type] === 'undefined')
            return;
          else if (req.query['fail' + type] === 'undefined_promise')
            return new RSVP.Promise(function(resolve) { resolve(undefined); });
          else
            return new RSVP.Promise(function(resolve) { resolve(false); });
        }

        return this;
      };
    }
  }]
});

var Hook = function(hookConfig){
  return function(req, res){
    res.setHeader(hookConfig.header, hookConfig.value);
    return this;
  }
};

function HooksOrderExecutionInitFactory(app, resourceName) {
  return function() {
    return async function (req, res) {
      if (req.method !== 'POST') return this;
      if (req.get('compound-post-hooks-order-test') !== '1') return this;

      let person, pet;
      if (resourceName === 'person') {
        person = await app.adapter.model('person').findOne({
          email: this.email,
        });
        pet = await app.adapter.model('pet').findOne({
          _id: this.links.pets[0]
        });
      } else {
        person = await app.adapter.model('person').findOne({
          pets: {$in: [this.id]}
        });
        pet = await app.adapter.model('pet').findOne({
          _id: this.id
        });
      }

      res.set(`compound-post-hooks-order-${resourceName}-passed`, '0');
      if (!!person && !!pet) {
        res.set(`compound-post-hooks-order-${resourceName}-passed`, '1');
      }

      return this;
    }
  }
}


module.exports = function(options, port) {
  var app = fortune(options);

  app.inflect.inflections.plural("MOT", "MOT");
  app.inflect.inflections.plural(/^country$/, 'countries');

  app.beforeAllRW([{
    name: "by5",
    priority: 10,
    init: function(){
      return function(req, res){
        res.setHeader("globalPriority", (res.get("globalPriority") || "") + "rect");
        res.setHeader("hookedmethod", req.method);
        return this;
      }
    }
  },{
    name: "by3",
    priority: 20,
    init: function(){
      return function(req, res){
        res.setHeader("globalPriority", (res.get("globalPriority") || "") + "cor");
        return this;
      }
    }
  }]);

  app
    .beforeAll(hooks.beforeAll)
    .beforeAllRead(hooks.beforeAllRead)
    .beforeAllWrite(hooks.beforeAllWrite)
    .afterAll(hooks.afterAll)
    .afterAllRead(hooks.afterAllRead)
    .afterAllWrite(hooks.afterAllWrite)
    .customType('location', {
      lat: Number,
      lon: Number,
    })
    .beforeWrite([
      {
        name: 'todb',
        init: function () {
          return function () {
            return this;
          };
        },
      },
    ])
    .afterRead([
      {
        name: 'fromdb',
        init: function () {
          return function () {
            return this;
          };
        },
      },
    ])
    .resource(
      'person',
      {
        name: String,
        official: String,
        password: String,
        appearances: Number,
        birthday: Date,
        lastAccess: Date,
        email: { type: String },
        pets: [{ ref: 'pet', inverse: 'owner' }],
        bestPet: { ref: 'pet' },
        soulmate: { ref: 'person', inverse: 'soulmate', type: String },
        lovers: [{ ref: 'person', inverse: 'lovers', type: String }],
        externalResources: [
          { ref: 'externalResourceReference', type: String, external: true },
        ],
        cars: [{ ref: 'car', inverse: 'owner', type: String }],
        houses: [{ ref: 'house', inverse: 'owners' }],
        addresses: [{ ref: 'address', inverse: 'person' }],
        estate: { ref: 'house', inverse: 'landlord' },
        nested: {
          field1: String,
          field2: String,
          field3: {
            name: String,
          },
        },
        nestedArray: [
          {
            nestedField1: String,
            nestedField2: Number,
            location: 'location',
            index: Number,
          },
        ],
        location: 'location',
        upsertTest: String,
        _tenantId: String,
      },
      {
        defaultSort: { birthday: 1 },
        upsertKeys: ['upsertTest'],
        model: { pk: 'email' },
        hooks: {
          beforeAll: {
            option: 'beforeAllPeople',
          },
          afterAllRead: {
            option: 'afterAllReadPeople',
          },
          afterRead: {
            header: 'afterReadPerson',
            value: 'ok',
          },
        },
        actions: {
          'reset-password': require('./testing-actions').peopleResetPassword,
          'send-through': require('./testing-actions').genericSendThrough,
          'aggregate-by-birthday': require('./testing-actions').genericAction,
          echo: require('./testing-actions').echo,
        },
      },
    )
    .beforeRead([
      {
        name: 'modifyFilter',
        init: function () {
          return function (req) {
            if (req.headers['hookfilter']) {
              req.query.filter = {};
              req.query.filter.id = req.headers['hookfilter'];
            }
            return this;
          };
        },
      },
      {
        name: 'set-fortune-extension',
        init: function () {
          return function (req) {
            var extension = req.headers['set-fortune-extension'];

            switch (extension) {
              case 'dilbert':
                req.query.fortuneExtensions.push({
                  name: 'Dilbert',
                });
                break;
              case 'born-in-1995':
                req.query.fortuneExtensions.push({
                  birthday: {
                    $gte: new Date('1995-01-01T00:00:00.000Z'),
                    $lte: new Date('1996-01-01T00:00:00.000Z'),
                  },
                });
                break;
              case 'nobody':
                req.query.fortuneExtensions.push({
                  schizophrenicRabbitOfMordor: true,
                });
            }

            return this;
          };
        },
      },
    ])
    .afterWrite([
      {
        name: 'compound-post-hooks-order-test',
        init: HooksOrderExecutionInitFactory(app, 'person'),
      },
    ])
    .beforeWrite([
      {
        name: 'change-nested-$set',
        init: function () {
          return function (req, res) {
            if (
              req.query['changeNestedProperty'] &&
              req.method === 'PATCH' &&
              _.has(this, '$set.nested.field3')
            ) {
              this.$set.nested.field3.name = 'hooked name';
              res.setHeader('reqbody', JSON.stringify(req.body));
            }
            return this;
          };
        },
      },
    ])
    .afterWrite([
      {
        name: 'throw-error',
        init: function () {
          return function (req) {
            if (req.headers['throw-after-write-error']) {
              throw Error('after write error');
            }
            return this;
          };
        },
      },
    ])

    //Hooks with standard config defined in personHooks.js
    .beforeWrite([personHooks.beforeWrite])
    .afterWrite([personHooks.afterWrite])
    //A hook with overridden config in person resource configuration
    .afterRead([personHooks.afterRead])
    //Hooks with config passed along
    .beforeRead([personHooks.readFirst, personHooks.readSecond], {
      readFirst: {
        header: 'beforeReadFirst',
      },
      readSecond: {
        header: 'beforeReadSecond',
      },
    })
    .resource(
      'house',
      {
        address: String,
        owners: [{ ref: 'person', inverse: 'houses', pkType: String }],
        landlord: { ref: 'person', inverse: 'estate', pkType: String },
      },
      null,
      function (schema) {
        schema.plugin(mongoosePlugin, { paths: ['address'] });
      },
    )
    .resource(
      'pet',
      {
        name: String,
        appearances: Number,
        owner: { ref: 'person', inverse: 'pets', type: String },
        _tenantId: String,
      },
      {
        defaultSort: { appearances: 1 },
      },
    )
    .afterWrite([
      {
        name: 'compound-post-hooks-order-test',
        init: HooksOrderExecutionInitFactory(app, 'pet'),
      },
    ])

    .resource('address', {
      name: String,
      person: { ref: 'person', inverse: 'addresses', pkType: String },
      neighbour: { ref: 'person', pkType: String },
    })

    .resource(
      'car',
      {
        licenseNumber: String,
        model: String,
        owner: { ref: 'person', inverse: 'cars', type: String },
        MOT: { ref: 'service', external: true, type: String },
        additionalDetails: {
          seats: Number,
          wheels: Number,
        },
      },
      {
        model: { pk: 'licenseNumber' },
        hooks: {
          afterAll: {
            disable: true,
          },
        },
      },
    )

    .resource(
      'country',
      {
        name: String,
        slug: String,
      },
      {
        model: { shardedModel: 'country-loc' },
      },
    )

    .before('person', function (req, res) {
      this.password = Math.random();
      this.official = 'Mr. ' + this.name;
      res.setHeader('before', 'called for writes only');
      return this;
    })

    .before('person pet', function (req, res) {
      if (this.email === 'falsey@bool.com') {
        res.sendStatus(321);
        return false;
      }
      return this;
    })

    .beforeRead('pet', [
      {
        name: 'petHook',
        config: {
          header: 'petHook',
          value: 'ok',
        },
        init: Hook,
      },
    ])
    .beforeRW([
      {
        name: 'filtered-out',
        init: function () {
          return function () {
            throw new Error('This hook should not run');
          };
        },
      },
    ])
    .beforeRead('house', [
      {
        name: 'div5',
        priority: 10,
        init: function () {
          return function (req, res) {
            res.setHeader(
              'resourcePriority',
              (res.get('resourcePriority') || '') + 'rect',
            );
            return this;
          };
        },
      },
      {
        name: 'div3',
        priority: 20,
        init: function () {
          return function (req, res) {
            res.setHeader(
              'resourcePriority',
              (res.get('resourcePriority') || '') + 'cor',
            );
            return this;
          };
        },
      },
    ])
    .beforeRead('pet', [
      {
        name: 'async1',
        priority: 3,
        init: function () {
          return function (req, res) {
            var self = this;
            var d = RSVP.defer();
            setImmediate(function () {
              res.setHeader(
                'asyncseries',
                (res.get('asyncseries') || '') + 'cor',
              );
              d.resolve(self);
            });
            return d.promise;
          };
        },
      },
      {
        name: 'async2',
        priority: 2,
        init: function () {
          return function (req, res) {
            var self = this;
            var d = RSVP.defer();
            setImmediate(function () {
              res.setHeader(
                'asyncseries',
                (res.get('asyncseries') || '') + 're',
              );
              d.resolve(self);
            });
            return d.promise;
          };
        },
      },
      {
        name: 'async3',
        priority: 1,
        init: function () {
          return function (req, res) {
            res.setHeader('asyncseries', (res.get('asyncseries') || '') + 'ct');
            return this;
          };
        },
      },
    ])

    .after('person', function (req, res) {
      res.setHeader('after', 'called for reads only');
      delete this.password;
      this.nickname = 'Super ' + this.name;
      return this;
    })

    .beforeResponseSend('person', [
      {
        name: 'before-response',
        init: function () {
          return function (req) {
            var body = this;
            if (req.headers['apply-before-response-send']) {
              req.headers['apply-before-response-send']++;
              return _.extend(body, {
                hookCallCount: req.headers['apply-before-response-send'] - 1,
              });
            }
            if (req.headers['overwrite-response-status-code']) {
              return {
                body: body,
                statusCode: req.headers['overwrite-response-status-code'],
              };
            }
            return body;
          };
        },
      },
    ])

    .beforeErrorResponseSend('person', [
      {
        name: 'before-error-response',
        init: function () {
          return function (req) {
            var body = this;
            if (req.headers['apply-before-error-response-send']) {
              req.headers['apply-before-error-response-send']++;
              return _.extend(body, {
                hookCallCount:
                  req.headers['apply-before-error-response-send'] - 1,
              });
            }
            if (req.headers['overwrite-error-response-status-code']) {
              return {
                body: body,
                statusCode: req.headers['overwrite-error-response-status-code'],
              };
            }
            return body;
          };
        },
      },
    ])

    .afterRW('person', [
      {
        name: 'secondLegacyAfter',
        init: function () {
          return function () {
            this.nickname = this.nickname + '!';
            return this;
          };
        },
      },
    ])
    .afterRW('person', [
      {
        name: 'echo-route-type',
        init: function () {
          return function (req, res) {
            res.setHeader('route-type', req.fortune.routeMetadata.type);
            res.setHeader(
              'route-type-match',
              req.get('route-type-match') === req.fortune.routeMetadata.type,
            );
            return this;
          };
        },
      },
    ])
    .listen(port);

  app.addHookFilter(function(hooks){
    return _.filter(hooks, function(h){
      return h.name !== 'filtered-out';
    });
  });

  app.addResourcesFilter(function(resources, req){
    var hiddenResources = req.get('hide-resources') && req.get('hide-resources').split(',');
    if (!hiddenResources) return resources;
    return _.filter(resources, function(obj){
      return hiddenResources.indexOf(obj.name) === -1;
    })
  });

  app.addMetadataProvider({
    key: 'ping',
    init: function(){
      return function(){
        return 'pong';
      }
    }
  });

  app.addMetadataProvider({
    key: 'sync',
    init: function(){return function(){return 'sync'}}
  });

  app.addMetadataProvider({
    key: 'async',
    init: function(){
      return function(){
        return new RSVP.Promise(function(resolve){
          setImmediate(function(){
            resolve('async');
          });
        });
      }
    }
  });

  app.addMetadataProvider({
    key: 'sins',
    init: function(){
      return function(req){
        var resource = req.path.split('/')[1];
        if (resource !== 'people') return [];
        return _.map(this[resource], function(item){
          return item.name + ' is a sinner';
        });
      }
    }
  });

  return app;
};
