(function () {

    'use strict';

    var util = require('util');

    var cradle = require('cradle');
    var _ = require('lodash');
    var RSVP = require('rsvp');
    var Promise = RSVP.Promise;

    var adapter = {};

    adapter._init = function (options) {

        var opt = _.defaults(options, {
            db: 'test',
            host: 'localhost',
            port: 5984
        });

        var connectionString = util.format('http://%s', opt.host);

        var connection = new(cradle.Connection)(connectionString, opt.port, {
            cache: true,
            raw: false,
            forceSave: true
        });

        this.db = connection.database(options.database);
        
    };

    adapter.find = function (model, query, projection) {
        var db = this.db;
        return new Promise(function (resolve, reject) {
            db.get(query, function (err, doc) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(doc);
                }
            });
        });
    };

    adapter.findMany = function (model, query, projection) {

    };

    adapter.create = function (model, id, resource) {
        var db = this.db;

        if (!resource) {
          resource = id;
          id = model;
        }
        
        return new Promise(function (resolve, reject) {
            db.save(id, resource, function (err, doc) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(doc);
                }
            });
        });
    };

    adapter.awaitConnection = function () {
        var db = this.db;
        return Promise(function(resolve, reject) {
            db.exist(function(err, doesExist) {
                if (doesExist) {
                    resolve();
                } else {
                    db.create(function(err) {
                        if (err) {
                            reject(err)
                        } else {
                            resolve();
                        }
                    });
                }
            });
        });
    };

    module.exports = adapter;

    adapter._init({});


}())