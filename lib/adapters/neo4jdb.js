/***
   This is a Neo4J adaptor prototype for Fortune
   At the moment this is just a shell for the prototype 
*/
var neo4j = require('node-neo4j');
var RSVP = require('rsvp');
var _ = require('lodash');
var moment = require("moment");
var Promise = RSVP.Promise;
var adapter = {};

adapter._models = {};
adapter._schemas = {};

adapter._init = function(options) {
	/* This should handle the connection to the Neo4J Db */
	/* this is for test only */
	console.log("In Neo4J init");
	// Store options
	this._options = options;

};

adapter.model = function(name, schema, options) {

	if(schema) {

		// Actually set up a database
		var connectionString = "http://localhost:7474";
		var db = new neo4j(connectionString);


		_.extend(db,options);
		// Store the model name in a private key
		db._name = name;

		this._models[name] = db;
		return db;
	} else {
		return this._models[name];
	}
};

adapter.schema = function(name, schema, options, schemaCallback) {
	_.each(schema, function(val, key) {
		var obj = {}
			, isArray = _.isArray(val)
			, value = isArray ? val[0] : val
			, isObject = _.isPlainObject(value)
			, ref = isObject ? value.ref : value
			, inverse = isObject ? value.inverse : undefined;

		// Convert string to association object
		if (typeof ref === 'string') {
			obj.ref = ref;
			obj.inverse = inverse;
			schema[key] = isArray ? [obj] : obj;
		}

		// Wrap native type in object
		if (typeof value === 'function') {
			schema[key] = isArray ? [{type: schema[key]}] : {type: schema[key]};
		}

	});
	this._schemas[name] = schema;
	return schema;
};

adapter.create = function(model, id, resource) {

};

adapter.update = function(model, id, update) {

}

adapter.delete = function(model, id) {

};

adapter.find = function(model, query, projection) {

};

module.exports = adapter;
