var _ = require('lodash');

/**
 * This module is resposable of creating the swagger metadata.
 */
function Swagger() {
}

/**
 * Given the application resources and the current request, this method look for
 * the swagger metadata trigger (format=swagger) and if it finds it generates and
 * returns the swagger metadata, else it returns false.
 */
Swagger.prototype.generateSwaggerMetadata = function(resources, req) {
  if (req.query.format == 'swagger') {
    console.log('swagger request detected');
    console.log('generating swagger metadata ...');
    var metadata = this._initMetadata();
    this._populateMetadata(metadata, resources);
    console.log('swagger metadata generated successfully');
    return metadata;
  } else {
    return false;
  }
};

Swagger.prototype._initMetadata = function() {
  return {
    apiVersion: '',
    apis: [],
    basePath: '',
    models: {},
    produces: ['application/json'],
    resourcePath: '',
    swaggerVersion: '1.2'
  }
};

Swagger.prototype._populateMetadata = function(metadata, resources) {
  // filter the resources to get only the information needed by swagger
  var models = _.reduce(resources, function(result, model, key) {
    //filter the resource schema an generate swagger model properties
    var properties = _.reduce(model.schema, function(fields, field, fieldName) {
      if (_.isArray(field)) { // the resource field is an array of an another resource
        fields[fieldName] = {
          items: {
            $ref: field[0].ref
          },
          type: 'array'
        };
      } else if (field.ref) { // the resource field is reference to another resource
        fields[fieldName] = {
          $ref: field.ref
        };
      } else { // the resource field is a primitive field
        var vIsFunction = _.isFunction(field),
        typeFn = vIsFunction ? field : field.type;

        if(typeFn){
          typeFn = typeFn.toString();
          typeFn = typeFn.substr('function '.length);
          typeFn = typeFn.substr(0, typeFn.indexOf('('));
        }
        fields[fieldName] = {
          type: typeFn
        };
        // add a description if it exists
        if (field['docs:description']) {
          fields[fieldName].description = field['docs:description'];
        }
      }
      return fields;
    }, {});
    result[key] = {
      id: key,
      properties: properties
    };
    // the resource pk is a required field
    if (model.modelOptions && model.modelOptions.pk) {
      result[key].required = [model.modelOptions.pk];
    }
    return result;
  }, {});

  metadata.models = models;
};

exports = module.exports = Swagger;