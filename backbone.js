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

  var addUnderscoreMethods = function (Class, methods, attribute) {
    _.each(methods, function (length, method) {
      if (_[method]) Class.prototype[method] = addMethod(length, method, attribute);
    });
  };

  var cb = function (iteratee, instance) {
    if (_.isFunction(iteratee)) return iteratee;
    // 传入一个对象(模型的属性)用于搜索匹配的model
    if (_.isObject(iteratee) && !instance._isModel(iteratee)) return modelMatcher(iteratee);
    // 传入一个字符串用于...
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
            callback !== handler.callback._callback || // ?_callback
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
}));
