const mongoose = require('mongoose');
const RSVP = require('rsvp');
const _ = require('lodash');

const Promise = RSVP.Promise;
const adapter = {};

mongoose.Promise = Promise;

adapter._init = function (options) {
  let connectionString = options.connectionString;

  if (!connectionString || !connectionString.length) {
    connectionString = `mongodb://${
      options.username ? `${options.username}:${options.password}@` : ''
    }${options.host}${options.port ? `:${options.port}` : ''}/${options.db}`;
  }

  mongoose.set('debug', options.debug);

  const mongoOptions = _.extend(
    {
      config: {
        autoIndex: false,
      },
    },
    options.flags,
  );

  //Setup mongoose instance
  this.db = mongoose.createConnection(connectionString, mongoOptions);
};

/**
 * Store models in an object here.
 *
 * @api private
 */
adapter._models = {};

adapter.schema = function (name, schema, options, schemaCallback) {
  options = options || {};

  const refkeys = [];
  const pk = (options.model || {}).pk;

  _.each(schema, function (val, key) {
    const isArray = _.isArray(val);
    const value = isArray ? val[0] : val;
    const isObject = _.isPlainObject(value);
    const ref = isObject ? value.ref : value;
    const inverse = isObject ? value.inverse : undefined;
    const pkType = value.type || value.pkType || mongoose.Schema.Types.ObjectId;

    // Convert strings to associations
    if (typeof ref === 'string') {
      const field = _.extend(isObject ? value : {}, {
        ref: ref,
        inverse: inverse,
        type: pkType,
        external: !!value.external,
        alias: val.alias || null,
      });

      schema[key] = isArray ? [field] : field;

      refkeys.push(key);
    }

    // Convert native object to schema type Mixed
    if (typeof value == 'function' && typeCheck(value) == 'object') {
      if (isObject) {
        schema[key].type = mongoose.Schema.Types.Mixed;
      } else {
        schema[key] = mongoose.Schema.Types.Mixed;
      }
    }
  });

  if (pk) {
    if (_.isFunction(schema[pk])) {
      schema[pk] = { type: schema[pk] };
    } else if (!(_.isObject(schema[pk]) && schema[pk].type)) {
      throw new Error(
        'Schema PK must either be a type function or an object with a ' +
          '`type` property',
      );
    }

    if (!schema._tenantId) {
      _.extend(schema[pk], { index: { unique: true } });
    } else {
      _.extend(schema[pk], { index: true });
    }
  }

  const hasTenantId = !!schema._tenantId;
  const mongooseSchema = mongoose.Schema(schema, options);
  mongooseSchema.refkeys = refkeys;

  _.each(refkeys, function (key) {
    const index = {};
    index[key] = 1;

    mongooseSchema.index(index);
  });

  //Set index on deletedAt
  mongooseSchema.index({
    deletedAt: 1,
  });

  if (hasTenantId) {
    mongooseSchema.index({
      _tenantId: 1,
    });
    if (pk) {
      const ind = { _tenantId: 1 };
      ind[pk] = 1;
      mongooseSchema.index(ind, { unique: true, sparse: true });
    }
  }

  if (schemaCallback) schemaCallback(mongooseSchema);

  return mongooseSchema;

  function typeCheck(fn) {
    return Object.prototype.toString
      .call(new fn(''))
      .slice(1, -1)
      .split(' ')[1]
      .toLowerCase();
  }
};

adapter.model = function (name, schema, options) {
  if (schema) {
    const model = this.db.model(name, schema);
    this._models[name] = model;
    return _.extend(model, options);
  } else {
    return this._models[name];
  }
};

function getFullKeys(update, existingResource) {
  return _.reduce(
    update,
    function (memo, value, key) {
      if (_.isObject(value) && !_.isArray(value)) {
        const currentValue = existingResource && existingResource[key];
        if (_.isNull(currentValue)) {
          memo[key] = value;
        } else {
          _.each(_.keys(value), function (nested) {
            memo[`${key}.${nested}`] = value[nested];
          });
        }
      } else {
        memo[key] = value;
      }
      return memo;
    },
    {},
  );
}

