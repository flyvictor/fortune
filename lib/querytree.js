const _ = require('lodash');
const specialKeys = ['in', 'exists'];

async function resolveObjectValues(object) {
  const entries = await Promise.all(
    Object.entries(object).map(async function ([key, value]) {
      return [key, await value];
    }),
  );
  return Object.fromEntries(entries);
}

function isSpecial(query) {
  return _.every(Object.keys(query), function (key) {
    return key.charAt(0) === '$' || specialKeys.indexOf(key) !== -1;
  });
}

function ensureQueryArray(inValue) {
  if (_.isArray(inValue)) return inValue;
  if (_.isString(inValue)) return inValue.split(',');
  if (_.isObject(inValue)) return _.values(inValue);

  console.log('ensureQueryArray cannot handle the input value', inValue);
  throw new Error('ensureQueryArray cannot handle the input value');
}

/**
 * registers fortune instance
 * expects that all resources have been defined
 */
exports.init = function (fortune) {
  const director = fortune.director;
  const resources = fortune._resources;
  const inflect = fortune.inflect;

  /**
   * Query node constructor.
   * @param resource
   * @param query
   * @param [root]
   * @constructor
   */
  function QueryNode(request, resource, query, root) {
    this.isRoot = !!root;
    this.request = request;
    this.resource = resource;
    this.query = parseQuery(request, query, resource);
  }

  /**
   * Iterates first level of query detecting filtering by referenced resources fields
   * @param query
   * @param requestedResource
   */
  function parseQuery(request, query, requestedResource) {
    //If found linked resource - create new node
    const freeze = {};
    for (const [key, q] of Object.entries(query || {})) {
      //find key in cached resources
      const schemaBranch = resources[requestedResource].schema[key];
      if (_.isObject(schemaBranch) && _.isObject(q)) {
        //Three options: ref by array, ref by object, business PK, array field
        if (
          _.isArray(schemaBranch) &&
          (!!schemaBranch[0].ref || _.isString(schemaBranch[0]))
        ) {
          //ref by array or $in query. Both types of declarations
          if (isSpecial(q)) {
            freeze[key] = q;
          } else {
            freeze[key] = createSubrequest(
              request,
              q,
              schemaBranch[0].ref || schemaBranch[0],
            );
          }
        } else if (!!schemaBranch.ref && _.isObject(q)) {
          //ref by object
          if (q.in || q.$in) {
            freeze[key] = {
              $in: ensureQueryArray(q.in || q.$in),
            };
          } else if (q.nin || q.$nin) {
            freeze[key] = {
              $nin: ensureQueryArray(q.nin || q.$nin),
            };
          } else if (isSpecial(q)) {
            freeze[key] = q;
          } else {
            freeze[key] = createSubrequest(request, q, schemaBranch.ref);
          }
        } else {
          //Business PK in schema or an operator in query
          //Do nothing and skip this query to fetchIds without any change
          freeze[key] = q;
        }
      } else if (_.isString(schemaBranch) && _.isObject(q)) {
        //String ref
        freeze[key] = createSubrequest(request, q, schemaBranch);
      } else {
        if (key === 'or' || key === 'and' || key === '$and' || key === '$or') {
          freeze[key] = Promise.all(
            _.map(q, function (subq) {
              return instance.parse(request, requestedResource, subq);
            }),
          );
        } else {
          //Plain field
          //Do nothing. fetchIds should have this untouched
          freeze[key] = q;
        }
      }
    }
    return resolveObjectValues(freeze);
  }

  /**
   * Initiates new node and returns a promise
   * @param subQuery
   * @param toResource
   */
  async function createSubrequest(request, subQuery, toResource) {
    const node = new QueryNode(request, toResource, subQuery);
    const result = await node.query;
    return fetchIds(request, node.resource, result);
  }

  /**
   * Converts bottom-level query to {$in: [ids]}
   * @param resource
   * @param query
   * @returns {*}
   */
  async function fetchIds(request, resource, query) {
    const resourceName = inflect.pluralize(resource);
    const response = await director.methods.get(
      resourceName,
      _.extend({}, request, {
        query: {
          filter: query,
          fields: 'id',
          limit: 0,
        },
        linker: undefined, //Needs to be set according to resource linking logic..
      }),
    );
    return { $in: _.map(response.body[resourceName], 'id') };
  }

  const instance = {
    parse: function (request, resourceName, query) {
      const rootNode = new QueryNode(request, resourceName, query, true);
      return rootNode.query;
    },
    _QueryNode: QueryNode,
  };

  return instance;
};

exports.ensureQueryArray = ensureQueryArray;
