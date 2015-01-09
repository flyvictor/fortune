var _ = require('lodash');
var fs = require('fs');
var CodeGen = require('swagger-js-codegen').CodeGen;

var app;

var hooks = [
  {
    name: 'swaggerMetadata',
    init: function(){
      return function(req, res) {console.log(_.extend({}, []));
        if (req.query.format == 'swagger') {
          console.log('swagger request detected');
          var metadata = generateSwaggerMetadata();
          console.log('swagger metadata generated successfully');
          res.send(200, metadata);
          return false;
        } else {
          return this;
        }
      }
    }
  }
];

exports.setup = function(application, resource){
  console.log('Setting up the swagger plugin ...');
  app = application;
  app.beforeAllRead(hooks);
  console.log('Swagger plugin setup');
};

exports.hooks = hooks;

var generateSwaggerMetadata = function() {
  console.log('generating swagger metadata ...');
  var metadata = initMetadata();
  populateMetadata(metadata);
  return metadata;
};

var initMetadata = function() {
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

var populateMetadata = function(metadata) {
  // filter the resources to get only the information needed by swagger
  var models = _.reduce(app._resources, function(result, model, key) {
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