(function (factory) {
  var root = (typeof self == 'object' && self.self === self && self) ||
            (typeof global == 'object' && global.global === global && global);

  // amd
  if (typeof define === 'function' && define.amd) {
    define(['underscore', 'jquery', 'exports'], function (_, $, exports) {
      root.Backbone = factory(root, exports, _, $);
    });

  // Node.js or CommonJS
  } else if (typeof exports !== 'undefined') {
    var _ = require('underscore'), $;
    try { $ = require('jquery'); } catch (e) {}
    factory(root, exports, _, $);
  } else {
    root.Backbone = factory(root, {}, root._, (root.jQuery || root.Zepto || root.ender || root.$));
  }

}(function (root, Backbone, _, $) {

  // Initial Setup
  // -------------

  var previousBackbone = root.Backbone;

  Backbone.noConflict = function () {
    root.Backbone = previousBackbone;
    return this;
  };

  var slice = Array.prototype.slice;

  Backbone.VERSION = '1.3.3';

  Backbone.$ = $;

  Backbone.emulateHTTP = false;

  Backbone.emulateJSON = false;

  // 把Underscore方法加到Model或Collection上,分别以attributes属性和models属性作为
  // 上下文,如
  // model.keys();
  // collection.filter(function(model) { return model.get('age') > 10 });
  var addMethod = function (length, method, attribute) {
    switch (length) {
      case 1: return function () {
        return _[method](this[attribute]);
      };
      case 2: return function (value) {
        return _[method](this[attribute], value);
      };
      case 3: return function (iteratee, context) {
        return _[method](this[attribute], cb(iteratee, this), context);
      };
      case 4: return function (iteratee, defaultVal, context) {
        return _[method](this[attribute], cb(iteratee, this), defaultVal, context);
      };
      default: return function () {
        var args = slice.call(arguments);
        args.unshift(this[attribute]);
        return _[method].apply(_, args);
      };
    }
  };
  // @param {Object} Class Model或Collection
  // @param {Object} methods 需要添加的方法和参数数量的哈希
  // @param {String} attribute 作为上下文的属性名(Model的attributes或Collection的
  // models)
  var addUnderscoreMethods = function (Class, methods, attribute) {
    _.each(methods, function (length, method) {
      if (_[method]) Class.prototype[method] = addMethod(length, method, attribute);
    });
  };

  var cb = function (iteratee, instance) {
    if (_.isFunction(iteratee)) return iteratee;
    // 传入一个对象(模型的属性)用于搜索匹配的model
    if (_.isObject(iteratee) && !instance._isModel(iteratee)) return modelMatcher(iteratee);
    // 传入一个字符串(属性名),返回指定的属性
    if (_.isString(iteratee)) return function (model) { return model.get(iteratee); };
    return iteratee;
  };

  var modelMatcher = function (attrs) {
    var matcher = _.matches(attrs);
    return function (model) {
      return matcher(model.attributes);
    };
  };


  // Backbone.Events
  // ---------------

  // 可以被混入任何对象，给对象提供事件功能
  var Events = Backbone.Events = {};

  // 用于分割事件名
  var eventSplitter = /\s+/;

  /**
   * 这个函数处理一下name参数,
   * 使events api能处理标准形式的'event, callback',
   * 或多个空格分割的'"change blur", callback',
   * 或jQuery形式的'{event: callback}'.
   *
   * @param {Function} iteratee api函数
   * @param {Object} events 对象上的事件,形如
   *     {eventName: [{callback: .., context: .., ctx: .., listening: ..}]}
   * @param {String|Object} name 事件名称,三种形式如上所述,还可以是'all'
   * @param {Function} callback 事件处理函数
   * @param {Object|Array} opts 附加的参数,
   *     如OnApi中,是一个对象,包括事件处理函数的执行上下文context,
   *     调用api的上下文ctx(调用事件api的对象),当前观察记录listening
   *     triggerApi中是一个数组,存放调用trigger方法时附加的参数
   */
  var eventsApi = function (iteratee, events, name, callback, opts) {
    var i = 0, names;
    if (name && typeof name === 'object') {
      // 第三种情况
      if (callback !== void 0 && 'context' in opts && opts.context === void 0)
        opts.context = callback;
      for (names = _.keys(name); i < names.length; i++) {
        events = eventsApi(iteratee, events, names[i], name[names[i]], opts);
      }
    } else if (name && eventSplitter.test(name)) {
      // 第二种情况
      for (names = name.split(eventSplitter); i < names.length; i++) {
        events = iteratee(events, names[i], callback, opts);
      }
    } else {
      // 第一种情况
      events = iteratee(events, name, callback, opts);
    }
    return events;
  };

  // name还可以是'all',obj上的所有事件都触发该回调
  Events.on = function (name, callback, context) {
    return internalOn(this, name, callback, context);
  };

  var internalOn = function (obj, name, callback, context, listening) {
    // obj还没有监听事件的时候，在这里就给obj._events初始化成{}了
    // 经由events api处理过后的events再赋值给_events
    obj._events = eventsApi(onApi, obj._events || {}, name, callback, {
      context: context,
      ctx: obj,
      listening: listening
    });

    // listenTo的情况(其它对象调用.listenTo监听obj上的事件),在obj上用一个
    // _listeners属性记录下listener
    if (listening) {
      var listeners = obj._listeners || (obj._listeners = {});
      listeners[listening.id] = listening;
    }

    return obj;
  };

  var onApi = function (events, name, callback, options) {
    if (callback) {
      // 获取对应事件的处理对象数组,没有就新建
      var handlers = events[name] || (events[name] = []);
      var context = options.context, ctx = options.ctx, listening = options.listening;
      if (listening) listening.count++;

      // 处理对象不光有callback,还有callback的上下文context,对象自身的引用ctx
      // 对象的观察记录
      handlers.push({
        callback: callback,
        context: context,
        ctx: context || ctx,
        listening: listening
      });
    }
    return events;
  };

  // 让'this'监听'obj'上的事件
  Events.listenTo = function (obj, name, callback) {
    if (!obj) return this;
    // 每个对象都放个_listenId属性,专用于listener和listeningTo的记录
    var id = obj._listenId || (obj._listenId = _.uniqueId('l'));
    var listeningTo = this._listeningTo || (this._listeningTo = {});
    var listening = listeningTo[id];

    // 如果还没有监听该对象上的任何事件,要做一些初始化工作
    // 首先,如果自己还没有_listenId,要分配一个
    // 然后,自己的_listeningTo属性上要做记录
    if (!listening) {
      var thisId = this._listenId || (this._listenId = _.uniqueId('l'));
      listening = listeningTo[id] = {
        obj: obj,
        objId: id,
        id: thisId,
        // 这里把_listeningTo的引用也存进去,方便移除时把这整条记录删掉
        listeningTo: listeningTo,
        count: 0
      };
    }

    // 还是internalOn的逻辑,context设成自己
    internalOn(obj, name, callback, this, listening);
    return this;
  };

  // 移除一个或多个监听函数
  // 因为有listenTo的情况,这里传了个context,可以用于移除'context'对象
  // 对'this'上某事件的监听
  // 如果不传入context,移除所有'callback'函数
  // 如果也不传入callback,移除'name'事件的所有监听函数
  // 如果也不传入name,移除对象上的所有事件监听函数
  Events.off = function (name, callback, context) {
    if (!this._events) return this;
    this._events = eventsApi(offApi, this._events, name, callback, {
      context: context,
      listeners: this._listeners
    });
    return this;
  };

  var offApi = function (events, name, callback, options) {
    if (!events) return;

    var i = 0, listening;
    var context = options.context, listeners = options.listeners;

    // 移除对象上所有事件的情况
    if (!name && !callback && !context) {
      // 先把_listeners和它们的_listenTo的记录删掉
      var ids = _.keys(listeners);
      for (; i < ids.length; i++) {
        listening = listeners[ids[i]];
        // 自己的_listeners属性中删掉相应的listener
        delete listeners[listening.id];
        // listener的_listeningTo属性中删掉和自己相关的这条记录
        delete listening.listeningTo[listening.objId];
      }
      // 然后返回undefined,这样'this'上events都没了
      // (209行this._events等于这里的返回值)
      return;
    }

    // 给没给name后面逻辑都一样了
    var names = name ? [name] : _.keys(events);
    for (; i < names.length; i++) {
      name = names[i];
      var handlers = events[name];

      if (!handlers) break;

      // 遍历handlers,不是要移除的放进remaining里面
      var remaining = [], len = handlers.length;
      for (var j = 0; j < len; j++) {
        var handler = handlers[j];
        // 指定了callback而callback不匹配
        // 或者指定了context而context不匹配的就是要留下的
        // 逻辑很强悍,一举搞定了off传参剩下几种情况
        if (
          callback && callback !== handler.callback &&
            callback !== handler.callback._callback || // _callback, 见once
              context && context !== handler.context
        ) {
          remaining.push(handler);
        } else {
          // 要移除的话,就把listeners和listeningTo相关记录删掉
          listening = handler.listening;
          // 如果某对象不再listeningTo'this',那么'this'上的_listeners和
          // 该对象的_listeningTo属性中的记录都要删掉
          if (listening && --listening.count === 0) {
            delete listeners[listening.id];
            delete listening.listeningTo[listening.objId];
          }
        }
      }

      // 直接修改events等于remaining,或者删掉整个'name'属性
      if (remaining.length) {
        events[name] = remaining;
      } else {
        delete events[name];
      }
    }
    return events;
  };

  Events.stopListening = function (obj, name, callback) {
    var listeningTo = this._listeningTo;
    if (!listeningTo) return this;

    // 没指定obj,就stop所有
    var ids = obj ? [obj._listenId] : _.keys(listeningTo);
    for (var i = 0; i < ids.length; i++) {
      var listening = listeningTo[ids[i]];

      // 这是传入了obj然而并没有listeningTo obj的情况
      // 不用off了,提前结束这(唯一一)次循环
      if (!listening) break;
      listening.obj.off(name, callback, this);
    }

    return this;
  };

  Events.once = function (name, callback, context) {
    // onceMap把name映射成{event: _.once(callback)}形式
    var events = eventsApi(onceMap, {}, name, callback, _.bind(this.off, this));
    // 一定要传入context?
    if (typeof name === 'string' && context == null) callback = void 0;
    return this.on(events, callback, context);
  };

  var onceMap = function (map, name, callback, offer) {
    if (callback) {
      // _.once确保map[name]只会被调用一次
      var once = map[name] = _.once(function () {
        // 解绑事件
        offer(name, once);
        callback.apply(this, arguments);
      });
      // 非once的原始版本callback也要存下来,用户可能调用off(当然以callback为参数)
      // 移除这个once回调
      once._callback = callback;
    }
    return map;
  };

  Events.listenToOnce = function (obj, name, callback) {
    var events = eventsApi(onceMap, {}, name, callback, _.bind(this.stopListening, this, obj));
    return this.listenTo(obj, events);
  };

  // 触发'name'事件，可以附加参数
  Events.trigger = function (name) {
    if (!this._events) return this;

    var length = Math.max(0, arguments.length - 1);
    var args = Array(length);
    for (var i = 0; i < length; i++) args[i] = arguments[i + 1];

    eventsApi(triggerApi, this._events, name, void 0, args);
    return this;
  };

  var triggerApi = function (objEvents, name, callback, args) {
    if (objEvents) {
      var events = objEvents[name];
      var allEvents = objEvents.all; // ?
      if (events && allEvents) allEvents = allEvents.slice();
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, [name].concat(args));
    }
    return objEvents;
  };

  var triggerEvents = function (events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args); return;
    }
  };

  Events.bind = Events.on;
  Events.unbind = Events.off;

  _.extend(Backbone, Events);


  // Backbone.Model
  // ==============

  // 创建一个模型,会自动分配一个client id('cid')
  var Model = Backbone.Model = function (attributes, options) {
    var attrs = attributes || {};
    options || (options = {});
    this.preinitialize.apply(this, arguments);
    this.cid = _.uniqueId(this.cidPrefix);
    this.attributes = {};
    if (options.collection) this.collection = options.collection;
    if (options.parse) attrs = this.parse(attrs, options) || {};
    // 返回this[defaults]
    var defaults = _.result(this, 'defaults');
    // extend先添加默认属性、传进来的属性,为防止传进来的attrs将某些应该是
    // 默认的属性覆盖成undefined,于是又调用_.defaults填充undefined属性,
    // 那为什么不_.defaults({}, attrs, defaults)?
    attrs = _.defaults(_.extend({}, defaults, attrs), defaults);
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  _.extend(Model.prototype, Events, {

    // 一组属性的哈希(current和previous(上一次change事件发生时的属性)不同)
    changed: null,

    // 上一次验证失败返回的值
    validationError: null,

    // 表示(服务器端)id的属性名,可自行指定
    idAttribute: 'id',

    // 生成client id时的前缀
    cidPrefix: 'c',

    // 模型初始化之前调用
    preinitialize: function () {},

    initialize: function () {},

    // 返回attributes的一份浅拷贝
    toJSON: function (options) {
      return _.clone(this.attributes);
    },

    // proxy 'Backbone.sync'
    sync: function () {
      return Backbone.sync.apply(this, arguments);
    },

    // 获取属性值
    get: function (attr) {
      return this.attributes[attr];
    },

    // 获取HTML转义的属性值
    escape: function (attr) {
      return _.escape(this.get(attr));
    },

    // 判断是否含有某个属性(不为null或undefined)
    has: function (attr) {
      return this.get(attr) != null;
    },

    // 判断模型属性是否与给定attrs匹配
    matches: function (attrs) {
      return !!_.iteratee(attrs, this)(this.attributes);
    },

    // model的核心方法,设置属性并触发'change',通知观察者
    // 可以set(key, value, options),也可以set({key: value}, options)
    set: function (key, val, options) {
      if (key == null) return this;

      var attrs;
      // {key: value}形式
      if (typeof key === 'obj') {
        attrs = key;
        options = val;
      // key, value形式
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // 验证
      if (!this._validate(attrs, options)) return false;

      // 是否是 删除属性(unset方法的逻辑也在这个函数里)
      var unset = options.unset;
      // 是否发出change事件
      var silent = options.silent;
      // 方便触发事件的时候使用
      var changes = [];
      // _changing为false是什么情况?
      var changing = this._changing;
      this._changing = true;

      // 不是changing状态,那就开始change,previous属性设为当前属性,
      // changed属性初始化
      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        // 跟previous相比change的属性
        this.changed = {};
      }

      var current = this.attributes;
      var changed = this.changed;
      var prev = this._previousAttributes;

      for (var attr in attrs) {
        val = attrs[attr];
        // 变化的属性存在changes里面,方便下面触发change事件时作为参数
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        // changed存放变化的属性,如果本次和上次相等,那么从changed中删除该属性
        if (!_.isEqual(prev[attr], val)) {
          changed[attr] = val;
        } else {
          delete changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // 更新id(要单独处理,因为要通过idAttribute获取新id值)
      if (this.idAttribute in attrs) this.id = this.get(this.idAttribute);

      // 触发属性变化事件
      if (!silent) {
        // _pending: ??
        if (changes.length) this._pending = options;
        for (var i = 0; i < changes.length; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          options = this._pending;
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // 删除属性,触发'change'事件
    unset: function (attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // 删除所有属性,触发'change'事件
    clear: function (options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // 检查从上一次'change'事件以来,是否发生了改变
    // 可以检查特定属性
    hasChanged: function (attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // 返回一个包含了所有发生了改变的属性的对象,或者false(没有改变);
    // 还可以传入一个属性对象比较是否会发生改变
    changedAttributes: function (diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      var changed = {};
      var hasChanged;
      for (var attr in diff) {
        var val = diff[attr];
        if (_.isEqual(old[attr], val)) continue;
        changed[attr] = val;
        hasChanged = true;
      }
      return hasChanged ? changed : false;
    },

    // 获取之前的某属性值,即上一次'change'触发时记下的值
    previous: function (attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // 获取所有的上一次'change'发生时的原属性
    previousAttributes: function () {
      return _.clone(this._previousAttributes);
    },

    // 从服务器获取模型,合并response和本地的模型属性,任何发生改变的属性
    // 都会触发'change'事件
    // @param {Object} options 形如{success: .., error: .., context: .., parse: ..}
    fetch: function (options) {
      options = _.extend({parse: true}, options);
      var model = this;
      var success = options.success;
      options.success = function (resp) {
        var serverAttrs = options.parse ? model.parse(resp, options) : resp;
        if (!model.set(serverAttrs, options)) return false;
        if (success) success.call(options.context, model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      // ?
      return this.sync('read', this, options);
    },

    // 设置模型属性,并同步到服务器,如果服务器返回不一样的属性哈希,模型属性
    // 会再次被设定
    save: function (key, val, options) {
      var attrs;
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options = _.extend({validate: true, parse: true}, options);
      // wait: 可以指定是否等待服务端的返回结果再一次性更新model,默认情况下不等待
      var wait = options.wait;

      // 如果不等待,那直接set,出错返回
      // 如果等待,那先验证,出错返回
      if (attrs && !wait) {
        if (!this.set(attrs, options)) return false;
      } else if (!this._validate(attrs, options)) {
        return false;
      }

      var model = this;
      var success = options.success;
      var attributes = this.attributes;
      // 跟WrapError类似,把success包装一下,做一些额外的工作
      options.success = function (resp) {
        // 确保
        model.attributes = attributes;
        var serverAttrs = options.parse ? model.parse(resp, options) : resp;
        // 如果等待服务器返回,返回的属性也加入到要set的属性中
        if (wait) serverAttrs = _.extend({}, attrs, serverAttrs);
        // set属性,出错返回
        if (serverAttrs && !model.set(serverAttrs, options)) return false;
        if (success) success.call(options.context, model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      // 如果wait,this.attributes还未设好,但是下面要判断isNew,所以先直接
      // 改this.attributes,判断完isNew再改回来
      if (attrs && wait) this.attributes = _.extend({}, attributes, attrs);

      // 根据是不是新建的模型(服务器上还没有)、是否指定了patch选项,采用不同的
      // 同步方法：create/patch/update
      var method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch' && !options.attrs) options.attrs = attrs;
      var xhr = this.sync(method, this, options);

      // this.attributes改回来
      // 当然如果不wait,这俩是一样的
      this.attributes = attributes;

      return xhr;
    },

    // 如果服务器上存在model,从服务器上删除;如果模型属于某个集合,从集合中删除;
    // 如果设置了wait: true,等待服务器响应后再从集合中删除
    destroy: function (options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;
      var wait = options.wait;

      var destroy = function () {
        model.stopListening();
        model.trigger('destroy', model, model.collection, options);
      };

      // 跟WrapError类似,把success包装一下
      options.success = function (resp) {
        // 需要等待,在这个回调里destory(不需要等待的情况在#682进行了destroy)
        if (wait) destroy();
        if (success) success.call(options.context, model, resp, options);
        // 如果model不是首次存入服务器,触发'sync'事件
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      var xhr = false;
      // 服务器上还没有该model,当然成功了,异步执行success
      if (this.isNew()) {
        _.defer(options.success);
      // 否则,调用sync进行删除
      } else {
        wrapError(this, options);
        xhr = this.sync('delete', this, options);
      }
      // 不用等待,直接destroy
      if (!wait) destroy();
      return xhr;
    },

    // 默认的url,model在服务器上的标识
    url: function () {
      var base =
        _.result(this, 'urlRoot') ||
        _.result(this.collection, 'url') ||
        urlError();
      if (this.isNew()) return base;
      var id = this.get(this.idAttribute);
      return base.replace(/[^\/]$/, '$&/') + encodeURIComponent(id);
    },

    // 将resp解析成属性哈希,set时会调用,用户自行传入,默认情况只是简单返回resp
    parse: function (resp, options) {
      return resp;
    },

    clone: function () {
      return this.constructor(this.attributes);
    },

    // 所谓new就是模型还未被存入服务器,因而不会有服务器端id属性
    isNew: function () {
      return !this.has(this.idAttribute);
    },

    isValid: function (options) {
      return this._validate({}, _.extend({}, options, {validate: true}));
    },

    // 调用用户定义的validate方法进行验证
    _validate: function (attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
      return false;
    }

  });

  // Model要实现的Underscore方法,值是参数数量
  var modelMethods = {key: 1, values: 1, pairs: 1, invert: 1, pick: 0, omit: 0, chain: 1, isEmpty: 1};

  // 混入Underscore方法,以model的attributes属性作为上下文
  addUnderscoreMethods(Model, modelMethods, 'attributes');

  // 需要一个URL而未提供时,抛出一个错误
  var urlError = function () {
    throw new Error('A "url" property or function must be specified');
  };

  // 包装一下options中传入的error回调,使其调用的同时触发'error'事件
  var wrapError = function (model, options) {
    var error = options.error;
    options.error = function (resp) {
      if (error) error.call(options.context, model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };


  // Backbone.sync
  // ----------------------

  // 可以覆盖这个方法,改变Backbone保持model与server上一致的行为。方法可以接收
  // 三个参数:请求方法的类型,要同步的model和一些选项。默认行为是向model的url
  // (由模型上的url方法获取)发起一个RESTful Ajax请求。
  Backbone.sync = function (method, model, options) {
    var type = methodMap[method];

    // 两个emulate的默认设置
    _.defaults(options || (options ={}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    var params = {type: type, dataType: 'json'};

    // 确保有一个url
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // 确保create updata patch方法带数据
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // 对于不支持JSON的服务器,将数据存入params中,以表单形式提交
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // HTTP方法都识别不全的更老服务器...
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function (xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // jQuery的ajax配置选项processData:默认情况下,通过data选项传进来的数据,
    // 会处理转化成一个查询字符串。此处对于非GET方法且不需模拟JSON数据的情况,
    // 传的都是JSON数据,所以这个选项设为false
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // 给error回调传入xhr,表示请求状态的文本,请求抛出的错误三个参数
    var error = options.error;
    options.error = function (xhr, textStatus, errorThrown) {
      options.textStatus = textStatus;
      options.errorThrown = errorThrown;
      if (error) error.call(options.context, xhr, textStatus, errorThrown);
    };

    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  // restful方法名到HTTP方法的映射
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch': 'PATCH',
    'delete': 'DELETE',
    'read': 'GET'
  };

  // 默认用$库的ajax方法发送ajax
  Backbone.ajax = function () {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };
}));
