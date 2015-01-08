var lastModified = require('./last-modified');
var websockets = require('./websockets');
var swagger = require('./swagger');


exports.init = function(app, resource){
  lastModified.setup(app, resource);
  websockets.setup(app, resource);
  swagger.setup(app, resource);
};