adapter.create = function (model, id, resource) {
  const _this = this;
  if (!resource) {
    resource = id;
  } else {
    if (model.pk) {
      resource[model.pk] = id;
    } else {
      resource.id = id;
    }
  }

  model = typeof model == 'string' ? this.model(model) : model;
  resource = this._serialize(model, resource);
  return new Promise(function (resolve, reject) {
    const upsert = _this._shouldUpsert(model, resource);

    if (upsert.status) {
      const update = _this._serialize(model, resource);
      function tryUpsert(count) {
        return new Promise(function (resolve, reject) {
          model.findOne(upsert.match, function (err, matched) {
            if (err) return reject(err);
            model.findOneAndUpdate(
              { _id: matched._id },
              { $set: getFullKeys(update, matched && matched.toObject()) },
              _.extend({}, upsert.opts, { new: true }),
              function (error, r) {
                if (error && error.code === 16837)
                  return tryUpsert(count ? count++ : 0);
                if (error) return reject(error);
                resolve(r);
              },
            );
          });
        }).catch(function (err) {
          if (count < 5) {
            return tryUpsert(count++);
          } else {
            throw err;
          }
        });
      }
      tryUpsert(0).then(
        function (r) {
          _this._handleWrite(model, r, null, resolve, reject);
        },
        function (err) {
          reject(err);
        },
      );
    } else {
      model.create(resource, function (error, resource) {
        _this._handleWrite(model, resource, error, resolve, reject);
      });
    }
  });
};

adapter.preupdate = function (model, id) {
  model = typeof model === 'string' ? this.model(model) : model;
  const pk = model.pk || '_id';
  const query = {};
  query[pk] = id;
  return query;
};

adapter.update = function (model, match, update) {
  const _this = this;
  model = typeof model == 'string' ? this.model(model) : model;

  update = this._serialize(model, update);

  return new Promise(function (resolve, reject) {
    //Make sure all updates are under $-prefixed mongo operation
    //If there's no $ on the key handle it as $set
    //Anything present in $set takes precedence
    const correctUpdate = {};
    Object.keys(update).forEach(function (k) {
      if (/^\$/.test(k)) {
        correctUpdate[k] = update[k];
      } else {
        correctUpdate.$set = correctUpdate.$set || {};
        _.extend(correctUpdate.$set, _.pick(update, k), correctUpdate.$set);
      }
    });

    const modifiedRefs = _this._getModifiedRefs(update);
    model.findOne(match, '_id', function (err, matched) {
      if (err) return reject(err);
      model.findOneAndUpdate(
        { _id: matched._id },
        correctUpdate,
        { new: true },
        function (error, resource) {
          if (_.isNull(resource)) return resolve();
          _this._handleWrite(
            model,
            resource,
            error,
            resolve,
            reject,
            modifiedRefs,
          );
        },
      );
    });
  });
};

adapter.markDeleted = function (model, id) {
  const _this = this;
  model = typeof model == 'string' ? this.model(model) : model;
  const pk = model.pk || '_id';

  if (_.isArray(id)) id = { $in: id };

  return new Promise(function (resolve, reject) {
    const match = {};
    if (id) match[pk] = id;

    model.find(match).exec(function (error, resources) {
      if (error) return reject(error);

      RSVP.all(
        _.map(resources, function (resource) {
          return new Promise(function (resolve, reject) {
            const references = adapter._getAllReferences(model);

            const links = _.reduce(
              references,
              function (memo, ref) {
                memo[ref.path] = resource[ref.path];
                return memo;
              },
              {},
            );

            const unsetLinks = _.reduce(
              references,
              function (memo, ref) {
                memo[ref.path] = 1;
                return memo;
              },
              {},
            );

            const update = {
              $set: { _links: links, deletedAt: new Date() },
            };
            if (!_.isEmpty(unsetLinks)) {
              update.$unset = unsetLinks;
            }

            model.findOneAndUpdate(
              { _id: resource._id },
              update,
              { new: true },
              function (error, updatedResource) {
                if (error) {
                  reject(error);
                } else {
                  resolve(updatedResource);
                }
              },
            );
          });
        }),
      ).then(
        function (resources) {
          resolve(resources);
        },
        function (err) {
          reject(err);
        },
      );
    });
  }).then(function (resources) {
    return RSVP.all(
      _.map(resources, function (resource) {
        return new RSVP.Promise(function (resolve, reject) {
          _this._handleWrite(model, resource, null, resolve, reject);
        }).then(function () {
          return _this._deserialize(model, resource);
        });
      }),
    );
  });
};

