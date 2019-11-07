var lastModified = require('./last-modified');
var removeDeleted = require('./remove-deleted');

var plugins = [
  lastModified,
  removeDeleted
];

exports.init = function(app, resource){
  plugins.forEach(function(plugin){
    plugin.setup(app, resource);
  });
};

exports.add = function(plugin){
  plugins.push(plugin);
};