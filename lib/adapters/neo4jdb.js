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

adapter._init = function(options) {
	/* This should handle the connection to the Neo4J Db */
	/* this is for test only */
	console.log("In Neo4J init");
	var connectionString = "http://localhost:7474");
	this.db = new neo4j(connectionString);
};

adapter.model = function(name, schema, options) {

};

adapter.schema = function(name, schema, options, schemaCallback) {

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