adapter.delete = function (model, id) {
  const _this = this;
  //Delegating to markDeleted to handle linking
  return _this.markDeleted(model, id).then(function (returnValue) {
    model = typeof model == 'string' ? this.model(model) : model;
    const pk = model.pk || '_id';

    if (_.isArray(id)) id = { $in: id };

    return new Promise(function (resolve, reject) {
      const match = {};
      if (id) match[pk] = id;

      model.find(match).exec(function (error, resources) {
        const ids = resources.map(function (resource) {
          return resource._id;
        });

        model.remove({ _id: { $in: ids } }, function (error) {
          if (error) {
            reject(error);
          } else {
            resolve(resources);
          }
        });
      });
    }).then(function () {
      return returnValue;
    });
  });
};

/**
 *
 * @param model {Model}
 * @param query {Object}
 * @param projection {Object}
 * @returns {Promise}
 */
adapter.find = function (model, query, projection) {
  if (!_.isObject(query)) query = { id: query };

  projection = projection || {};
  projection.select = removeUselessProjectionSelect(projection.select, model);
  projection.limit = 1;
  return new Promise(function (resolve, reject) {
    return adapter.findMany(model, query, projection).then(
      function (resources) {
        if (!resources || resources.length === 0) {
          return reject();
        }
        return resolve(resources[0]);
      },
      function (err) {
        reject(err);
      },
    );
  });
};

function deepReplaceIds(dbQuery, pk) {
  const result = {};
  _.each(dbQuery, function (v, k) {
    if (k === '$and' || k === '$or') {
      result[k] = _.map(v, function (subQ) {
        return deepReplaceIds(subQ, pk);
      });
    } else if (k === 'id') {
      result[pk] = v;
    } else {
      result[k] = v;
    }
  });
  return result;
}

function deepReplaceFalsies(query) {
  _.each(query, function (val, key) {
    if (val === 'null') {
      query[key] = null;
    } else if (val === 'undefined') {
      query[key] = undefined;
    } else if (_.isObject(val)) {
      if (_.isArray(val)) {
        val = _.map(val, function (item) {
          if (item === 'null') return null;
          if (item === 'undefined') return undefined;
          return item;
        });
      } else {
        deepReplaceFalsies(val);
      }
    }
  });
}

/**
 * @param model {Model || String}
 * @param query {Object}
 * //@param limit {Number} - deprecated as unused
 * @param projection {Object}
 * @returns {Promise}
 */

adapter.findMany = function (model, query, projection) {
  return adapter._findMany(model, query, projection, false);
};

adapter.count = function (model, query, projection) {
  return adapter._findMany(model, query, projection, true);
};

