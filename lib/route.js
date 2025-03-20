const RSVP = require('rsvp');
const _ = require('lodash');
const LinkingBooster = require('./linking-booster');
const routeHelpers = require('./route-helpers');
const sift = require('sift').default;

const zipkin = require('./zipkin');
const { Annotation } = require('zipkin');
const { ensureQueryArray } = require('./querytree');

// constants
const MIME = {
    standard: ['application/vnd.api+json', 'application/json'],
    patch: ['application/json-patch+json'],
  },
  errorMessages = {
    400: 'Request was malformed.',
    403: 'Access forbidden.',
    404: 'Resource not found.',
    405: 'Method not permitted.',
    412: `Request header "Content-Type" must be one of: ${MIME.standard.join(
      ', ',
    )}`,
    500: 'Oops, something went wrong.',
    501: 'Feature not implemented.',
  };

/**
 * Setup routes for a resource, given a name and model.
 *
 * @param {String} name
 * @param {Object} model
 * @param {Object} resources - a list with all registered resources
 * @param {Object} inflect
 * @param {Object} querytree
 */
function route(
  name,
  model,
  resources,
  inflect,
  querytree,
  metadataProviders,
  zipkinTracer,
) {
  const ROUTE_TYPES = this.constants.ROUTE_TYPES;
  const _this = this,
    router = this.router,
    adapter = this.adapter,
    director = this.director,
    booster = LinkingBooster.init(this.director, inflect, resources),
    // options
    baseUrl = this.options.baseUrl,
    namespace = this.options.namespace,
    suffix = this.options.suffix,
    production = this.options.production,
    instrumentorObj = this.options.customInstrumentorObj,
    instrumentor = this.options.customInstrumentorObj.instrumentor,
    // routes
    collection = inflect.pluralize(name),
    collectionRoute = `${namespace}/${collection}${suffix}`,
    individualRoute = `${namespace}/${collection}/:id${suffix}`,
    //Calls custom action set up on resource. :action is a verb
    //OR looks up linked resources for individual route. :key is an noun and no matching action was found
    actionRoute = `${namespace}/${collection}/:id/:key${suffix}`,
    genericActionRoute = `${namespace}/${collection}/action/:action${suffix}`;
  const options = this.options;

  this.director.registerResource(collection, {
    create: createResource,
    update: updateResource,
    replace: replaceResource,
    destroy: deleteResource,
    destroyAll: deleteResources,
    get: getResource,
    getAll: getResources,
    callAction: callAction,
    callGenericAction: callGenericAction,
  });
  //Init linker-booster after director is set up

  // response emitters
  const beforeErrorResponseHook = Hook('_before', 'errorResponse');
  const sendError = async function (req, res, status, error) {
    if (error) {
      console.error('[route::sendError] fortune sendError:');
      console.error(error);

      instrumentor.captureException(error, { extra: { status }, req, res });
    } else {
      instrumentor.captureException(new Error('Something went wrong'), {
        extra: { status },
        req,
      });
    }

    const object = {
      error: errorMessages[status],
      detail: error ? error.toString() : '',
    };

    const transform = await beforeErrorResponseHook(object, req, res);
    if (res._headerSent) return;

    let transformedObject, statusCode;
    if (
      _.keys(transform).length === 2 &&
      _.has(transform, 'statusCode') &&
      _.has(transform, 'body')
    ) {
      transformedObject = transform.body;
      statusCode = transform.statusCode || status;
    } else {
      transformedObject = transform;
      statusCode = status;
    }

    const str = production
      ? JSON.stringify(transformedObject, null, null)
      : `${JSON.stringify(transformedObject, null, 2)}\n`;

    res.set(
      'Content-Type',
      !req.get('User-Agent') ? MIME.standard[0] : MIME.standard[1],
    );
    res.status(statusCode);
    res.send(str);
  };

  const beforeResponseHook = Hook('_before', 'response');
  const sendResponse = function (req, res, status, object) {
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);
    try {
      if (status === 204) {
        try {
          if (req.zipkinTraceId) {
            zipkinTracer.scoped(() => {
              const id = req.zipkinTraceId;
              zipkinTracer.setId(id);
              zipkinTracer.recordBinary('http.status_code', status);
              zipkinTracer.recordAnnotation(new Annotation.ServerSend());
            });
          }
        } catch (e) {
          console.error('errror logging zipking trace', e);
        }
        return res.status(status).send();
      }
    } catch (e) {
      console.error(e);
    }

    object = object || {};
    let linked;
    if (req.linker) {
      //linking-resources-boosted is already started when req.linker is set
      linked = appendLinks.call(_this, object, req, res).then(function (body) {
        return booster.mergeResults(req, req.linker, body);
      });
    } else {
      linked = localTracer('linking-resources', () => {
        zipkinTracer.recordBinary('fortune.include_paths', req.query.include);
        return appendLinks.call(_this, object, req, res);
      });
    }

    linked
      .then(function (object) {
        return localTracer('metadata-providers', () => {
          const includeMeta =
            req.query.includeMeta &&
            !_.isBoolean(req.query.includeMeta) &&
            _.without(ensureQueryArray(req.query.includeMeta), 'count', 'true');
          if (!includeMeta || !includeMeta.length) return object;
          object.meta = object.meta || {};
          return RSVP.all(
            _.map(includeMeta, function (metaKey) {
              if (!metadataProviders[metaKey]) {
                object.meta[metaKey] = 'Metadata provider is not defined';
                return null;
              }
              const tmp = metadataProviders[metaKey].call(object, req, res);
              const promise = tmp.then
                ? tmp
                : new RSVP.Promise(function (r) {
                    r(tmp);
                  });
              return promise.then(function (value) {
                object.meta[metaKey] = value;
              });
            }),
          ).then(function () {
            return object;
          });
        });
      })
      .then(function (object) {
        localTracer('before-response-send-hook', () =>
          beforeResponseHook(object, req, res),
        ).then(function (transform) {
          let object, statusCode;
          if (
            _.keys(transform).length === 2 &&
            _.has(transform, 'statusCode') &&
            _.has(transform, 'body')
          ) {
            object = transform.body;
            statusCode = transform.statusCode || status;
          } else {
            object = transform;
            statusCode = status;
          }

          try {
            if (req.zipkinTraceId) {
              zipkinTracer.scoped(() => {
                const id = req.zipkinTraceId;
                zipkinTracer.setId(id);
                zipkinTracer.recordBinary('http.status_code', statusCode);
                zipkinTracer.recordBinary(
                  'fortune.response_resources_count',
                  object[collection].length,
                );
                zipkinTracer.recordAnnotation(new Annotation.ServerSend());
              });
            }
          } catch (e) {
            console.error('errror logging zipking trace', e);
          }

          const str = production
            ? JSON.stringify(object, null, null)
            : `${JSON.stringify(object, null, 2)}\n`;

          res.set(
            'Content-Type',
            !req.get('User-Agent') ? MIME.standard[0] : MIME.standard[1],
          );

          res.status(statusCode);
          res.send(str);
        });
      })
      .catch(function (err) {
        console.trace(err.stack || err);
        throw err;
      });
  };
  const methodNotAllowed = function (req, res) {
    sendError(req, res, 405);
  };

  const beforeReadHook = Hook('_before', 'read');
  const beforeWriteHook = Hook('_before', 'write');
  const afterReadHook = Hook('_after', 'read');
  const afterWriteHook = Hook('_after', 'write');

  function filterHooks(hooks, time, type, resource, name) {
    const ary = hooks[time][type];
    return _.reduce(
      _this._hookFilters,
      function (memo, filter) {
        return filter(memo, name, time.replace('_', ''), type, resource);
      },
      ary,
    );
  }

  function Hook(time, type) {
    return function (model, resource, request, response, isNew) {
      if (_.isUndefined(response) || _.isNull(response)) {
        response = request;
        request = resource;
        resource = model;
        model = name;
      }
      const tracePrefix = `${
        instrumentorObj.options.tracePrefix + model
      } - ${time}-hooks`;
      return new Promise(
        instrumentor.createTracer(tracePrefix, function (resolve, reject) {
          //If no transforms found for this resource return without change

          const hooks = resources[model].hooks;
          if (!hooks[time] || !hooks[time][type]) return resolve(resource);
          resource = _.extend(resource, isNew);
          let transform = resource;
          const toApply = filterHooks(hooks, time, type, resource, name);
          _.each(toApply, function (h) {
            const fn = h.fn;
            if (transform) {
              if (transform.then) {
                transform = transform.then(function (data) {
                  if (!data) return false;
                  return fn.call(data, request, response);
                });
              } else {
                transform = fn.call(transform, request, response);
              }
            }
          });
          if (transform && transform.done) {
            transform.done(resolve, reject);
          } else {
            resolve(transform);
          }
        }),
      );
    };
  }

  const mimeCheck = function (contentType) {
    return ~MIME.standard.indexOf(contentType.split(';').shift());
  };

  /*!
   * Handle creating a resource.
   */
  router.post(collectionRoute, createResource);

