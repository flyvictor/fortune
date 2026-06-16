const _ = require('lodash');

const createUrl = function (path, query) {
  const queryStr =
    query === undefined
      ? ''
      : Object.keys(query)
          .map(function (key) {
            return `${key}=${query[key]}`;
          })
          .join('&');

  return `${path}?${queryStr}`;
};

const createRequest = function (collection, opt, httpMethod) {
  const path = `/${
    opt.params && opt.params.id ? `${collection}/${opt.params.id}` : collection
  }`;

  return _.extend(opt, {
    direct: true,
    method: httpMethod,
    headers: _.extend(
      {
        'content-type': 'application/json',
      },
      opt.headers,
    ),
    get: function (h) {
      return this.headers[h];
    },
    set: function (key, val) {
      this.headers[key] = val;
    },
    fortune: { requestMetadata: { direct: true } },
    query: opt.query || {},
    params: opt.params || {},
    zipkinTraceId: opt.zipkinTraceId,
    path: path,
    url: createUrl(path, opt.query),
  });
};

const createResponse = function () {
  let resolvePromise;
  const promise = new Promise(function (resolve) {
    resolvePromise = resolve;
  });
  const res = {
    headers: {},
    set: function (key, val) {
      this.headers[key] = val;
    },
    get: function (h) {
      return this.headers[h];
    },
    setHeader: function (key, val) {
      this.set(key, val);
    },
    status: function () {
      return this;
    }, //it's not used anywhere
    send: function (body) {
      resolvePromise(
        _.extend(
          {
            body: body && JSON.parse(body),
          },
          res,
        ),
      );
    },
    promise: promise,
  };

  return res;
};

module.exports = function () {
  const handlers = {};

  const asSingleOrCollection = function (
    method,
    collection,
    options,
    httpMethod,
  ) {
    let res;
    const methodName = (options.params || {}).id ? method : `${method}All`;

    handlers[collection][methodName](
      createRequest(collection, options, httpMethod),
      (res = createResponse()),
    );

    return res.promise;
  };

  return {
    _createRequest: createRequest,
    _createResponse: createResponse,
    methods: {
      create: function (collection, options) {
        let res;

        options.body = _.cloneDeep(options.body);

        handlers[collection].create(
          createRequest(collection, options, 'POST'),
          (res = createResponse()),
        );

        return res.promise;
      },
      get: function (collection, options) {
        return asSingleOrCollection('get', collection, options || {}, 'GET');
      },
      destroy: function (collection, options) {
        return asSingleOrCollection(
          'destroy',
          collection,
          options || {},
          'DELETE',
        );
      },
      replace: function (collection, options) {
        let res;

        options.body = _.cloneDeep(options.body);

        handlers[collection].replace(
          createRequest(collection, options, 'PUT'),
          (res = createResponse()),
        );
        return res.promise;
      },
      update: function (collection, options) {
        let res;

        options.body = _.cloneDeep(options.body);

        handlers[collection].update(
          createRequest(collection, options, 'PATCH'),
          (res = createResponse()),
        );

        return res.promise;
      },
      callAction: function (collection, method, options) {
        let res;

        options.body = _.cloneDeep(options.body);
        handlers[collection].callAction(
          createRequest(collection, options, method),
          (res = createResponse()),
        );

        return res.promise;
      },
      callGenericAction: function (collection, method, options) {
        let res;

        options.body = _.cloneDeep(options.body);
        handlers[collection].callGenericAction(
          createRequest(collection, options, method),
          (res = createResponse()),
        );

        return res.promise;
      },
    },
    registerResource: function (collection, callbacks) {
      const handlerNames = [
        'create',
        'update',
        'replace',
        'destroy',
        'destroyAll',
        'get',
        'getAll',
        'callAction',
        'callGenericAction',
      ];
      if (!_.isEqual(_.keys(callbacks), handlerNames)) {
        throw new Error('Wrong route handler names');
      }
      handlers[collection] = callbacks;
    },
  };
};
