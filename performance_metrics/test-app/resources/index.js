'use strict';

exports.defineResources = function (app, deps) {
  require('./user')(app, deps);
  require('./pet-document')(app, deps);
  require('./pet')(app, deps);
};
