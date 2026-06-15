const _ = require('lodash');

const hooks = [
  {
    name: 'removeDeleted',
    init: function () {
      return function (req) {
        const _this = this;

        if (this._internal) {
          if (req.query.includeDeleted && this._internal.deleted) {
            for (const [fieldName, deletedDocs] of Object.entries(
              this._internal.deleted,
            )) {
              if (_this[fieldName]) {
                _this[fieldName] = _this[fieldName].concat(deletedDocs);
              }
            }
          }
          delete this._internal;
        }
        return this;
      };
    },
  },
];

exports.setup = function (app, resource) {
  resource.schema._internal = {};
  for (const [key, value] of Object.entries(resource.schema)) {
    if (_.isArray(value) && _.isObject(value[0]) && !_.has(value[0], 'ref')) {
      const internalArray = { deleted: {} };
      internalArray.deleted[key] = [_.extend(value[0], { deletedAt: Date })];
      _.extend(resource.schema._internal, internalArray);
    }
  }
  app.afterRead(hooks);
  app.afterWrite(hooks);
};

exports.hooks = hooks;
