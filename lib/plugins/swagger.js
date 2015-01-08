var _ = require('lodash');
var fs = require('fs');
var CodeGen = require('swagger-js-codegen').CodeGen;

var hooks = [
  {
    name: 'swaggerMetadata',
    init: function(){
      return function(req, res){
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

exports.setup = function(app, resource){
  console.log('Setting up the swagger plugin ...');
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
  // TODO loop through all the resources and for each resource generate two entries in the metadata.apis
  // 1- The first entry contains 2 operations /resource GET & /resource POST
  // 2- The second entry contains 4 operations /resource/:id GET, PUT, DELETE & PATCH
  // After that generate a new entry foreach link

  // While looping through the resources generate also the metadata.models which is similar to the /resources route
};