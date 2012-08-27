// Generated by CoffeeScript 1.3.3
(function() {
  var Connection, Helper, async, connectToRedis, _,
    __slice = [].slice;

  _ = require("underscore");

  async = require("async");

  exports.connect = function(options) {
    return new exports.Connection(options || {});
  };

  Connection = (function() {

    function Connection(options) {
      this.helper = new Helper;
      this.redis = options.redis || connectToRedis(options);
      this.namespace = options.namespace || 'flo';
      this.mincomplete = options.mincomplete || 1;
      if (options.database != null) {
        this.redis.select(options.database);
      }
    }

    Connection.prototype.prefixes_for_phrase = function(phrase) {
      var words,
        _this = this;
      words = this.helper.normalize(phrase).split(' ');
      return _.uniq(_.flatten(_.map(words, function(w) {
        var _i, _ref, _ref1, _results;
        return _.map((function() {
          _results = [];
          for (var _i = _ref = _this.mincomplete - 1, _ref1 = w.length - 1; _ref <= _ref1 ? _i <= _ref1 : _i >= _ref1; _ref <= _ref1 ? _i++ : _i--){ _results.push(_i); }
          return _results;
        }).apply(this), function(l) {
          return w.slice(0, l + 1 || 9e9);
        });
      })));
    };

    Connection.prototype.search_term = function() {
      var args, callback, limit, phrase, types,
        _this = this;
      types = arguments[0], phrase = arguments[1], args = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      if (typeof args[0] === 'number') {
        limit = args[0];
      } else {
        limit = 5;
      }
      callback = args[args.length - 1];
      return async.map(types, function(type, callb) {
        var cachekey, words;
        words = _.uniq(_this.helper.normalize(phrase).split(' ')).sort();
        cachekey = _this.key(type, "cache", words.join('|'));
        return async.waterfall([
          (function(cb) {
            return _this.redis.exists(cachekey, cb);
          }), (function(exists, cb) {
            var interkeys, _ref;
            if (!exists) {
              interkeys = _.map(words, function(w) {
                return _this.key(type, "index", w);
              });
              return (_ref = _this.redis).zinterstore.apply(_ref, [cachekey, interkeys.length].concat(__slice.call(interkeys), [function(err, count) {
                return _this.redis.expire(cachekey, 10 * 60, function() {
                  return cb();
                });
              }]));
            } else {
              return cb();
            }
          }), (function(cb) {
            return _this.redis.zrevrange(cachekey, 0, limit - 1, function(err, ids) {
              var _ref;
              if (ids.length > 0) {
                return (_ref = _this.redis).hmget.apply(_ref, [_this.key(type, "data")].concat(__slice.call(ids), [cb]));
              } else {
                return cb(null, []);
              }
            });
          })
        ], function(err, results) {
          var data;
          data = {};
          data[type] = results;
          return callb(err, data);
        });
      }, function(err, results) {
        results = _.extend.apply(_, results);
        results.term = phrase;
        return callback(err, results);
      });
    };

    Connection.prototype.add_term = function() {
      var args, callback, data, id, score, term, type,
        _this = this;
      type = arguments[0], id = arguments[1], term = arguments[2], score = arguments[3], args = 5 <= arguments.length ? __slice.call(arguments, 4) : [];
      if (typeof args[0] !== 'function') {
        data = args[0];
        callback = args[args.length - 1];
      } else if (typeof args[0] === 'function') {
        callback = args[0];
      }
      return async.parallel([
        (function(callb) {
          return _this.redis.hset(_this.key(type, "data"), id, JSON.stringify({
            id: id,
            term: term,
            score: score,
            data: data || []
          }), function() {
            return callb();
          });
        }), (function(callb) {
          return async.forEach(_this.prefixes_for_phrase(term), (function(w, cb) {
            return _this.redis.zadd(_this.key(type, "index", w), score, id, function() {
              return cb();
            });
          }), function() {
            return callb();
          });
        }), (function(callb) {
          return _this.redis.set(_this.key(type, term), id, function() {
            return callb();
          });
        })
      ], function() {
        if (callback != null) {
          return callback();
        }
      });
    };

    Connection.prototype.remove_term = function(type, id, callback) {
      var _this = this;
      return this.redis.hget(this.key(type, "data"), id, function(err, result) {
        var term;
        if (err) {
          return callback(err);
        }
        term = JSON.parse(result).term;
        return async.parallel([
          (function(callb) {
            return _this.redis.hdel(_this.key(type, "data"), id, callb);
          }), (function(callb) {
            return async.forEach(_this.prefixes_for_phrase(term), (function(w, cb) {
              return _this.redis.zrem(_this.key(type, "index", w), id, function() {
                return cb();
              });
            }), callb);
          }), (function(callb) {
            return _this.redis.del(_this.key(type, term), callb);
          })
        ], function() {
          if (callback != null) {
            return callback();
          }
        });
      });
    };

    Connection.prototype.get_id = function(type, term, callback) {
      return this.redis.get(this.key(type, term), callback);
    };

    Connection.prototype.redis = function() {
      return this.redis;
    };

    Connection.prototype.end = function() {
      return this.redis.quit();
    };

    Connection.prototype.key = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      args.unshift(this.namespace);
      return args.join(":");
    };

    return Connection;

  })();

  Helper = (function() {

    function Helper() {}

    Helper.prototype.normalize = function(term) {
      return this.strip(this.gsub(term.toLowerCase(), /[^a-z0-9 ]/i, ''));
    };

    Helper.prototype.gsub = function(source, pattern, replacement) {
      var match, result;
      if (!((pattern != null) && (replacement != null))) {
        return source;
      }
      result = '';
      while (source.length > 0) {
        if ((match = source.match(pattern))) {
          result += source.slice(0, match.index);
          result += replacement;
          source = source.slice(match.index + match[0].length);
        } else {
          result += source;
          source = '';
        }
      }
      return result;
    };

    Helper.prototype.strip = function(source) {
      return source.replace(/^\s+/, '').replace(/\s+$/, '');
    };

    return Helper;

  })();

  connectToRedis = function(options) {
    var redis;
    redis = require('redis').createClient(options.port, options.host);
    if (options.password != null) {
      redis.auth(options.password);
    }
    return redis;
  };

  exports.Helper = new Helper;

  exports.Connection = Connection;

}).call(this);
