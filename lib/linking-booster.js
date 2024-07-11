const RSVP = require('rsvp');
const _ = require('lodash');
const { ensureQueryArray } = require('./querytree');

exports.init = function (director, inflect, resources) {
  const refsHash = {};
  const ops = {};

  //Build refs hash for quick links retrieval
  _.each(resources, function (resource, resourceName) {
    _.each(resource.schema, function (metadata, fieldName) {
      const meta = _.isArray(metadata) ? metadata[0] : metadata;
      if (meta.ref && !meta.external) {
        refsHash[`${inflect.pluralize(resourceName)}.${fieldName}`] = {
          resource: inflect.pluralize(meta.ref),
          field: meta.inverse,
        };
      }
    });
  });

  ops.canBoost = function (req) {
    const parts = req.path.split('/');
    return (
      parts.length === 3 &&
      parts[2].length !== 0 &&
      !!req.query.include &&
      !req.query.includeDeleted
    );
  };

  ops.groupIncludes = function (req, includes) {
    //This should return instructions for fetchByFilter
    const root = req.path.split('/')[1];
    const id = req.path.split('/')[2];
    req.originalIncludes = _.clone(includes);
    const instructions = {};

    includes = _.compact(
      _.map(includes, function (include) {
        const parts = include.split('.');
        const includeParent = parts[0];

        const link = refsHash[`${root}.${includeParent}`];
        if (link) {
          //It's not external and has valid ref
          if (link.field) {
            //It has inverse reference thus can be filtered
            const query = {};
            query[link.field] = { $in: _.isArray(id) ? id : id.split(',') };
            instructions[includeParent] = instructions[includeParent] || {};
            instructions[includeParent].resource = link.resource;
            instructions[includeParent].as = link.resource;
            instructions[includeParent].filter = query;
            instructions[includeParent].include =
              instructions[includeParent].include || [];
            instructions[includeParent].include.push(_.tail(parts));
            if (req.query) {
              if (req.query.fields) {
                instructions[includeParent].fields = req.query.fields;
              }
              if (req.query.extraFields) {
                instructions[includeParent].extraFields = req.query.extraFields;
              }
            }
            return null;
          }
        }
        return include;
      }),
    );

    req.scopedIncludes = includes.join(',');
    return instructions;
  };

  ops.startLinking = function (req) {
    if (!req.query || !req.query.include) return RSVP.resolve();

    const groups = ops.groupIncludes(req, parseIncludes(req));

    return RSVP.all(
      _.map(groups, function (requestOptions, pathName) {
        const subQuery = {
          filter: requestOptions.filter,
          include: _.compact(
            _.map(requestOptions.include, function (i) {
              return i.join('.');
            }),
          ).join(','),
        };
        if (requestOptions.fields) {
          subQuery.fields = requestOptions.fields;
        }
        if (requestOptions.extraFields) {
          subQuery.extraFields = requestOptions.extraFields;
        }
        return director.methods
          .get(
            requestOptions.resource,
            _.extend({}, req, {
              query: subQuery,
              params: undefined,
              path: undefined,
              originalIncludes: undefined,
              scopedIncludes: undefined,
            }),
          )
          .then(function (response) {
            return {
              data: response.body,
              as: requestOptions.resource,
              path: pathName,
            };
          });
      }),
    );
  };

  ops.mergeResults = function (req, linker, body) {
    const root = req.path.split('/')[1];
    return linker.then(function (linked) {
      _.each(linked, function (result) {
        const linkedData = result.data;
        const anc = getAncestorName(linkedData);
        if (ops.includeInBody(req, result.path)) {
          body.links = body.links || {};
          body.linked = body.linked || {};
          body.links[`${root}.${anc}`] = {
            type: anc,
          };
          body.linked[anc] = body.linked[anc]
            ? ops.uniq(body.linked[anc].concat(linkedData[anc]))
            : linkedData[anc];
        }
        if (linkedData.linked) {
          _.each(linkedData.linked, function (data, type) {
            body.linked[type] =
              data === 'external'
                ? 'external'
                : body.linked[type]
                ? ops.uniq(body.linked[type].concat(data))
                : data;
          });
        }
        if (linkedData.links) {
          _.each(linkedData.links, function (data, partialPath) {
            const partials = _.tail(partialPath.split('.'));
            body.links[`${root}.${result.path}.${partials.join('.')}`] = data;
          });
        }
      });
      return body;
    });
  };

  ops.uniq = function (resources) {
    const ids = [];
    return _.compact(
      _.map(resources, function (item) {
        if (ids.indexOf(item.id) !== -1) return null;
        ids.push(item.id);
        return item;
      }),
    );
  };

  ops.includeInBody = function (req, path) {
    const includePaths = parseIncludes(req);
    return _.some(includePaths, function (requested) {
      return _.last(requested.split('.')) === path;
    });
  };

  return ops;

  function parseIncludes(req) {
    return ensureQueryArray(req.query.include);
  }

  function getAncestorName(obj) {
    return Object.keys(_.omit(obj, 'links', 'linked'))[0];
  }
};
