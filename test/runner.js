var should = require('should');
var _ = require('lodash');
var RSVP = require('rsvp');
var request = require('supertest');
var Promise = RSVP.Promise;
var fixtures = require('./fixtures.json');
var port = 8891;
var baseUrl = 'http://localhost:' + port;
process.env.DISASTER_RECOVERY_COUNT_ENABLED = 'true';
process.env.SHARDED_MODEL_LOCATIONS = 'GB,AE';
describe('Fortune test runner', function () {
  var options = {
    app: null,
    port: port,
    baseUrl: baseUrl,
    ids: {},
  };

  before(function (done) {
    var remoteDB = process.env.WERCKER_MONGODB_URL
      ? process.env.WERCKER_MONGODB_URL + '/fortune'
      : null;

    if (remoteDB) {
      console.log('Using remote mongodb:', remoteDB);
    }

    options.app = require('./app')(
      {
        adapter: 'mongodb',
        connectionString: remoteDB || 'mongodb://localhost/fortune_test',
        inflect: true,
        flags: {
          config: {
            autoIndex: true,
          },
        },
      },
      port,
    );

    const app = options.app;
    options.app.adapter
      .awaitConnection()
      .then(async function () {
        const connection =
          app.adapter.mongoose.connections[
            app.adapter.mongoose.connections.length - 1
          ];

        const collections = await connection.db.listCollections().toArray();
        await Promise.all(
          collections.map(async function (collection) {
            const name = collection.name.split('.')[0];
            if (name && name !== 'system') {
              const collection = await connection.db.collection(name);
              await collection.deleteMany({});
              console.log('Wiped collection', name);
            }
          }),
        );
      })
      .then(function () {
        app.router.post('/remove-pets-link/:personid', function (req, res) {
          const Person = app.adapter.model('person');
          Person.findOne(
            { email: req.params.personid }).then((person) => {
              person.pets = null;
              person.save().then(function () {
                res.sendStatus(200);
              }).catch(done);
            }).catch((err) => {
              console.error(err);
              res.send(500, err);
              return;
            });

        });
      })
      .then(done)
      .catch(function (err) {
        console.error(err);
        done(err);
      });
  });

  beforeEach(function (done) {
    var createResources = [];
    // console.log("runner beforeEach inserting resources");

    _.each(fixtures, function (resources, collection) {
      createResources.push(
        new Promise(function (resolve) {
          var body = {};
          body[collection] = resources;

          request(baseUrl)
            .post('/' + collection)
            .send(body)
            .expect('Content-Type', /json/)
            .expect(201)
            .end(function (error, response) {
              should.not.exist(error);
              var resources = JSON.parse(response.text)[collection];
              options.ids[collection] = options.ids[collection] || [];
              resources.forEach(function (resource) {
                options.ids[collection].push(resource.id);
              });
              resolve();
            });
        }),
      );
    });

    RSVP.all(createResources).then(
      function () {
        done();
      },
      function () {
        throw new Error('Failed to create resources.');
      },
    );
  });

  require('./fortune/all')(options);
  require('./fortune-mongodb/mongodb.spec.js')(options);
  require('./fortune-mongodb/helpers.spec')();
  require('./querytree')(options);

  afterEach(function (done) {
    var promises = [];
    _.each(fixtures, function (resources, collection) {
      promises.push(
        new RSVP.Promise(function (resolve) {
          request(baseUrl)
            .del('/' + collection + '?destroy=true')
            .end(function (error) {
              resolve();
            });
        }),
      );
    });
    RSVP.all(promises).then(
      function () {
        options.ids = {};
        done();
      },
      function () {
        throw new Error('Failed to delete resources.');
      },
    );
  });
});
