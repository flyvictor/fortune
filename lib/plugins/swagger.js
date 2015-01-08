var _ = require('lodash');

var hooks = [
  {
    name: 'swaggerMetadata',
    init: function(){
      return function(req, res){
        res.send(200, {'swagger': 'test'});
        return false;
      }
    }
  }
];

exports.setup = function(app, resource){
  app.beforeAll(hooks);
};

exports.hooks = hooks;
