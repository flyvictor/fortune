const _ = require('lodash');
const conn = require('./db-connection');
const resources = require('./resources');
const fortune = require('fortune');

function createFortune(express, fortuneDeps) {
  const app = fortune(
    _.extend(
      {
        router: express,
        debug: false,
        adapter: 'mongodb',
        serviceName: 'test-app',
        connectionString: conn,
      },
      fortuneDeps,
    ),
  );
  return app;
}

function addRoutes(app, deps) {
  resources.defineResources(app, deps);
}

module.exports.createFortune = createFortune;
module.exports.addRoutes = addRoutes;