adapter.parseQuery = function (model, query) {
  model = typeof model == 'string' ? this._models[model] : model;
  const pk = model.pk || '_id';
  let dbQuery = {};

  query = _.clone(query);

  _.each(query, function (val, key) {
    const type = (model.schema.tree[key] || {}).name;

    if (_.isNull(val) || _.isUndefined(val)) {
      if (key[0] === '$') delete query[key]; // clean up props like $in: undefined
    } else if (
      _.isObject(val) &&
      (_.has(val, 'exists') || _.has(val, '$exists'))
    ) {
      const exists = (val['exists'] || val['$exists'] || '')
        .toString()
        .toLowerCase();
      query[key] = { $exists: exists == 'true' ? true : false };
    } else if (type === 'Date') {
      if (_.isString(val)) {
        const date = Date.parse(val);
        query[key] = {
          $gte: date || val,
          $lte: date || val,
        };
      } else if (_.isObject(val)) {
        query[key] = _.fromPairs(
          _.compact(
            _.map(['gt', 'gte', 'lt', 'lte'], function (op) {
              const value = val[op] || val[`$${op}`];
              return value
                ? [`$${op}`, Date.parse(value.toString()) || value]
                : null;
            }),
          ),
        );
        if (_.has(val, '$ne')) {
          query[key].$ne = val.$ne;
        }
      }
    } else if (type === 'Number' && _.isObject(val)) {
      //gt/gte/lt/lte for dates and numbers
      query[key] = _.reduce(
        val,
        function (memo, opVal, op) {
          memo[{ gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' }[op] || op] =
            opVal;
          return memo;
        },
        {},
      );
    } else if (_.isString(val.in || val.$in)) {
      query[key] = {
        $in: (val.in || val.$in).split(','),
      };
    } else if (_.isObject(val) && _.isString(val.regex)) {
      //regex
      query[key] = {
        $regex: val.regex ? val.regex : '',
        $options: val.options ? val.options : '',
      };
    } else if (key === 'or' || key === 'and') {
      query[`$${key}`] = _.map(val, function (q) {
        return adapter.parseQuery(model, q);
      });
      delete query[key];
    } else if (key === '$or' || key === '$and') {
      query[key] = _.map(val, function (q) {
        return adapter.parseQuery(model, q);
      });
    }
  });

  if (_.isObject(query)) {
    if (_.isArray(query)) {
      if (query.length === 1) {
        dbQuery[pk] = query[0];
      } else if (query.length) {
        dbQuery[pk] = { $in: query };
      }
    } else {
      dbQuery = _.clone(query);

      deepReplaceFalsies(dbQuery);
    }
  }

  return deepReplaceIds(dbQuery, pk);
};

adapter._findMany = function (model, query, projection, count) {
  const _this = this;

  model = typeof model == 'string' ? this._models[model] : model;

  if (_.isObject(query)) {
    query = this.parseQuery(model, query);
  } else if (typeof query === 'number') {
    //Just for possible backward compatibility issues
    projection = projection || {};
    projection.limit = query;
    query = {};
  }

  projection = projection || {};
  projection.select = removeUselessProjectionSelect(projection.select, model);
  projection.skip = 0;

  if (projection.page && projection.page > 0) {
    projection.skip = (projection.page - 1) * projection.pageSize;
    projection.limit = projection.pageSize;
  }

  //Ensure business id is included to selection
  let pkNotRequested = false;
  if (_.isArray(projection.select)) {
    if (model.pk) {
      if (projection.select.indexOf(model.pk) === -1) {
        projection.select.push(model.pk);
        pkNotRequested = true;
      }
    }
    projection.select = projection.select.join(' ');
  }

  return new Promise(function (resolve, reject) {
    //Take care of deleted resources
    query = query || {};
    if (projection && !projection.includeDeleted) query.deletedAt = null;

    if (count) {
      model.count(query).exec(function (error, result) {
        if (error) return reject(error);
        resolve(result);
      });
    } else {
      const q = model
        .find(query)
        .limit(projection.limit)
        .select(projection.select);
      if (projection.sort) {
        q.sort(projection.sort);
      }
      q.skip(projection.skip)
        .lean(true)
        .exec(function (error, resources) {
          if (error) {
            return reject(error);
          }

          resources = resources.map(function (resource) {
            const temp = _this._deserialize(model, resource);
            if (pkNotRequested) {
              //Remove business pk field if it's not required
              delete temp[model.pk];
            }
            return temp;
          });
          resolve(resources);
        });
    }
  });
};

adapter.awaitConnection = function () {
  const _this = this;
  return new Promise(function (resolve, reject) {
    _this.db.once('connected', function () {
      resolve();
    });
    _this.db.once('error', function (error) {
      reject(error);
    });
  });
};

/**
 * Parse incoming resource.
 *
 * @api private
 * @param {Object} model
 * @param {Object} resource
 * @return {Object}
 */
adapter._serialize = function (model, resource) {
  if (resource.hasOwnProperty('id')) {
    const pk = model.pk || '_id';
    const pkType = model.schema.tree[pk];

    if (!_.isFunction(pkType)) {
      if (!(pkType = pkType.type)) {
        throw new Error(
          `Could not determine the type of PK for ${model.modelName}`,
        );
      }
    }

    const correctedPkType =
      pkType === mongoose.Schema.ObjectId ? mongoose.Types.ObjectId : pkType;
    resource[pk] = correctedPkType.call(pkType, resource[pk] || resource.id);

    if (!resource[pk]) {
      //If failed to cast - generate ObjectId from provided .id
      resource._id = mongoose.Types.ObjectId(resource.id.toString());
    }

    delete resource.id;
  }
  if (resource.hasOwnProperty('links') && typeof resource.links == 'object') {
    _.each(resource.links, function (value, key) {
      resource[key] = value;
    });
    delete resource.links;
  }

  return resource;
};

/**
 * Return a resource ready to be sent back to client.
 *
 * @api private
 * @param {Object} model
 * @param {Object} resource mongoose document
 * @return {Object}
 */
adapter._deserialize = function (model, resource) {
  const json = {};
  resource = (resource.toObject && resource.toObject()) || resource;

  json.id = resource[model.pk || '_id'];

  _.extend(json, _.omit(resource, '_id', '__v', '_links'));
  if (resource._links) json.links = resource._links;

  const relations = model.schema.refkeys;

  if (relations.length) {
    const links = {};

    _.each(relations, function (relation) {
      if (_.isArray(json[relation]) ? json[relation].length : json[relation]) {
        links[relation] = json[relation];
      }
      delete json[relation];
    });
    if (_.keys(links).length) {
      json.links = links;
    }
  }

  return json;
};

/**
 * What happens after the DB has been written to, successful or not.
 *
 * @api private
 * @param {Object} model
 * @param {Object} resource
 * @param {Object} error
 * @param {Function} resolve
 * @param {Function} reject
 * @param {Array} modifiedRefs
 */
adapter._handleWrite = function (
  model,
  resource,
  error,
  resolve,
  reject,
  modifiedRefs,
) {
  const _this = this;
  if (error) {
    return reject(error);
  }
  this._updateRelationships(model, resource, modifiedRefs).then(
    function (resource) {
      resolve(_this._deserialize(model, resource));
    },
    function (error) {
      reject(error);
    },
  );
};

/**
 * This method is designed to parse update command and return a list of paths that
 * will be modified by given update command.
 * It was introduced to handle relationship updates it a more neat way when only
 * modified paths trigger update of related documents.
 * It's NOT guaranteed to return ALL modified paths. Only that are of interest to _updateRelationships method
 * @param {Object} update
 * @private
 */
adapter._getModifiedRefs = function (update) {
  return getKeys(update);

  function getKeys(cmd) {
    let keys = [];
    _.each(cmd, function (value, key) {
      if (key.indexOf('$') === 0) {
        keys = keys.concat(getKeys(value));
      } else {
        keys.push(key);
      }
    });
    return keys;
  }
};

/**
 * Inspects provided model and returns array of references.
 */
function getAllReferences(model, modifiedRefs) {
  const references = [];
  _.each(model.schema.tree, function (value, key) {
    const singular = !_.isArray(value);
    const obj = singular ? value : value[0];
    if (typeof obj == 'object' && obj.hasOwnProperty('ref')) {
      if (_.isUndefined(modifiedRefs) || modifiedRefs.indexOf(key) !== -1) {
        references.push({
          path: key,
          model: obj.ref,
          singular: singular,
          inverse: obj.inverse,
          isExternal: obj.external,
        });
      }
    }
  });
  return references;
}

function getInverseReferences(model, modifiedRefs) {
  return adapter._getAllReferences(model, modifiedRefs).filter(function (ref) {
    return !!ref.inverse;
  });
}
adapter._getInverseReferences = getInverseReferences;
adapter._getAllReferences = getAllReferences;

/**
 * Update relationships manually. By nature of NoSQL,
 * relations don't come for free. Don't try this at home, kids.
 * You've been warned!
 *
 * @api private
 * @param {Object} model
 * @param {Object} resource
 * @param {Array} modifiedRefs
 * @return {Promise}
 */
adapter._updateRelationships = function (model, resource, modifiedRefs) {
  const _this = this;

  /**
   * Get fields that contain references.
   */

  const references = adapter._getInverseReferences(model, modifiedRefs);

  const promises = [];
  _.each(references, function (reference) {
    const relatedModel = _this._models[reference.model],
      fields = [];

    if (!reference.isExternal) {
      let relatedTree = relatedModel.schema.tree;

      // Get fields on the related model that reference this model
      if (typeof reference.inverse == 'string') {
        const inverted = {};
        inverted[reference.inverse] = relatedTree[reference.inverse];
        relatedTree = inverted;
      }
      _.each(relatedTree, function (value, key) {
        const singular = !_.isArray(value);
        const obj = singular ? value : value[0];

        if (typeof obj == 'object' && obj.ref == model.modelName) {
          fields.push({
            path: key,
            model: obj.ref,
            singular: singular,
            inverse: obj.inverse,
          });
        }
      });
    }

    // Iterate over each relation
    _.each(fields, function (field) {
      // One-to-one
      if (reference.singular && field.singular) {
        promises.push(
          _this._updateOneToOne(
            model,
            relatedModel,
            resource,
            reference,
            field,
          ),
        );
      }
      // One-to-many
      if (reference.singular && !field.singular) {
        promises.push(
          _this._updateOneToMany(
            model,
            relatedModel,
            resource,
            reference,
            field,
          ),
        );
      }
      // Many-to-one
      if (!reference.singular && field.singular) {
        promises.push(
          _this._updateManyToOne(
            model,
            relatedModel,
            resource,
            reference,
            field,
          ),
        );
      }
      // Many-to-many
      if (!reference.singular && !field.singular) {
        promises.push(
          _this._updateManyToMany(
            model,
            relatedModel,
            resource,
            reference,
            field,
          ),
        );
      }
    });
  });

  return new Promise(function (resolve, reject) {
    RSVP.all(promises).then(
      function () {
        resolve(resource);
      },
      function (errors) {
        reject(errors);
      },
    );
  });
};

/**
 * Update one-to-one mapping.
 *
 * @api private
 * @parameter {Object} relatedModel
 * @parameter {Object} resource
 * @parameter {Object} reference
 * @parameter {Object} field
 * @return {Promise}
 */

adapter._updateOneToOne = function (
  model,
  relatedModel,
  resource,
  reference,
  field,
) {
  const pk = model.pk || '_id';

  const match = {};
  match[field.path] = resource[pk];
  if (resource._tenantId) match._tenantId = resource._tenantId;

  return wrapAsyncCall(relatedModel, relatedModel.findOne, match, '_id')
    .then(function (oldResource) {
      // Dissociation
      const dissociate = { $unset: {} };
      dissociate.$unset[field.path] = resource[pk];
      return wrapAsyncCall(
        relatedModel,
        relatedModel.updateOne,
        { _id: oldResource._id },
        dissociate,
      );
    })
    .then(function () {
      const match = {};
      if (resource._tenantId) match._tenantId = resource._tenantId;
      match[relatedModel.pk || '_id'] = resource[reference.path];

      return wrapAsyncCall(relatedModel, relatedModel.findOne, match, '_id');
    })
    .then(function (newResource) {
      const associate = { $set: {} };
      associate.$set[field.path] = resource[model.pk || '_id'];
      return wrapAsyncCall(
        relatedModel,
        relatedModel.updateOne,
        { _id: newResource.id },
        associate,
        { new: true },
      );
    });
};

/**
 * Update one-to-many mapping.
 *
 * @api private
 * @parameter {Object} relatedModel
 * @parameter {Object} resource
 * @parameter {Object} reference
 * @parameter {Object} field
 * @return {Promise}
 */
adapter._updateOneToMany = function (
  model,
  relatedModel,
  resource,
  reference,
  field,
) {
  const pk = model.pk || '_id';

  const match = {};
  match[field.path] = resource[pk];
  if (resource._tenantId) match._tenantId = resource._tenantId;

  return wrapAsyncCall(relatedModel, relatedModel.findOne, match, '_id')
    .then(function (oldResource) {
      const dissociate = { $pull: {} };
      dissociate.$pull[field.path] = resource[pk];
      return wrapAsyncCall(
        relatedModel,
        relatedModel.updateOne,
        { _id: oldResource._id },
        dissociate,
      );
    })
    .then(function () {
      const match = {};
      if (resource._tenantId) match._tenantId = resource._tenantId;
      match[relatedModel.pk || '_id'] = resource[reference.path];

      return wrapAsyncCall(relatedModel, relatedModel.findOne, match, '_id');
    })
    .then(function (newResource) {
      const associate = { $addToSet: {} };
      associate.$addToSet[field.path] = resource[model.pk || '_id'];
      return wrapAsyncCall(
        relatedModel,
        relatedModel.updateOne,
        { _id: newResource.id },
        associate,
        { new: true },
      );
    });
};

/**
 * Update many-to-one mapping.
 *
 * @api private
 * @parameter {Object} model - model that has many-to-one ref
 * @parameter {Object} relatedModel - model with corresponding one-to-many ref
 * @parameter {Object} resource - resource currently being updated
 * @parameter {Object} reference - this model reference schema
 * @parameter {Object} field - related model reference schema
 * @return {Promise}
 */
adapter._updateManyToOne = function (
  model,
  relatedModel,
  resource,
  reference,
  field,
) {
  // Dissociation
  const dissociate = { $unset: {} },
    pk = model.pk || '_id',
    match = {};
  match[field.path] = resource[pk];
  if (resource._tenantId) match._tenantId = resource._tenantId;

  dissociate.$unset[field.path] = 1;

  return wrapAsyncCall(relatedModel, relatedModel.update, match, dissociate, {
    multi: true,
  })
    .then(function () {
      // Association
      const associate = { $set: {} };
      associate.$set[field.path] = resource[model.pk || '_id'];

      const match = {};
      match[relatedModel.pk || '_id'] = { $in: resource[reference.path] || [] };
      if (resource._tenantId) match._tenantId = resource._tenantId;

      return wrapAsyncCall(
        relatedModel,
        relatedModel.update,
        match,
        associate,
        { multi: true },
      );
    })
    .then(function () {
      return unbindRedundant(
        model,
        relatedModel,
        resource,
        reference.path,
        field.path,
      );
    });
};

function unbindRedundant(model, relatedModel, resource, refFrom, refTo) {
  if (!resource[refFrom]) return;
  const modelPK = model.pk || '_id';
  const relatedPK = relatedModel.pk || '_id';
  //First find matching doc to get it's id
  const match = {
    $and: [
      buildQueryObject(relatedPK, { $in: resource[refFrom] }),
      buildQueryObject(refTo, resource[modelPK]),
    ],
  };
  return wrapAsyncCall(relatedModel, relatedModel.findOne, match).then(
    function (matching) {
      if (matching) {
        const selfMatch = {
          $and: [
            //Ignore reference we need to persist
            buildQueryObject(modelPK, { $ne: matching[refTo] }),
            //Match all other docs that have ref to `matching`
            buildQueryObject(refFrom, { $in: [matching[relatedPK]] }),
          ],
        };
        //Pull every matching binding
        const unbind = {
          $pull: buildQueryObject(refFrom, matching[relatedPK]),
        };
        return wrapAsyncCall(model, model.update, selfMatch, unbind, {
          multi: true,
        });
      }
    },
  );
}

/**
 * Update many-to-many mapping.
 *
 * @api private
 * @parameter {Object} relatedModel
 * @parameter {Object} resource
 * @parameter {Object} reference
 * @parameter {Object} field
 * @return {Promise}
 */
adapter._updateManyToMany = function (
  model,
  relatedModel,
  resource,
  reference,
  field,
) {
  // Dissociation
  const dissociate = { $pull: {} },
    pk = model.pk || '_id',
    match = {};
  match[field.path] = resource[pk];
  if (resource._tenantId) match._tenantId = resource._tenantId;

  dissociate.$pull[field.path] = resource[pk];

  return wrapAsyncCall(relatedModel, relatedModel.update, match, dissociate, {
    multi: true,
  }).then(function () {
    // Association
    const associate = { $addToSet: {} };
    associate.$addToSet[field.path] = resource[model.pk || '_id'];

    //var ids = {_id: {$in: resource[reference.path] || []}};

    const match = {};
    match[relatedModel.pk || '_id'] = { $in: resource[reference.path] || [] };
    if (resource._tenantId) match._tenantId = resource._tenantId;

    return wrapAsyncCall(relatedModel, relatedModel.update, match, associate, {
      multi: true,
    });
  });
};

/**
 * Determine whether we should perform an upsert (ie. pass {upsert : true} to
 * Mongoose) if certain keys exist in the schema's resource.
 *
 * @api private
 * @parameter {Object} model
 * @parameter {Object} resource
 * @parameter {Object} ops
 * @return {Object}
 */
adapter._shouldUpsert = function (model, resource, opts) {
  opts = opts || {};

  const paths = model.schema.paths;
  const keys = model.schema.upsertKeys;
  const matches = [];
  const match = {};
  let status =
    keys.length > 0 &&
    _.every(keys, function (key) {
      const result = _.has(paths, key);
      if (result) matches.push(key);
      return result;
    });

  // Construct the match object based upon the resource itself and the first
  // of the keys matched against the schema.
  if (status && matches.length) {
    const matchKey = matches[0];

    // We only handle a depth of two here, ie. a key like `nested1.field2`
    if (/\./.test(matchKey)) {
      const parts = matchKey.split('.'),
        first = parts[0],
        second = parts[1];

      if (
        _.has(resource, first) &&
        _.has(resource[first], second) &&
        !!resource[first][second]
      ) {
        match[`${first}.${second}`] = resource[first][second];

        status = true;
      }

      // Otherwise just handle a depth of one, ie. `field1`
    } else if (resource[matchKey] && !!resource[matchKey]) {
      match[matchKey] = resource[matchKey];

      status = true;
    }
  }

  // If the resulting match object is empty, we cannot do a find and update.
  if (!_.keys(match).length) {
    status = false;
  }

  return {
    status: status,
    match: match,
    opts: _.extend(opts, { upsert: status }),
  };
};

adapter.aggregate = function (model, options) {
  model = typeof model === 'string' ? this.model(model) : model;
  return new Promise(function (resolve, reject) {
    model.aggregate(options.config, function (err, result) {
      if (err) return reject(err);
      resolve(result);
    });
  });
};

// expose mongoose
adapter.mongoose = mongoose;
module.exports = adapter;

//Helpers

function wrapAsyncCall(context, fn) {
  const args = Array.prototype.slice.call(arguments, 2);
  return new Promise(function (resolve, reject) {
    args.push(asyncCallback);
    fn.apply(context, args);

    function asyncCallback(err, result) {
      if (err) return reject(err);
      resolve(result);
    }
  });
}

function buildQueryObject(key, value) {
  const temp = {};
  temp[key] = value;
  return temp;
}

function removeUselessProjectionSelect(select, model) {
  if (!select) return '';

  const isSelectArray = _.isArray(select);
  const selectKeys = isSelectArray ? select : _.keys(select);

  const { nonNestedSelect, nestedSelect } = _.reduce(
    selectKeys,
    function (acc, key) {
      if (_.includes(key, '.')) {
        acc.nestedSelect.push(key);
      } else {
        acc.nonNestedSelect.push(key);
      }
      return acc;
    },
    {
      nonNestedSelect: [],
      nestedSelect: [],
    },
  );

  if (!nonNestedSelect.length || !nestedSelect.length) {
    return select;
  }

  const keysToDelete = _.reduce(
    nonNestedSelect,
    function (acc, nonNestedKey) {
      const nestedKey = nestedSelect.find(
        (nestedKey) =>
          nestedKey.startsWith(nonNestedKey) &&
          nestedKey[nonNestedKey.length] === '.',
      );
      if (nestedKey) acc.push(nonNestedKey);
      return acc;
    },
    [],
  );

  const collectionName = model.collection && model.collection.collectionName;
  keysToDelete.forEach((key) => {
    console.warn(
      `[fortune::mongodb-adapter] Useless "${key}" select key required for model ${collectionName}.`,
    );

    if (isSelectArray) {
      select = _.filter(select, (el) => el !== key);
    } else {
      delete select[key];
    }
  });

  return select;
}

module.exports._helpers = {
  removeUselessProjectionSelect,
};
