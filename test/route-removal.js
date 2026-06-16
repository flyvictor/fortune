require('should');

const fortune = require('../lib/fortune');

function createApp() {
  return fortune({
    adapter: {
      _init: function () {},
      awaitConnection: function () {
        return Promise.resolve();
      },
    },
  });
}

function hasRoute(app, path, method) {
  const stack = app.router._router.stack;
  return stack.some(function (layer) {
    const route = layer.route;
    return (
      route &&
      route.path === path &&
      (route.methods[method] || route.methods._all)
    );
  });
}

describe('route removal', function () {
  it('removes write routes from an Express 4 router', function () {
    const app = createApp();

    app.router.get('/people', function () {});
    app.router.post('/people', function () {});
    app.router.put('/people/:id', function () {});
    app.router.patch('/people/:id', function () {});
    app.router.delete('/people/:id', function () {});
    app.router.get('/cars', function () {});

    return app
      ._removeRoutes('person', ['post', 'put', 'patch', 'delete'])
      .then(function () {
        hasRoute(app, '/people', 'get').should.equal(true);
        hasRoute(app, '/people', 'post').should.equal(false);
        hasRoute(app, '/people/:id', 'put').should.equal(false);
        hasRoute(app, '/people/:id', 'patch').should.equal(false);
        hasRoute(app, '/people/:id', 'delete').should.equal(false);
        hasRoute(app, '/cars', 'get').should.equal(true);
      });
  });

  it('removes only the index route when specific routes are provided', function () {
    const app = createApp();

    app.router.get('/people', function () {});
    app.router.get('/people/:id', function () {});

    return app._removeRoutes('person', ['get'], ['/people']).then(function () {
      hasRoute(app, '/people', 'get').should.equal(false);
      hasRoute(app, '/people/:id', 'get').should.equal(true);
    });
  });
});
