/* RESOURCE ACTION MODULE */

'use strict';

const _ = require('lodash');

/**
	Our main Action module. We export this.
*/
function Actions() {
  //Our "que" of actions. We store all the stuff here
  this._actions = {};
}

Actions.prototype.registerAction = registerAction;
Actions.prototype.handleAction = handleAction;
Actions.prototype.getAction = getAction;

/**
 * Looks up for registered action on provided resource and returns action metadata
 */
function getAction(resourceName, actionName) {
  //get all actions for resource
  return this._actions[resourceName] && this._actions[resourceName][actionName];
}

/**
	This method registers a new action

	@param resourceName string The name of the resource to attach the action to
	@param actions object the object of actions containing our callback function to execute

 Actions are defined on resources with objects like
 		actions: {
			action: {
				init: function(options){
					return function(req, res){}
				}
			},

			anotherAction: {
				init: function(options){
					return function(req, res){}
				}
			}
		}
*/
function registerAction(resourceName, actions) {
  const that = this;
  for (const [key, value] of Object.entries(actions || {})) {
    that._actions[resourceName] = that._actions[resourceName] || {};
    that._actions[resourceName][key] = _.extend(value, {
      callback: value.init(value.config),
    });
  }
}

/**
	This method handles our action call. This is what we execute as part of our middleware logic.

	@params params object Contains our resource name, action name, resource ID, raw request object
	@params cb function Our callback function
*/
function handleAction(params, req, res, adapter) {
  /*
		get the resource name
		get the action name
		execute the action callback passing it the request, response and current document
	*/

  const action = this._actions[params.resource][params.action];
  const callback = action.callback;

  if (action.adapter_binding) {
    return adapter[action.adapter_binding](params.resource, action);
  }
  return Promise.resolve(callback.call(params.doc, req, res));
}

module.exports = function () {
  return new Actions();
};
