(function (factory) {
  var root = typeof self == 'object' && self.self === self && self ||
            typeof global == 'object' && global.global === global && global;

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

})(function (root, Backbone, _, $) {

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
    // 第三种情况
    if (name && typeof name === 'object') {
      // 这种情况还可以不指定callback,直接传入context,见test/events.js #99
      if (callback !== void 0 && 'context' in opts && opts.context === void 0)
        opts.context = callback;
      for (names = _.keys(name); i < names.length; i++) {
        events = eventsApi(iteratee, events, names[i], name[names[i]], opts);
      }
    // 第二种情况
    } else if (name && eventSplitter.test(name)) {
      for (names = name.split(eventSplitter); i < names.length; i++) {
        events = iteratee(events, names[i], callback, opts);
      }
    // 第一种情况
    } else {
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

    // 返回obj以链式调用
    return obj;
  };

  var onApi = function (events, name, callback, options) {
    if (callback) {
      // 获取对应事件的处理对象数组,没有就新建
      var handlers = events[name] || (events[name] = []);
      var context = options.context, ctx = options.ctx, listening = options.listening;
      if (listening) listening.count++;

      // 处理对象不光有callback,还有callback的上下文context和ctx,trigger时使用的
      // 都是ctx,即没有传入context的情况下用的上下文就是对象自身,还要另存一份context
      // 用于off时的比较
      // 另外还有对象的观察记录
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
      // 注册事件名为'all'的监听函数,不管name是什么都触发
      var allEvents = objEvents.all;
      if (events && allEvents) allEvents = allEvents.slice();
      if (events) triggerEvents(events, args);
      // 监听'all'的函数可以获取当前事件名作为第一个参数
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
      if (typeof key === 'object') {
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

  // Backbone.Collection
  // -------------------

  // 可以指定一个'comparator',用于Collection进行比较,维护model的顺序
  var Collection = Backbone.Collection = function (models, options) {
    options || (options = {});
    this.preinitialize.apply(this, arguments);
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // 默认选项
  var setOptions = {add: true, remove: true, merge: true};
  var addOptions = {add: true, remove: false};

  // 在数组'array'的'at'处插入'insert'数组
  var splice = function (array, insert, at) {
    at = Math.min(Math.max(at, 0), array.length);
    var tail = Array(array.length - at);
    var length = insert.length;
    var i;
    for (i = 0; i < tail.length; i++) tail[i] = array[i + at];
    for (i = 0; i < length; i++) array[i + at] = insert[i];
    for (i = 0; i < tail.length; i++) array[i + length + at] = tail[i];
  };

  _.extend(Collection.prototype, Events, {

    // 默认的model,大部分情况下应该覆盖
    model: Model,

    preinitialize: function () {},

    initialize: function () {},

    toJSON: function(options) {
      return this.map(function(model) { return model.toJSON(options); });
    },

    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // 在集合中加入一个或一组model,model可以继承自Model,也可以是要转化成model的
    // JS对象,或是两者的组合
    add: function(models, options) {
      return this.set(models, _.extend({merge: false}, options, addOptions));
    },

    remove: function (models, options) {
      options = _.extend({}, options);
      // 判断是否只有一个model
      var singular = !_.isArray(models);
      models = singular ? [models] : models.slice();
      var removed = this._removeModels(models, options);
      if (!options.silent && removed.length) {
        options.changes = {added: [], merged: [], removed: removed};
        this.trigger('update', this, options);
      }
      return singular ? removed[0] : removed;
    },

    // 核心方法,可以添加新model,移除model,合并model
    set: function(models, options) {
      if (models == null) return;

      options = _.extend({}, setOptions, options);
      if (options.parse && !this._isModel(models)) {
        models = this.parse(models, options) || [];
      }

      var singular = !_.isArray(models);
      models = singular ? [models] : models.slice();

      // at: 指定位置
      var at = options.at;
      if (at != null) at = +at;
      if (at > this.length) at = this.length;
      if (at < 0) at += this.length + 1;

      // 分别要设置、增加、合并、删除的模型
      var set = [];
      var toAdd = [];
      var toMerge = [];
      var toRemove = [];
      // 这里存放根据传入的models确定的需要增加和更新的models(存model的cid和
      // 一个true的键值对),不在这里面的model(原先在collections中的)会被移除
      var modelMap = {};

      var add = options.add;
      var merge = options.merge;
      var remove = options.remove;

      var sort = false;
      var sortable = this.comparator && at == null && options.sort !== false;
      // comparator是字符串,根据该属性来排序
      var sortAttr = _.isString(this.comparator) ? this.comparator : null;

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      var model, i;
      for (i = 0; i < models.length; i++) {
        model = models[i];

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        var existing = this.get(model);
        if (existing) {
          if (merge && model !== existing) {
            var attrs = this._isModel(model) ? model.attributes : model;
            if (options.parse) attrs = existing.parse(attrs, options);
            existing.set(attrs, options);
            toMerge.push(existing);
            // 可排序且排序的属性改变了,后面要重新排序
            if (sortable && !sort) sort = existing.hasChanged(sortAttr);
          }
          if (!modelMap[existing.cid]) {
            modelMap[existing.cid] = true;
            set.push(existing);
          }
          models[i] = existing;

        // If this is a new, valid model, push it to the `toAdd` list.
        } else if (add) {
          model = models[i] = this._prepareModel(model, options);
          if (model) {
            toAdd.push(model);
            this._addReference(model, options);
            modelMap[model.cid] = true;
            set.push(model);
          }
        }
      }

      // Remove stale(本次set没有涉及到的model) models.
      if (remove) {
        for (i = 0; i < this.length; i++) {
          model = this.models[i];
          if (!modelMap[model.cid]) toRemove.push(model);
        }
        if (toRemove.length) this._removeModels(toRemove, options);
      }

      // See if sorting is needed, update `length` and splice in new models.
      var orderChanged = false;
      // 直接进行replace
      var replace = !sortable && add && remove;
      if (set.length && replace) {
        // 判断models顺序是否发生改变
        orderChanged = this.length !== set.length || _.some(this.models, function(m, index) {
          return m !== set[index];
        });
        // models.length设为0,再从0处开始插入,且this.length设为了新的models.length,
        // 相当于直接replace了原来的models
        this.models.length = 0;
        splice(this.models, set, 0);
        this.length = this.models.length;
      } else if (toAdd.length) {
        if (sortable) sort = true;
        splice(this.models, toAdd, at == null ? this.length : at);
        this.length = this.models.length;
      }

      // Silently sort the collection if appropriate.
      if (sort) this.sort({silent: true});

      // Unless silenced, it's time to fire all appropriate add/sort/update events.
      if (!options.silent) {
        for (i = 0; i < toAdd.length; i++) {
          if (at != null) options.index = at + i;
          model = toAdd[i];
          model.trigger('add', model, this, options);
        }
        if (sort || orderChanged) this.trigger('sort', this, options);
        if (toAdd.length || toRemove.length || toMerge.length) {
          options.changes = {
            added: toAdd,
            removed: toRemove,
            merged: toMerge
          };
          this.trigger('update', this, options);
        }
      }

      // Return the added (or merged) model (or models).
      return singular ? models[0] : models;
    },

    // 直接重置整个models,不会触发'add'或'romove'事件,只触发一个'reset'事件
    // 对于大量的操作很有用
    reset: function (models, options) {
      options = options ? _.clone(options) : {};
      for (var i = 0; i < this.models.length; i++) {
        this._removeReference(this.models[i], options);
      }
      options.previousModels = this.models;
      this._reset();
      models = this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return models;
    },

    push: function (model, options) {
      return this.add(model, _.extend({at: this.length}), options);
    },

    pop: function (options) {
      var model = this.at(this.length - 1);
      return this.remove(model, options);
    },

    unshift: function (model, options) {
      return this.add(model, _.extend({at: 0}, options));
    },

    // Remove a model from the beginning of the collection.
    shift: function (options) {
      var model = this.at(0);
      return this.remove(model, options);
    },

    // Slice out a sub-array of models from the collection.
    slice: function () {
      return slice.apply(this.models, arguments);
    },

    // Get a model from the set by id, cid, model object with id or cid
    // properties, or an attributes object that is transformed through modelId.
    get: function(obj) {
      if (obj == null) return void 0;
      return this._byId[obj] ||
        this._byId[this.modelId(this._isModel(obj) ? obj.attributes : obj)] ||
        obj.cid && this._byId[obj.cid];
    },

    // Returns `true` if the model is in the collection.
    has: function(obj) {
      return this.get(obj) != null;
    },

    // Get the model at the given index.
    at: function(index) {
      if (index < 0) index += this.length;
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where: function(attrs, first) {
      return this[first ? 'find' : 'filter'](attrs);
    },

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere: function(attrs) {
      return this.where(attrs, true);
    },

    // 排序,大部分情况不需要显式调用这个函数,集合会保持有序
    sort: function (options) {
      var comparator = this.comparator;
      if (!comparator) throw new Error('Cannot sort a set without a comparator');
      options || (options = {});

      var length = comparator.length;
      if (_.isFunction(comparator)) comparator = _.bind(comparator, this);

      // Run sort based on type of `comparator`.
      // comparator是个属性名
      if (length === 1 || _.isString(comparator)) {
        this.models = this.sortBy(comparator);
      } else {
        // 函数,直接调用underscore的collection的sort
        this.models.sort(comparator);
      }
      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // 采集所有属性,组成一个数组返回
    pluck: function (attr) {
      // + ''确保传入字符串
      return this.map(attr + '');
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch: function(options) {
      options = _.extend({parse: true}, options);
      // wrap success
      var success = options.success;
      var collection = this;
      options.success = function(resp) {
        var method = options.reset ? 'reset' : 'set';
        collection[method](resp, options);
        if (success) success.call(options.context, collection, resp, options);
        collection.trigger('sync', collection, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      var wait = options.wait;
      model = this._prepareModel(model, options);
      if (!model) return false;
      // 如果不wait,直接add
      if (!wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(m, resp, callbackOpts) {
        // 如果wait,在success回调里add
        if (wait) collection.add(m, callbackOpts);
        if (success) success.call(callbackOpts.context, m, resp, callbackOpts);
      };
      // 新模型,不用传入key,value来save
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models, {
        model: this.model,
        comparator: this.comparator
      });
    },

    // Define how to uniquely identify models in the collection.
    // 从传入的属性中获取model id
    modelId: function(attrs) {
      return attrs[this.model.prototype.idAttribute || 'id'];
    },

    // Get an iterator of all models in this collection.
    values: function() {
      return new CollectionIterator(this, ITERATOR_VALUES);
    },

    // Get an iterator of all model IDs in this collection.
    keys: function() {
      return new CollectionIterator(this, ITERATOR_KEYS);
    },

    // Get an iterator of all [ID, model] tuples in this collection.
    entries: function() {
      return new CollectionIterator(this, ITERATOR_KEYSVALUES);
    },

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    _reset: function() {
      this.length = 0;
      this.models = [];
      this._byId  = {};
    },

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    _prepareModel: function(attrs, options) {
      // 传入的是一个Model,把它的collection属性设好返回
      if (this._isModel(attrs)) {
        if (!attrs.collection) attrs.collection = this;
        return attrs;
      }
      options = options ? _.clone(options) : {};
      options.collection = this;
      var model = new this.model(attrs, options);
      // 验证通过,返回新建的model
      if (!model.validationError) return model;

      this.trigger('invalid', this, model.validationError, options);
      return false;
    },

    // Internal method called by both remove and set.
    _removeModels: function(models, options) {
      var removed = [];
      for (var i = 0; i < models.length; i++) {
        var model = this.get(models[i]);
        if (!model) continue;

        var index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;

        // Remove references before triggering 'remove' event to prevent an
        // infinite loop. #3693
        // this._byId上同时有从cid和id到model的映射,见_addReference方法
        delete this._byId[model.cid];
        var id = this.modelId(model.attributes);
        if (id != null) delete this._byId[id];

        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }

        removed.push(model);
        // 这个方法里在上面delete _byId的属性基础上,还做了解绑事件,删除
        // model.collection属性等工作
        this._removeReference(model, options);
      }
      return removed;
    },

    // Method for checking whether an object should be considered a model for
    // the purposes of adding to the collection.
    _isModel: function(model) {
      return model instanceof Model;
    },

    // Internal method to create a model's ties to a collection.
    _addReference: function(model, options) {
      // 首先_byId对象上存放两个model的引用(分别可以通过cid和id映射到model)
      this._byId[model.cid] = model;
      var id = this.modelId(model.attributes);
      if (id != null) this._byId[id] = model;
      // 监听该模型上的所有事件
      model.on('all', this._onModelEvent, this);
    },

    // Internal method to sever(切开) a model's ties to a collection.
    _removeReference: function(model, options) {
      delete this._byId[model.cid];
      var id = this.modelId(model.attributes);
      if (id != null) delete this._byId[id];
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through.
    _onModelEvent: function(event, model, collection, options) {
      if (model) {
        // "add" and "remove" events that originate
        // in other collections are ignored.
        if ((event === 'add' || event === 'remove') && collection !== this) return;

        if (event === 'destroy') this.remove(model, options);
        if (event === 'change') {
          var prevId = this.modelId(model.previousAttributes());
          var id = this.modelId(model.attributes);
          if (prevId !== id) {
            if (prevId != null) delete this._byId[prevId];
            if (id != null) this._byId[id] = model;
          }
        }
      }
      this.trigger.apply(this, arguments);
    }
  });

  // Defining an @@iterator method implements JavaScript's Iterable protocol.
  // In modern ES2015 browsers, this value is found at Symbol.iterator.
  /* global Symbol */
  var $$iterator = typeof Symbol === 'function' && Symbol.iterator;
  if ($$iterator) {
    Collection.prototype[$$iterator] = Collection.prototype.values;
  }

  // CollectionIterator
  // ------------------

  // A CollectionIterator implements JavaScript's Iterator protocol, allowing the
  // use of `for of` loops in modern browsers and interoperation between
  // Backbone.Collection and other JavaScript functions and third-party libraries
  // which can operate on Iterables.
  var CollectionIterator = function(collection, kind) {
    this._collection = collection;
    this._kind = kind;
    this._index = 0;
  };

  // This "enum" defines the three possible kinds of values which can be emitted
  // by a CollectionIterator that correspond to the values(), keys() and entries()
  // methods on Collection, respectively.
  var ITERATOR_VALUES = 1;
  var ITERATOR_KEYS = 2;
  var ITERATOR_KEYSVALUES = 3;

  // All Iterators should themselves be Iterable.
  if ($$iterator) {
    CollectionIterator.prototype[$$iterator] = function() {
      return this;
    };
  }

  CollectionIterator.prototype.next = function() {
    if (this._collection) {

      // Only continue iterating if the iterated collection is long enough.
      if (this._index < this._collection.length) {
        var model = this._collection.at(this._index);
        this._index++;

        // Construct a value depending on what kind of values should be iterated.
        var value;
        if (this._kind === ITERATOR_VALUES) {
          value = model;
        } else {
          var id = this._collection.modelId(model.attributes);
          if (this._kind === ITERATOR_KEYS) {
            value = id;
          } else { // ITERATOR_KEYSVALUES
            value = [id, model];
          }
        }
        return {value: value, done: false};
      }

      // Once exhausted, remove the reference to the collection so future
      // calls to the next method always return done.
      this._collection = void 0;
    }

    return {value: void 0, done: true};
  };

  // Underscore methods that we want to implement on the Collection.
  // 90% of the core usefulness of Backbone Collections is actually implemented
  // right here:
  var collectionMethods = {forEach: 3, each: 3, map: 3, collect: 3, reduce: 0,
      foldl: 0, inject: 0, reduceRight: 0, foldr: 0, find: 3, detect: 3, filter: 3,
      select: 3, reject: 3, every: 3, all: 3, some: 3, any: 3, include: 3, includes: 3,
      contains: 3, invoke: 0, max: 3, min: 3, toArray: 1, size: 1, first: 3,
      head: 3, take: 3, initial: 3, rest: 3, tail: 3, drop: 3, last: 3,
      without: 0, difference: 0, indexOf: 3, shuffle: 1, lastIndexOf: 3,
      isEmpty: 1, chain: 1, sample: 3, partition: 3, groupBy: 3, countBy: 3,
      sortBy: 3, indexBy: 3, findIndex: 3, findLastIndex: 3};

  // Mix in each Underscore method as a proxy to `Collection#models`.
  addUnderscoreMethods(Collection, collectionMethods, 'models');


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
    _.defaults(options || (options = {}), {
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

  return Backbone;
});
