const _ = require('lodash');
const crypto = require('crypto');
const customTypeUtils = require('./custom-types');

/**
 * Applies all registered ALL hooks to provided resource.
 * All hooks enabled by default.
 * You can disable specific hook in resource definition.
 * @param resource - resource configuration object
 * @param fortuneConfig - fortune configuration object
 */
exports.initGlobalHooks = function(resource, globalHooks, fortuneConfig){
  resource.hooks = resource.hooks || {};
  //Iterates before and after hooks
  _.each(globalHooks, function(timeHooks, when){
    const stageHook = resource.hooks[when] = resource.hooks[when] || {};
    //Iterates read and write hooks
    _.each(timeHooks, function(typeHooks, type){
      const typeHook = stageHook[type] = stageHook[type] || [];
      //Iterates over registered hooks scoped to before/after, read/write
      _.each(_.sortBy(typeHooks, function(i){return i.constructor.priority;}), function(hook){
        const hookConfig = getHookConfig(hook.constructor, resource, hook.inlineConfig);
        if (!hookConfig.disable) {
          const fn = hook.constructor.init(hookConfig, fortuneConfig);
          //fn._priority = hook.constructor.priority || 0;
          typeHook.unshift({
            name: hook.constructor.name,
            _priority: hook.constructor.priority || 0,
            fn: fn,
            options: hookConfig,
          });
        }
      });
    });
  });
};

exports.addHook = function (name, hooks, stage, type, inlineConfig) {
  const _this = this;

  if (typeof name === 'function') {
    hooks = name;
    name = this._resource;
  }

  name.split(' ').forEach(function (resourceName) {
    hooks = normalize(hooks);

    let resource;
    if (!_this._resources || !_this._resources[resourceName]) {
      if (!_this._customTypes || !_this._customTypes[resourceName]) {
        return console.warn(
          'You are trying to attach a hook to %s, ' +
            'that is not defined in this instance of fortune',
          resourceName,
        );
      } else resource = _this._customTypes[resourceName];
    } else resource = _this._resources[resourceName];

    resource.hooks = resource.hooks || {};
    resource.hooks[stage] = resource.hooks[stage] || {};
    resource.hooks[stage][type] = resource.hooks[stage][type] || [];
    _.each(hooks, function (hook) {
      const hookOptions = getHookConfig(hook, resource, inlineConfig);
      const fn = hook.init(hookOptions, _this);
      resource.hooks[stage][type].push(
        _.extend(
          {
            _priority: hook.priority || 0,
            name: hook.name,
            options: hookOptions,
          },
          { fn: fn },
        ),
      );
    });
    resource.hooks[stage][type] = _.sortBy(
      resource.hooks[stage][type],
      function (h) {
        return -h._priority;
      },
    );
  });
};

/**
 * Merge multiple hookset collected from resources, customTypes, etc
 * @param hookSet -
 */
exports.merge = function (hookset) {
  const isArray = _.some(hookset, function (arg) {
    return _.isArray(arg);
  });
  if (isArray) {
    return _.reduce(
      hookset,
      function (result, value, key) {
        return result.concat(value || []);
      },
      [],
    );
  }

  const keys = _.uniq(
    _.flatten(
      _.map(hookset, function (arg) {
        return _.keys(arg);
      }),
    ),
  );

  return _.fromPairs(
    _.map(keys, function (key) {
      return [
        key,
        exports.merge(
          _.compact(
            _.map(hookset, function (arg) {
              return arg[key];
            }),
          ),
          1,
        ),
      ];
    }),
  );
};

/* Collect hooks provided with custom types
 * and convert them to a resource-wide hooks
 * @param customTypes - a map with field names => custom types for particular resource
 */
exports.fromCustomTypesMap = function (customTypes) {
  return customTypes.map(function (type) {
    const result = _.cloneDeep(type.hooks);
    _.each(result, function (whenHooks, when) {
      _.each(whenHooks, function (actionHooks, action) {
        _.each(actionHooks, function (ahook) {
          if (ahook.name) {
            ahook.name = [type.typeId, ahook.name, type.path].join('-');
          }

          // Bind the handler to particular data type
          const handler = ahook.fn;

          if (handler) {
            ahook.fn = function (req, res) {
              const doc = this;
              return customTypeUtils
                .applyHook(handler, type.path, doc, req, res)
                .then(function () {
                  return doc;
                });
            };
          }
        });
      });
    });
    return result;
  });
};

/**
 *
 * @param hook - normalized hook constructor
 * @param resource - resource object
 * @param inlineConfig - object that is passed along with hook
 */

function getHookConfig (hook, resource, inlineConfig) {
  let config = {};
  const inline = (inlineConfig || {})[hook.name] || {};
  const hookConfig = _.cloneDeep(hook.config) || {};
  if (resource.hooksOptions) {
    if (resource.hooksOptions[hook.name]) {
      config = _.extend(hookConfig, inline, resource.hooksOptions[hook.name]);
    } else {
      config = _.extend(hookConfig, inline);
    }
  } else {
    config = _.extend(hookConfig, inline);
  }
  return config;
};


/**
 * Backward compatibility method.
 * Accepts array or function and return array of constructor objects.
 * @param hookFunction
 * @returns {Array}
 */
function normalize(hookFunction) {
  if (!_.isArray(hookFunction)) {
    const tmp = {};
    if (_.isFunction(hookFunction)) {
      tmp.init = function () {
        return hookFunction;
      };
      //This name should be unique somehow O_o
      tmp.name = `generated_${crypto
        .createHash('md5')
        .update(hookFunction.toString())
        .digest('hex')}`;
      tmp.config = {};
    }
    return [tmp];
  } else {
    return hookFunction;
  }
}