async function createResource(req, res) {
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-create-resources');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary(
        'fortune.resources_count',
        req.body[collection].length,
      );
      zipkinTracer.recordBinary(
        'fortune.is_compound_post',
        _.isObject(req.body.linked).toString(),
      );
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    if (!mimeCheck(req.get('content-type'))) {
      return sendError(req, res, 412);
    }
    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.createResource,
      resource: collection,
    });

    const inclusions = [];
    const mainResources = _.clone(req.body[collection]);


    const mainTransform = await runBefores(model.modelName, mainResources);

    if (hooksFailed(mainTransform)) return;
    if (_.isUndefined(mainTransform)) return;

    if (req.body.linked) {
      try {
        //Run all befores before mapping main to linked resources ids
        const linkedBefores = {};
        _.each(omitExternal(req.body.linked), function (linkedResources, key) {
          linkedBefores[key] = function () {
            return runBefores(inflect.singularize(key), linkedResources);
          };
        });

        const transformed = await RSVP.hash({
          mainResources: mainTransform,
          linkedResources: RSVP.hash( // gets indexed by resource name
            _.reduce(
              linkedBefores,
              function (memo, fn, key) {
                memo[key] = fn();
                return memo;
              },
              {},
            ),
          ),
        });

        //Check if any before hook returned false
        if (_.isUndefined(transformed)) return;
        if (
          hooksFailed(_.flatten(_.values(transformed.linkedResources), true))
        ) return;


        //Now when all hooks succeeded it's safe to create resources
        const refsFromMain = getAssociations.call(
          _this,
          _this._schema[inflect.singularize(collection)],
        );
        let matchedMainResources = flattenLinks(transformed.mainResources);
        _.each(transformed.linkedResources, function (linkedResources, key) {
          const singularKey = options.inflect
            ? inflect.singularize(key)
            : key;
          //Find related paths from main resource to linked doc
          const refPaths = _.filter(refsFromMain, function (ref) {
            return ref.type === key;
          });
          //Map linked ids to main resources fields
          //As linkedResources is always of different type it's safe to overwrite matchedMainResource
          matchedMainResources = _.map(
            matchedMainResources,
            function (resource) {
              _.each(refPaths, function (path) {
                if (resource[path.key]) {
                  if (inclusions.indexOf(path.key) === -1)
                    inclusions.push(path.key);

                  const m = mix(
                    resource[path.key],
                    linkedResources,
                    singularKey,
                  );

                  resource[path.key]  = m;
                }
              });
              return resource;
            },
          );
        });

        //Convert main resource to single promise
        const mappedMainResources = await RSVP.all(
          _.map(matchedMainResources, function (r) {
            return RSVP.hash(r);
          })
        );

        const createdMainResources = await createResources(model, mappedMainResources);

        // First apply after hooks to linked resources. All we need there is to keep track of promises.
        // The data is shared via object references instead of being passed around explicitly as of now so result doesn't matter
        await Promise.all(Object.keys(transformed.linkedResources).map(key => {
          const linkedResourcesList = _.isArray(transformed.linkedResources[key]) ? transformed.linkedResources[key] : [transformed.linkedResources[key]];
          return applyAfterHooks(inflect.singularize(key), linkedResourcesList, req, res);
        }));

        //Then continue with main
        const afterTransformedMainResources = await applyAfterHooks(model.modelName || model, createdMainResources, req, res);

        respond(afterTransformedMainResources);

      } catch(error) {
        await sendError(req, res, 500, error);
      }
    } else {
      try {
        const createdResources = await createResources(model, mainTransform);
        const afterTransformed = await applyAfterHooks( model.modelName || model,createdResources, req, res)
        respond(afterTransformed);
      } catch (error) {
        await sendError(req, res, 500, error);
      }
    }

    function flattenLinks(resources) {
      return _.map(resources, function (item) {
        return _.omit(_.extend({}, item, item.links), 'links');
      });
    }

    function omitExternal(linked) {
      const refsFromMain = getAssociations.call(
        _this,
        _this._schema[inflect.singularize(collection)],
      );
      const local = {};
      _.each(refsFromMain, function (ref) {
        if (linked[ref.type] && !ref.external)
          local[ref.type] = linked[ref.type];
      });
      return local;
    }

    function hooksFailed(resources) {
      return _.some(resources, function (res) {
        return _.isUndefined(res);
      });
    }

    function terminateOnRejectedHooks(resources) {
      if (
        _.some(resources, function (res) {
          return !res;
        })
      ) {
        console.log(
          'Terminating request due to a transform returning false/empty',
        );
        return;
      } else {
        return resources;
      }
    }

    function runBefores(modelName, resources) {
      return localTracer('before-write-hooks', () => {
        const before = [];
        resources.forEach(function (resource) {
          if (modelName) {
            before.push(
              beforeWriteHook(modelName, resource, req, res, { __isNew: true }),
            );
          }
        });
        return RSVP.all(before).then(
          terminateOnRejectedHooks,
          function (errors) {
            console.log(errors.stack);
            if (!res.headerSent) sendError(req, res, 403, errors);
          },
        );
      });
    }

    /**
     * should substitute client-generated ids in main with promises of linked ids
     * @param main - array with client-generated ids
     * @param linked - array with linked documents
     * @param linkedModel - name of related model
     */
    function mix(main, linked, linkedModel) {
      //Main is defined but could mix existing resources and those to create
      return RSVP.all(
        _.map(_.isArray(main) ? main : [main], function (item) {
          const toCreate = _.find(linked, function (l) {
            return _.has(l, 'id') && l.id === item;
          });
          if (!toCreate) return item;
          //This exact item is already scheduled for creation by something else
          //most commonly multiple references to the same record in payload
          if (toCreate.$$createPromise) return toCreate.$$createPromise;
          toCreate.$$createPromise = createResources(linkedModel, [_.omit(toCreate, 'id')]).then(r => {
            toCreate.id = r[0].id;
            return r[0].id;
          });
          return toCreate.$$createPromise;
        }),
      ).then(function (result) {
        return _.isArray(main) ? result : result[0];
      });
    }

    /**
     * Creates all provided resources and returns them
     * Expects that `before` hooks were run already
     * @param model
     * @param resources
     * @returns {*}
     */
    function createResources(model, resources) {
      if (!resources) return;
      //Before transforms are done by this time
      // create the resources
      return (
        localTracer('database-write', () => {
          return RSVP.all(
            resources.map(function (resource) {
              if (model.$$createPromise) {
                delete model.$$createPromise;
              }
              return adapter.create(model, resource);
            }),
          );
        })
      );
    }

    function applyAfterHooks(modelName, resources, req, res) {
      if (!resources) return;

      return localTracer('after-write-hooks', () => {
        return RSVP.all(
          resources.map(function (resource) {
            return afterWriteHook(modelName, resource, req, res);
          }),
        ).then(terminateOnRejectedHooks);
      });
    }

    /**
     * Sends final response to the client if all goes well
     * @param primaryResources
     * @returns {}
     */
    function respond(primaryResources) {
      if (!primaryResources) return;
      if (!primaryResources.length) {
        return sendResponse(req, res, 204);
      }
      const body = {};

      if (!!baseUrl) {
        let location = `${baseUrl}/`;
        location += !!namespace ? `${namespace}/` : '';
        location += `${collection}/${primaryResources
          .map(function (resource) {
            return resource.id;
          })
          .join(',')}`;
        res.set('Location', location);
      }

      body[collection] = primaryResources;
      if (inclusions.length !== 0) {
        //Mix requested include and created linked resources keys to reuse mergeLinked and fetch persisted linked docs
        const queryInclude =
          req.query.include && ensureQueryArray(req.query.include).join(',');
        req.query.include = queryInclude
          ? `${queryInclude},${inclusions.join(',')}`
          : inclusions.join(',');
      }

      sendResponse(req, res, 201, body);
    }
  }

  /*
   * Get a list of resources.
   */

  router.get(collectionRoute, getResources);

  function getResources(req, res) {
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-read-resources');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary(
        'fortune.client_query',
        zipkin.safeStringify(req.query),
      );
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    const match = {};
    let projection = {};
    const select = parseSelectProjection(
      req.query.fields,
      inflect.pluralize(model.modelName),
    );
    const tracePrefix = `${instrumentorObj.options.tracePrefix}/${model.modelName}`;

    req.query.fortuneExtensions = [{}]; //Must be a non-empty array in case no hook modifies it
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.getResources,
      resource: collection,
    });

    if (req.query.ids) match.id = { $in: ensureQueryArray(req.query.ids) };

    //run beforeRead
    localTracer('before-read-hooks', () => beforeReadHook({}, req, res))
      .then(
        instrumentor.createTracer(`${tracePrefix} parse`, function () {
          req.query.filter = {
            $and: [req.query.filter].concat(req.query.fortuneExtensions),
          };

          if (select) {
            projection = {
              select: select,
            };
          }
          if (!_.isUndefined(req.query.limit)) {
            //why's there no isDefined
            projection.limit = parseInt(req.query.limit, 10);
          }
          if (req.query.sort) {
            projection.sort = req.query.sort;
          } else if (model.schema.options.defaultSort) {
            projection.sort = model.schema.options.defaultSort;
          }
          if (req.query.page) {
            projection.page = req.query.page;
            if (req.query.pageSize) {
              projection.pageSize = parseInt(req.query.pageSize);
            } else {
              projection.pageSize = 10;
            }
          }
          if (!_.isUndefined(req.query.includeDeleted)) {
            projection.includeDeleted = true;
          }
          //if limit is zero we just don't set it. (or use the default if exists)
          if (!_.isNumber(projection.limit)) {
            projection.limit = model.schema.options.defaultLimit;
          }

          // get resources by IDs
          return localTracer('resolving-cross-resource-query', () =>
            querytree.parse(
              req,
              model.modelName,
              _.extend(match, req.query.filter),
            ),
          ).then(
            instrumentor.createTracer(`${tracePrefix} read`, function (query) {
              const queries = {};
              queries.resources = localTracer('reading-database', () => {
                zipkinTracer.recordBinary(
                  'fortune.mongo_query',
                  zipkin.safeStringify(query),
                );
                zipkinTracer.recordBinary(
                  'fortune.mongo_projection',
                  zipkin.safeStringify(projection),
                );
                return adapter.findMany(model, query, projection);
              });

              if (
                req.query.includeMeta &&
                (_.isBoolean(req.query.includeMeta) ||
                  ensureQueryArray(req.query.includeMeta).indexOf('count') !==
                    -1 ||
                  ensureQueryArray(req.query.includeMeta).indexOf('true') !==
                    -1)
              ) {
                //Count all resources that service would potentially allow to read
                if (process.env.DISASTER_RECOVERY_COUNT_ENABLED) {
                  queries.count = localTracer('counting-all-resources', () =>
                    adapter.count(
                      model,
                      { $and: req.query.fortuneExtensions },
                      projection,
                    ),
                  );
                } else {
                  queries.count = new RSVP.resolve(1);
                }

                if (req.query.filter) {
                  queries.filterCount = localTracer(
                    'counting-filter-resources',
                    () => adapter.count(model, query, projection),
                  );
                }
              }
              return RSVP.hash(queries);
            }),
          );
        }),
      )
      // run after read
      .then(
        instrumentor.createTracer(
          `${tracePrefix} response-preparation`,
          function (result) {
            return localTracer('after-read-hooks', () => {
              return RSVP.all(
                result.resources.map(function (resource) {
                  return afterReadHook(resource, req, res);
                }),
              );
            }).then(function (r) {
              result.resources = r;
              return result;
            });
          },
        ),
      )
      // send the response
      .then(
        instrumentor.createTracer(
          `${tracePrefix} sending-response`,
          function (r) {
            const body = {};
            body[collection] = r.resources;

            if (!_.isUndefined(r.count)) {
              body.meta = { count: r.count };
              if (!_.isUndefined(r.filterCount))
                body.meta.filterCount = r.filterCount;
            }
            sendResponse(req, res, 200, body);
          },
        ),
      )
      .catch(function (error) {
        const status =
          error.constructor.name === 'CastError' || error.message.match(/^Cast/)
            ? 400
            : 500;
        sendError(req, res, status, error);
      });
  }

  /*
   * Handle unsupported methods on a collection of resources.
   */
  router.put(collectionRoute, methodNotAllowed);
  router.patch(collectionRoute, methodNotAllowed);

  /*
   * Get an individual resource, or many.
   */
  router.get(individualRoute, getResource);

  function getResource(req, res) {
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-read-resource');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary('fortune.id', req.params.id);
      zipkinTracer.recordBinary(
        'fortune.client_query',
        zipkin.safeStringify(req.query),
      );
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    const ids = req.params.id.split(',');
    let projection = {};

    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.getResource,
      resource: collection,
    });

    if (booster.canBoost(req)) {
      req.linker = localTracer('linking-includes-boosted', () => {
        zipkinTracer.recordBinary('fortune.include_paths', req.query.include);
        return booster.startLinking(req);
      });
    }
    const select = parseSelectProjection(
      req.query.fields,
      inflect.pluralize(model.modelName),
    );

    if (select) {
      projection = {
        select: select,
      };
    }

    if (req.query.includeDeleted) {
      projection.includeDeleted = true;
    }

    if (model.schema.options.defaultSort) {
      projection = projection || {};
      projection.sort = model.schema.options.defaultSort;
    }

    findResourcesWithFortuneExtensions(ids, projection, localTracer, req, res)
      // run after read hook
      .then(
        function (resources) {
          if (!resources) return;
          return localTracer('after-read-hooks', () => {
            return RSVP.all(
              resources.map(function (resource) {
                return afterReadHook(resource, req, res);
              }),
            );
          });
        },
        function (error) {
          sendError(req, res, 500, error);
        },
      )
      // send the response
      .then(
        function (resources) {
          if (!resources) return;
          const body = {};
          body[collection] = resources;
          sendResponse(req, res, 200, body);
        },
        function (error) {
          sendError(req, res, 500, error);
        },
      );
  }

  /*
   * Get the related resources of an individual resource.
   * Called if request.method is GET and no matching action was found
   */

  function getSubresources(req, res) {
    const id = req.params.id,
      key = req.params.key,
      originalFilter = req.query.filter ? _.cloneDeep(req.query.filter) : {};

    zipkinTracer.scoped(() => {
      const traceId = zipkinTracer.createRootId();
      req.zipkinTraceId = traceId;
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName('fortune-read-sub-resource');
      zipkinTracer.recordRpc(req.method.toUpperCase());
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary('fortune.subresource', key);
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    let projection = {};
    const select = parseSelectProjection(req.query.fields, model.modelName);

    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.getSubresources,
      resource: collection,
      subResourcePath: key,
    });
    if (select) {
      projection = {
        select: select,
      };
    }

    if (!_.isUndefined(req.query.limit)) {
      projection.limit = parseInt(req.query.limit, 10);
    }

    if (id) {
      //Reset query.filter to value applied to primary resource
      req.query.filter = {};
      req.query.filter.id = id;
    }

    localTracer('before-read-hooks-primary', () => beforeReadHook({}, req, res))
      .then(
        function () {
          // get a resource by ID
          return localTracer('reading-database-primary', () => {
            zipkinTracer.recordBinary(
              'fortune.mongo_query',
              zipkin.safeStringify(req.query.filter),
            );
            zipkinTracer.recordBinary(
              'fortune.mongo_projection',
              zipkin.safeStringify(projection),
            );
            return adapter.find(model, req.query.filter, projection);
          });
        },
        function (err) {
          sendError(req, res, 500, err);
        },
      )

      // run after read hook
      .then(
        function (resource) {
          return localTracer('after-read-hooks-primary', () =>
            afterReadHook(resource, req, res),
          );
        },
        function (error) {
          sendError(req, res, 404, error);
        },
      )

      // change context to resource
      .then(
        function (resource) {
          let ids, relatedModel;
          try {
            ids = resource.links[key];
            if (_.isUndefined(ids)) {
              ids = [];
            }
            ids = _.isArray(ids) ? ids : [ids];
            relatedModel = _this._schema[name][key];
            relatedModel = _.isArray(relatedModel)
              ? relatedModel[0]
              : relatedModel;
            relatedModel = _.isPlainObject(relatedModel)
              ? relatedModel.ref
              : relatedModel;
            if (key && key.length > 0 && !relatedModel) {
              return sendError(req, res, 404);
            }
          } catch (error) {
            return sendError(req, res, 404, error);
          }

          let findPromise;
          if (_.size(ids) > 0) {
            //Reset req.query.filter to original value discarding changes applied for parent resource
            req.query.filter = originalFilter;
            req.query.filter.id = { $in: ids };
            //run before read hook
            findPromise = localTracer('before-read-hooks-secondary', () =>
              beforeReadHook(relatedModel, {}, req, res),
            ).then(
              function () {
                // find related resources
                return localTracer('readin-database-secondary', () =>
                  adapter.findMany(
                    relatedModel,
                    req.query.filter,
                    _.isNumber(projection.limit) ? projection.limit : undefined,
                  ),
                );
              },
              function (err) {
                sendError(req, res, 500, err);
              },
            );
          } else {
            const deferred = RSVP.defer();
            deferred.resolve([]);
            findPromise = deferred.promise;
          }

          // do after transforms
          findPromise
            .then(
              function (resources) {
                return localTracer('after-read-hooks-secondary', () => {
                  return RSVP.all(
                    resources.map(function (resource) {
                      return afterReadHook(relatedModel, resource, req, res);
                    }),
                  );
                });
              },
              function (error) {
                sendError(req, res, 500, error);
              },
            )

            // send the response
            .then(
              function (resources) {
                const body = {};
                body[inflect.pluralize(relatedModel)] = resources;
                sendResponse(req, res, 200, body);
              },
              function (error) {
                sendError(req, res, 403, error);
              },
            );
        },
        function (error) {
          sendError(req, res, 403, error);
        },
      );
  }

  /*
   * Put a resource.
   */
  router.put(individualRoute, replaceResource);

  function replaceResource(req, res) {
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-replace-resource');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary(
        'fortune.resources_count',
        req.body[collection].length,
      );
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);
    const id = req.params.id;
    let update;

    // header error handling
    if (!mimeCheck(req.get('content-type'))) {
      return sendError(req, res, 412);
    }

    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.replaceResource,
      resource: collection,
    });

    try {
      update = req.body[collection][0];
      if (!update) return sendError(req, res, 400);
    } catch (error) {
      return sendError(req, res, 400, error);
    }

    // try to find the resource by ID
    localTracer('reading-for-validation', () => adapter.find(model, id)).then(
      function () {
        // do before write hook
        return (
          localTracer('before-write-hooks', () =>
            beforeWriteHook(update, req, res),
          )
            // update the resource
            .then(
              function (update) {
                if (!update) return;
                return localTracer('writing-database', async () => {
                  const match = await adapter.preupdate(model, id);
                  return adapter.update(model, match, update);
                });
              },
              function (error) {
                sendError(req, res, 403, error);
              },
            )

            // do after transform
            .then(
              function (update) {
                if (!update) return;
                return localTracer('after-write-hooks', () =>
                  afterWriteHook(update, req, res),
                );
              },
              function (error) {
                sendError(req, res, 500, error);
              },
            )

            // send the response
            .then(
              function (update) {
                if (!update) return;
                const body = {};
                body[collection] = [update];
                sendResponse(req, res, 200, body);
              },
              function (error) {
                sendError(req, res, 403, error);
              },
            )
        );
      },

      // resource not found, try to create it
      function () {
        // do before transform
        localTracer('before-write-hooks', () =>
          beforeWriteHook(update, req, res, null, { __isNew: true }),
        )
          // create the resource
          .then(
            function (resource) {
              return localTracer('writing-database', () =>
                adapter.create(model, id, resource),
              );
            },
            function (error) {
              sendError(req, res, 403, error);
            },
          )

          // do after transform
          .then(
            function (resource) {
              return localTracer('after-write-hooks', () =>
                afterWriteHook(resource, req, res),
              );
            },
            function (error) {
              sendError(req, res, 500, error);
            },
          )

          // send the response
          .then(
            function (resource) {
              const body = {};
              body[collection] = [resource];
              sendResponse(req, res, 201, body);
            },
            function (error) {
              sendError(req, res, 500, error);
            },
          );
      },
    );
  }

  /*
   * Delete a collection
   */

  router.delete(collectionRoute, deleteResources);

  function deleteResources(req, res) {
    const destroy = !!req.query.destroy;
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-delete-resources');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordBinary('fortune.destroy', destroy.toString());
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.deleteResources,
      resource: collection,
    });

    localTracer('reading-for-validation', () => adapter.findMany(model))
      .then(
        function (resources) {
          return localTracer('before-write-hooks', () => {
            return RSVP.all(
              _.map(resources, function (resource) {
                return beforeWriteHook(resource, req, res);
              }),
            );
          });
        },
        function (err) {
          sendError(req, res, 404, err);
        },
      )
      .then(
        function () {
          return localTracer('writing-database', () => {
            if (destroy) return adapter.delete(model);
            return adapter.findMany(model, {}).then(function (data) {
              return RSVP.all(
                _.map(data, function (item) {
                  return adapter.markDeleted(model, item.id);
                }),
              );
            });
          });
        },
        function (err) {
          sendError(req, res, 500, err);
        },
      )

      .then(
        function (resources) {
          return localTracer('after-write-hooks', () => {
            return RSVP.all(
              _.map(resources, function (resource) {
                return afterWriteHook(resource, req, res);
              }),
            );
          });
        },
        function (err) {
          sendError(req, res, 500, err);
        },
      )

      .then(
        function () {
          sendResponse(req, res, 204);
        },
        function (err) {
          sendError(req, res, 500, err);
        },
      );
  }

  /*
   * Delete a resource.
   */
  router.delete(individualRoute, deleteResource);

  function deleteResource(req, res) {
    zipkinTracer.scoped(() => {
      const traceId = (req.zipkinTraceId = req.zipkinTraceId
        ? zipkinTracer.createChildId(req.zipkinTraceId)
        : zipkinTracer.createRootId());
      req.zipkinTraceId = traceId;
      zipkinTracer.setId(traceId);
      zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
      zipkinTracer.recordRpc('fortune-delete-resource');
      zipkinTracer.recordBinary('fortune.resource', name);
      zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
    });
    const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);

    const ids = req.params.id.split(',');
    const destroy = !!req.query.destroy;

    req.query.fortuneExtensions = [{}];
    req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
      type: ROUTE_TYPES.deleteResource,
      resource: collection,
    });

    const projection = {};
    if (destroy) projection.includeDeleted = true;
    // find the resource by ID
    localTracer('reading-for-validation', () =>
      findResourcesWithFortuneExtensions(
        ids,
        projection,
        localTracer,
        req,
        res,
      ),
    )
      .then(function (resources) {
        if (!resources) return;
        if (resources.length === 0) return sendError(req, res, 404);
        return localTracer('before-write-hooks', () => {
          return RSVP.all(
            _.map(resources, function (resource) {
              return beforeWriteHook(resource, req, res);
            }),
          );
        });
      })
      .catch(function (error) {
        sendError(req, res, 404, error);
      })

      // let's delete it (or only mark deleted by )
      .then(function (resources) {
        if (
          _.isUndefined(resources) ||
          _.some(resources, function (r) {
            return !r;
          })
        )
          return;
        return localTracer('writing-database', () => {
          return destroy
            ? adapter.delete(model, ids)
            : adapter.markDeleted(model, ids);
        });
      })
      .catch(function (error) {
        // resource not found
        sendError(req, res, 404, error);
      })

      .then(function (resources) {
        if (!resources) return;
        return localTracer('after-write-hooks', () => {
          return RSVP.all(
            _.map(resources, function (resource) {
              return afterWriteHook(resource, req, res);
            }),
          );
        });
      })
      .catch(function (err) {
        sendError(req, res, 500, err);
      })

      .then(function (resource) {
        if (!resource) return;
        sendResponse(req, res, 204);
      })
      .catch(function (error) {
        sendError(req, res, 500, error);
      });
  }

  /*
   * Patch a resource.
   */
  router.patch(individualRoute, updateResource);

  async function updateResource(req, res) {
    try {
      zipkinTracer.scoped(() => {
        const traceId = (req.zipkinTraceId = req.zipkinTraceId
          ? zipkinTracer.createChildId(req.zipkinTraceId)
          : zipkinTracer.createRootId());
        zipkinTracer.setId(traceId);
        zipkinTracer.recordServiceName(zipkinTracer._localEndpoint.serviceName);
        zipkinTracer.recordRpc('fortune-update-resource');
        zipkinTracer.recordBinary('fortune.resource', name);
        zipkinTracer.recordBinary(
          'fortune.update_operations_count',
          req.body.length,
        );
        zipkinTracer.recordAnnotation(new Annotation.ServerRecv());
      });

      const id = req.params.id;

      // header error handling
      if (!mimeCheck(req.get('content-type'))) {
        return sendError(req, res, 412);
      }

      req.query.fortuneExtensions = [];
      req.fortune.routeMetadata = _.extend({}, req.fortune.routeMetadata, {
        type: ROUTE_TYPES.updateResource,
        resource: collection,
      });
      const project = {};

      if (req.query.includeDeleted) {
        project.includeDeleted = true;
      }

      //Try to find  document
      const documents = await zipkinTracer.scoped(() => {
        zipkinTracer.setId(req.zipkinTraceId);
        return zipkinTracer.local('reading-resource-for-validation', () => {
          const localTracer = zipkin.makeLocalCallsWrapper(req, zipkinTracer);
          return findResourcesWithFortuneExtensions(
            [id],
            project,
            localTracer,
            req,
            res,
          );
        });
      });

      const document = _.first(documents);
      if (_.isNil(document)) return;

      // Generate updates and run beforewritehook
      const updates = await zipkinTracer.scoped(() => {
        zipkinTracer.setId(req.zipkinTraceId);
        return zipkinTracer.local('before-write-hooks', () => {
          // do before transform
          const operations = routeHelpers.buildPatchOperations(
            model,
            document,
            req.body,
          );

          return RSVP.all(
            operations.map(function (update) {
              //Pass only the part representing actual change to the hooks
              return RSVP.hash({
                match: update.match,
                update: beforeWriteHook(update.update, req, res),
              });
            }),
          );
        });
      });

      if (
        _.some(updates, function (update) {
          return !update.update;
        })
      ) {
        console.log(
          'Terminating PATCH request due to a transform returning false/empty',
        );
        return;
      }
      if (_.isEmpty(updates)) return;
      const chain = updates.reduce(function (acc, update) {
        return acc.then(function (prev) {
          return zipkinTracer.scoped(() => {
            zipkinTracer.setId(req.zipkinTraceId);
            return zipkinTracer.local('writing-database', async () => {

              const match = await adapter.preupdate(model, id, document);
              const recent = await adapter.update(
                model,
                { $and: [update.match, match] },
                update.update,
              );
              return recent || prev;
            });
          });
        });
      }, RSVP.resolve());

      const updatedResource = await chain;

      const afterWriteResource = await zipkinTracer.scoped(() => {
        zipkinTracer.setId(req.zipkinTraceId);
        return zipkinTracer.local('after-write-hooks', () => {
          return afterWriteHook(updatedResource, req, res);
        });
      });

      // send the response
      if (!afterWriteResource) return;
      const body = {
        [collection]: [afterWriteResource],
      };

      return sendResponse(req, res, 200, body);
    } catch (error) {
      if (
        _.isString(error.message) &&
        error.message.startsWith('Validation error:')
      ) {
        return sendError(req, res, 403, error);
      }
      return sendError(req, res, 500, error);
    }
  }

  /*
   * POSTing a resource to a predetermined ID is not allowed,
   * since that is what PUT is for.
   */
  router.post(individualRoute, methodNotAllowed);

  /*
   * GET a resource action
   */
  router.all(genericActionRoute, callGenericAction);

  router.all(actionRoute, callAction);

  function callAction(req, res) {
    const action = _this.actions.getAction(name, req.params.key, req.method);
    if (!action && req.method === 'GET') return getSubresources(req, res); //No action matched - try subresource route
    if (!action) return sendError(req, res, 404);
    if (action.method && action.method !== req.method)
      return sendError(req, res, 405);

    _this.direct
      .get(collection, req)
      .then(function (result) {
        const docs = result.body[collection];
        return RSVP.all(
          _.map(docs, function (doc) {
            const params = {
              id: req.params.id,
              action: req.params.key,
              resource: name,
              doc: doc,
            };
            return _this.actions.handleAction(params, req, res);
          }),
        );
      })
      .then(
        function (result) {
          if (!res.headersSent) {
            const body = {};
            body[collection] = _.isArray(result) ? result : [result];
            sendResponse(req, res, 200, body);
          }
        },
        function (err) {
          sendError(req, res, 500, err);
        },
      );
  }

  function callGenericAction(req, res) {
    const action = _this.actions.getAction(name, req.params.action, req.method);
    if (!action) return sendError(req, res, 404);
    if (action.method && action.method !== req.method)
      return sendError(req, res, 405);

    const params = {
      id: req.params.id,
      action: req.params.action,
      resource: name,
    };
    _this.actions.handleAction(params, req, res, _this.adapter).then(
      function (result) {
        if (!res.headersSent) {
          const body = {};
          body[collection] = _.isArray(result) ? result : [result];
          sendResponse(req, res, 200, body);
        }
      },
      function (err) {
        sendError(req, res, 500, err);
      },
    );
  }

  function schemaAssociations(schema) {
    const associations = [];
    _.each(schema, function (value, key) {
      let type = _.isArray(value) ? value[0] : value;
      type = _.isPlainObject(type) ? type.ref : type;
      if (typeof type === 'string') {
        type = inflect.pluralize(type);
        associations.push({ key: key, type: type });
      }
    });
    return associations;
  }

  function addLinksToBody(body, schema, prefix) {
    const baseUrl = this.options.baseUrl,
      namespace = this.options.namespace,
      associations = schemaAssociations(schema);
    if (!associations.length) return;

    body.links = body.links || {};
    associations.forEach(function (association) {
      const name = [prefix, association.key].join('.');
      body.links[name] = {
        type: association.type,
      };
      if (baseUrl) {
        body.links[name].href = `${baseUrl}/${
          !!namespace ? `${namespace}/` : ''
        }${association.type}/{${name}}`;
      }
    });
  }

  function linkedIds(resources, path, schema) {
    let ids = [];
    _.each(resources, function (resource) {
      if (_.isArray(schema[path]) || _.isObject(schema[path])) {
        const isExt = (_.isArray(schema[path]) ? schema[path][0] : schema[path])
          .external;

        if (resource.links && resource.links[path] && !isExt) {
          const id = resource.links[path];
          if (_.isArray(id)) {
            ids = ids.concat(
              _.map(id, function (d) {
                return d.toString();
              }),
            );
          } else {
            ids.push(id.toString());
          }
        }
      }
    });

    return ids;
  }

  function getTypeOfRef(schema, key) {
    const type = _.isArray(schema[key]) ? schema[key][0] : schema[key];
    return _.isPlainObject(type) ? type.ref : type;
  }

  function getLinked(ids, type, req) {
    const deferred = RSVP.defer();

    if (ids.length > 0) {
      const collection = inflect.pluralize(type);
      director.methods
        .get(
          collection,
          _.extend({}, req, {
            params: { id: ids.join(',') },
            query: {
              fields: req.query.fields,
              extraFields: req.query.extraFields,
              includeDeleted: req.query.includeDeleted || false,
            },
            /* the line below fixes mocha "Fortune test runner Fortune compound document support
             * should return grandchild plus child documents of people when requested"
             *
             * however, this may be an indicator of a broader design issue where it's hard for the
             * library code to distinguish between the native and custom request properties which
             * may cause inconsistent behaviour
             *
             * suggested solution: nesting custom properties, e.g. req.custom.linker = linker
             */
            zipkinTraceId: req.zipkinTraceId,
            linker: undefined,
          }),
        )
        .then(function (response) {
          deferred.resolve({
            type: collection,
            resources: response.body[collection],
          });
        });
    } else {
      deferred.resolve(type ? { type: inflect.pluralize(type) } : undefined);
    }
    return deferred.promise;
  }

  function buildPathsTree(inclusions) {
    const includePaths = {};

    _.each(inclusions, function (include) {
      include = include.split('.');
      let location = includePaths;
      _.each(include, function (part) {
        if (!location[part]) {
          location[part] = { __includeInBody: false };
        }
        location = location[part];
      });
      location.__includeInBody = true;
    });
    return includePaths;
  }

  /**
   * Refactoring options:
   * 1. Make it yield parts of `body` rather than operate on it directly
   */
  function appendLinked(
    linkpath,
    body,
    resources,
    schema,
    inclusions,
    req,
    res,
  ) {
    // build of tree of paths to fetch and maybe include
    const includePaths = buildPathsTree(inclusions);
    const _this = this;

    const fetchedIds = {};
    body.linked = {};

    return fetchChildren(linkpath, includePaths, resources, schema).then(
      function () {
        return body;
      },
    );

    function fetchChildren(linkpath, config, resources, schema) {
      return RSVP.all(
        _.map(_.keys(config), function (key) {
          if (key === '__includeInBody') return null;

          const type = getTypeOfRef(schema, key),
            ids = _.difference(
              linkedIds(resources, key, schema),
              fetchedIds[type],
            );

          //only wanna cache ids for resources that are going to be present in the body
          if (config[key].__includeInBody) {
            fetchedIds[type] = _.union(fetchedIds[type] || [], ids);
          }

          return getLinked
            .call(_this, ids, type, req, res)
            .then(function (result) {
              const relation = _.isArray(schema[key])
                ? schema[key][0]
                : schema[key];

              if (relation && relation.external) {
                const pluralisedRef = inflect.pluralize(relation.ref || key);
                body.linked[pluralisedRef] = 'external';
                body.links[`${linkpath}.${key}`] = { type: pluralisedRef };
              }

              if (result && result.resources) {
                if (config[key].__includeInBody) {
                  body.linked[result.type] = body.linked[result.type] || [];
                  body.linked[result.type] = body.linked[result.type].concat(
                    result.resources,
                  );
                  body.links[`${linkpath}.${key}`] = { type: result.type };
                }
                return fetchChildren(
                  `${linkpath}.${key}`,
                  config[key],
                  result.resources,
                  _this._schema[inflect.singularize(result.type)],
                );
              } else if (result && result.type) {
                if (config[key].__includeInBody) {
                  body.linked[result.type] = body.linked[result.type] || [];
                  body.links[`${linkpath}.${key}`] = { type: result.type };
                }
              }
            });
        }),
      );
    }
  }

  /*
   * Append a top level "links" object for URL-style JSON API.
   *
   * @api private
   * @param {Object} body deserialized response body
   * @return {Object}
   */
  function appendLinks(body, req, res) {
    const schemas = this._schema,
      _this = this;
    const promises = [];

    _.each(body, function (value, key) {
      if (key === 'meta') return;
      const modelName = inflect.singularize(key),
        schema = schemas[modelName];

      if (schema) {
        addLinksToBody.call(_this, body, schema, key);
        if (req.query.include) {
          const includes = _.isUndefined(req.scopedIncludes)
            ? req.query.include
            : req.scopedIncludes;
          promises.push(
            appendLinked.call(
              _this,
              inflect.pluralize(modelName),
              body,
              body[key],
              schema,
              ensureQueryArray(includes),
              req,
              res,
            ),
          );
        }
      }
    });

    return RSVP.all(promises).then(function () {
      return body;
    });
  }

  function getAssociations(schema) {
    const associations = [];
    const options = this.options;

    _.each(schema, function (value, key) {
      const singular = !_.isArray(value);
      let type = !singular ? value[0] : value;
      let external = false;

      if (_.isPlainObject(type)) {
        external = !!type.external;
        type = type.ref;
      }

      if (typeof type === 'string') {
        type = options.inflect ? inflect.pluralize(type) : type;
        associations.push({
          key: key, //Field key in (foreign) resource
          type: type, //Resource name that is referenced by foreign resource
          singular: singular, //Association type (...to-one/...to-many)
          external: external,
        });
      }
    });
    return associations;
  }

  function parseSelectProjection(fields, modelName) {
    try {
      if (_.isObject(fields)) {
        return fields[modelName].split(',');
      } else if (_.isString(fields)) {
        return fields.split(',');
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  /**
   * Find resource with fortuneExtensions filter, in security purposes, as it includes all policies related restrictions
   * @param ids
   * @param projection
   * @param localTracer
   * @param req
   * @param res
   * @returns {*}
   */
  async function findResourcesWithFortuneExtensions(
    ids,
    projection,
    localTracer,
    req,
    res,
  ) {
    try {
      if (ids) {
        req.query.filter = req.query.filter || {};
        if (ids.length === 1) {
          req.query.filter.id = ids[0];
        } else {
          req.query.filter.id = { $in: ids };
        }
      }

      //run before read
      await localTracer('before-read-hooks', () =>
        beforeReadHook({}, req, res),
      );

      // get resources by IDs
      const match = {
        $and: [req.query.filter].concat(req.query.fortuneExtensions),
      };

      const resources = await localTracer('reading-database', () => {
        zipkinTracer.recordBinary(
          'fortune.mongo_query',
          zipkin.safeStringify(match),
        );
        zipkinTracer.recordBinary(
          'fortune.mongo_projection',
          zipkin.safeStringify(projection),
        );
        return adapter.findMany(model, match, projection);
      });

      if (resources.length) return resources;

      // check if we any restriction is applied
      const notRestricted = _.isEmpty(
        req.query.fortuneExtensions.filter((ext) => {
          if (_.isEmpty(ext)) return false;
          return true;
        }),
      );
      if (req.query.includeDeleted && notRestricted) {
        // the list includes all available docs
        console.log(
          'The list includes all available docs. No restrictions applied.',
        );
        return sendError(req, res, 404);
      }

      const projectionWithDeleted = _.clone(projection);
      projectionWithDeleted.includeDeleted = true;
      const lessRestrictiveFilter = _.clone(req.query.filter);

      // for efficiency reasons, if more than one doc is requested, the response code depends  on the first doc's state only
      if (ids && ids.length > 1) {
        lessRestrictiveFilter.id = ids[0];
      }

      const nonRestrictedResources = await adapter.findMany(
        model,
        { $and: [lessRestrictiveFilter] },
        projectionWithDeleted,
      );
      if (_.isEmpty(nonRestrictedResources)) {
        sendError(req, res, 404);
      }

      const nonDeletedDocuments = nonRestrictedResources.filter(
        sift({ $and: req.query.fortuneExtensions }),
      );
      if (_.isEmpty(nonDeletedDocuments)) {
        return sendError(req, res, 403);
      }

      return sendError(req, res, 410);
    } catch (err) {
      return sendError(req, res, 500, err);
    }
  }
}

/*
 * Expose the route method.
 */
module.exports = route;
