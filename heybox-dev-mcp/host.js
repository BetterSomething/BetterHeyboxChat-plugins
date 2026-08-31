/**
 * 开发桥：序列化、打码、RPC 分发。纯函数为主，便于 Node 单测。
 * 不把 pkey / Cookie / token 写入返回值（eval 除外，那是裸执行）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.BhchatHeyboxDevMcp = api;
  } else if (root) {
    root.BhchatHeyboxDevMcp = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SECRET_KEY_RE =
    /^(pkey|password|passwd|secret|token|usersig|user_sig|authorization|cookie|set-cookie|private_map_key|privatemapkey|session|access_token|refresh_token|api_key|apikey)$/i;
  var SECRET_QUERY_RE = /([?&](?:pkey|token|usersig|user_sig|authorization|cookie|key)=)[^&]*/gi;
  var DEFAULT_MAX_DEPTH = 5;
  var DEFAULT_MAX_KEYS = 80;
  var DEFAULT_MAX_ARRAY = 40;
  var DEFAULT_MAX_STRING = 4000;
  var DEFAULT_MAX_BYTES = 180000;

  function asText(value) {
    if (value == null) return '';
    return String(value);
  }

  function isSecretKey(name) {
    return SECRET_KEY_RE.test(asText(name));
  }

  function redactUrl(text) {
    return asText(text).replace(SECRET_QUERY_RE, '$1[redacted]');
  }

  function truncate(text, max) {
    text = asText(text);
    if (text.length <= max) return text;
    return text.slice(0, max) + '…(+ ' + (text.length - max) + ' chars)';
  }

  function isDomNode(value) {
    return !!(value && typeof value === 'object' && value.nodeType && value.nodeName);
  }

  function isVue(value) {
    return !!(value && typeof value === 'object' && (value._isVue || value.$el || value._vnode));
  }

  function describeDom(el) {
    if (!isDomNode(el)) return null;
    var id = el.id ? '#' + el.id : '';
    var cls = '';
    try {
      var raw = el.className;
      if (typeof raw === 'string' && raw.trim()) {
        cls =
          '.' +
          raw
            .trim()
            .split(/\s+/)
            .slice(0, 6)
            .join('.');
      }
    } catch (err) {
      /* ignore */
    }
    var text = '';
    try {
      text = truncate((el.textContent || '').replace(/\s+/g, ' ').trim(), 120);
    } catch (err2) {
      /* ignore */
    }
    return {
      $dom: asText(el.nodeName) + id + cls,
      text: text,
      childElementCount: el.childElementCount || 0,
    };
  }

  function describeVue(inst) {
    var name = '';
    try {
      name =
        (inst.$options && (inst.$options.name || inst.$options._componentTag)) ||
        (inst.$vnode && inst.$vnode.tag) ||
        '';
    } catch (err) {
      /* ignore */
    }
    return { $vue: asText(name) || true };
  }

  function describeFn(fn) {
    var name = '';
    try {
      name = fn.name || '';
    } catch (err) {
      /* ignore */
    }
    return '[Function' + (name ? ' ' + name : '') + ']';
  }

  function serialize(value, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth == null ? DEFAULT_MAX_DEPTH : Number(opts.maxDepth) || 0;
    var maxKeys = opts.maxKeys == null ? DEFAULT_MAX_KEYS : Number(opts.maxKeys) || 1;
    var maxArray = opts.maxArray == null ? DEFAULT_MAX_ARRAY : Number(opts.maxArray) || 1;
    var maxString = opts.maxString == null ? DEFAULT_MAX_STRING : Number(opts.maxString) || 32;
    var seen = typeof WeakSet === 'function' ? new WeakSet() : [];

    function seenHas(obj) {
      if (seen && seen.add) return seen.has(obj);
      return seen.indexOf(obj) !== -1;
    }

    function seenAdd(obj) {
      if (seen && seen.add) seen.add(obj);
      else seen.push(obj);
    }

    function walk(cur, depth, key) {
      if (key && isSecretKey(key) && !opts.keepSecrets) return '[redacted]';
      if (cur == null) return cur;
      var t = typeof cur;
      if (t === 'string') {
        if (/^https?:\/\//i.test(cur) || /^rtmps?:\/\//i.test(cur)) return redactUrl(truncate(cur, maxString));
        return truncate(cur, maxString);
      }
      if (t === 'number' || t === 'boolean') return cur;
      if (t === 'bigint') return String(cur) + 'n';
      if (t === 'symbol') return String(cur);
      if (t === 'function') return describeFn(cur);
      if (t !== 'object') return asText(cur);
      if (cur instanceof Error) {
        return {
          $error: cur.name || 'Error',
          message: asText(cur.message),
          stack: truncate(cur.stack || '', 2000),
        };
      }
      if (typeof Date !== 'undefined' && cur instanceof Date) return cur.toISOString();
      if (typeof RegExp !== 'undefined' && cur instanceof RegExp) return String(cur);
      if (isDomNode(cur)) return describeDom(cur);
      if (isVue(cur) && depth > 0) return describeVue(cur);
      if (seenHas(cur)) return '[Circular]';
      if (depth >= maxDepth) {
        if (Array.isArray(cur)) return '[Array(' + cur.length + ')]';
        return '[Object]';
      }
      seenAdd(cur);
      if (Array.isArray(cur)) {
        var arr = [];
        var limit = Math.min(cur.length, maxArray);
        for (var i = 0; i < limit; i++) arr.push(walk(cur[i], depth + 1, ''));
        if (cur.length > limit) arr.push('…(+ ' + (cur.length - limit) + ' items)');
        return arr;
      }
      var out = {};
      var names = [];
      try {
        names = Object.keys(cur);
      } catch (err) {
        return { $unreadable: asText(err && err.message) };
      }
      var used = 0;
      for (var j = 0; j < names.length && used < maxKeys; j++) {
        var name = names[j];
        try {
          out[name] = walk(cur[name], depth + 1, name);
          used += 1;
        } catch (err2) {
          out[name] = { $throw: asText(err2 && err2.message) };
          used += 1;
        }
      }
      if (names.length > used) out.$moreKeys = names.length - used;
      return out;
    }

    var result = walk(value, 0, '');
    var json = '';
    try {
      json = JSON.stringify(result);
    } catch (err) {
      return { $serializeError: asText(err && err.message) };
    }
    if (json && json.length > DEFAULT_MAX_BYTES) {
      return {
        $truncated: true,
        bytes: json.length,
        preview: json.slice(0, DEFAULT_MAX_BYTES),
      };
    }
    return result;
  }

  function walkPath(root, path) {
    if (root == null) return { ok: false, error: '根对象为空' };
    var text = asText(path).trim();
    if (!text) return { ok: true, value: root };
    var parts = text.split('.').filter(Boolean);
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || (typeof cur !== 'object' && typeof cur !== 'function')) {
        return { ok: false, error: '路径中断：' + parts.slice(0, i).join('.') };
      }
      var key = parts[i];
      if (!(key in cur)) return { ok: false, error: '没有字段：' + parts.slice(0, i + 1).join('.') };
      cur = cur[key];
    }
    return { ok: true, value: cur };
  }

  function collectEnv(ctx) {
    ctx = ctx || {};
    var w = ctx.window || (typeof window !== 'undefined' ? window : null);
    var proc = ctx.process || (typeof process !== 'undefined' ? process : null);
    var env = {};
    if (proc && proc.env) {
      Object.keys(proc.env).forEach(function (key) {
        env[key] = isSecretKey(key) ? '[redacted]' : asText(proc.env[key]);
      });
    }
    var loc = w && w.location ? w.location : {};
    var nav = w && w.navigator ? w.navigator : {};
    var bh = w && w.BHChat ? w.BHChat : {};
    return {
      href: redactUrl(loc.href || ''),
      origin: asText(loc.origin || ''),
      pathname: asText(loc.pathname || ''),
      userAgent: asText(nav.userAgent || ''),
      asarVersion: asText((w && w.asar_version) || ''),
      bhchatVersion: asText(bh.version || ''),
      clientVersion: asText(bh.clientVersion || ''),
      electronEnv: env.ELECTRON_ENV || '',
      node: proc && proc.versions ? proc.versions : {},
      execPath: proc ? asText(proc.execPath || '') : '',
      cwd: proc && typeof proc.cwd === 'function' ? proc.cwd() : '',
      pid: proc ? proc.pid : 0,
      platform: proc ? asText(proc.platform || '') : '',
      env: env,
    };
  }

  function inspectModule(mod) {
    if (mod == null) return { type: typeof mod, value: mod };
    if (typeof mod !== 'object' && typeof mod !== 'function') {
      return { type: typeof mod, value: serialize(mod) };
    }
    var keys = [];
    try {
      keys = Object.keys(mod);
    } catch (err) {
      keys = [];
    }
    var protoKeys = [];
    try {
      if (mod && typeof mod === 'object') protoKeys = Object.getOwnPropertyNames(mod).slice(0, 40);
    } catch (err2) {
      /* ignore */
    }
    var exports = {};
    keys.slice(0, 60).forEach(function (key) {
      var val;
      try {
        val = mod[key];
      } catch (err3) {
        exports[key] = { $throw: asText(err3 && err3.message) };
        return;
      }
      var t = typeof val;
      if (t === 'function') exports[key] = describeFn(val);
      else if (t === 'object' && val) exports[key] = { type: 'object', keys: Object.keys(val).slice(0, 20) };
      else exports[key] = val;
    });
    return {
      type: typeof mod,
      keys: keys,
      ownNames: protoKeys,
      exports: exports,
    };
  }

  function searchWebpack(requireFn, query, limit) {
    query = asText(query).trim();
    if (!query) return { ok: false, error: 'query 不能为空' };
    if (!requireFn) return { ok: false, error: 'webpack require 不可用' };
    limit = Math.max(1, Math.min(Number(limit) || 20, 80));
    var factories = requireFn.m || requireFn.modules || null;
    var cache = requireFn.c || requireFn.cache || null;
    var ids = {};
    if (factories && typeof factories === 'object') {
      Object.keys(factories).forEach(function (id) {
        ids[id] = true;
      });
    }
    if (cache && typeof cache === 'object') {
      Object.keys(cache).forEach(function (id) {
        ids[id] = true;
      });
    }
    var hits = [];
    var needle = query.toLowerCase();
    Object.keys(ids).forEach(function (id) {
      if (hits.length >= limit) return;
      var factory = factories ? factories[id] : null;
      var cached = cache ? cache[id] : null;
      var source = '';
      try {
        source = factory ? Function.prototype.toString.call(factory) : '';
      } catch (err) {
        source = '';
      }
      var exportKeys = [];
      var exports = cached && cached.exports;
      if (exports && (typeof exports === 'object' || typeof exports === 'function')) {
        try {
          exportKeys = Object.keys(exports);
        } catch (err2) {
          exportKeys = [];
        }
      }
      var blob = (source + ' ' + exportKeys.join(' ') + ' ' + id).toLowerCase();
      if (blob.indexOf(needle) === -1) return;
      var idx = source.toLowerCase().indexOf(needle);
      var snippet = '';
      if (idx >= 0) {
        var from = Math.max(0, idx - 40);
        snippet = truncate(source.slice(from, idx + query.length + 60), 200);
      }
      hits.push({
        id: id,
        exportKeys: exportKeys.slice(0, 30),
        snippet: snippet,
      });
    });
    return {
      ok: true,
      query: query,
      scanned: Object.keys(ids).length,
      hits: hits,
    };
  }

  function listWebpackIds(requireFn, limit) {
    if (!requireFn) return { ok: false, error: 'webpack require 不可用' };
    limit = Math.max(1, Math.min(Number(limit) || 200, 2000));
    var factories = requireFn.m || requireFn.modules || {};
    var cache = requireFn.c || requireFn.cache || {};
    var factoryIds = Object.keys(factories);
    var cachedIds = Object.keys(cache);
    return {
      ok: true,
      factoryCount: factoryIds.length,
      cachedCount: cachedIds.length,
      factoryIds: factoryIds.slice(0, limit),
      cachedIds: cachedIds.slice(0, limit),
    };
  }

  function snapshotDom(doc, selector, mode) {
    if (!doc || typeof doc.querySelector !== 'function') {
      return { ok: false, error: 'document 不可用' };
    }
    selector = asText(selector || 'body').trim() || 'body';
    mode = asText(mode || 'summary');
    var nodes;
    try {
      nodes = doc.querySelectorAll(selector);
    } catch (err) {
      return { ok: false, error: '选择器无效：' + asText(err && err.message) };
    }
    var list = [];
    var max = mode === 'html' ? 5 : 20;
    for (var i = 0; i < nodes.length && i < max; i++) {
      var el = nodes[i];
      var item = describeDom(el) || {};
      if (mode === 'html') {
        try {
          item.html = truncate(el.outerHTML || '', 4000);
        } catch (err2) {
          item.html = '';
        }
      }
      if (mode === 'attrs' && el.attributes) {
        item.attrs = {};
        for (var j = 0; j < el.attributes.length && j < 30; j++) {
          var attr = el.attributes[j];
          item.attrs[attr.name] = isSecretKey(attr.name) ? '[redacted]' : truncate(attr.value, 200);
        }
      }
      list.push(item);
    }
    return { ok: true, selector: selector, count: nodes.length, nodes: list };
  }

  function listStorageKeys(storage) {
    if (!storage) return [];
    var keys = [];
    try {
      if (typeof storage.length === 'number' && typeof storage.key === 'function') {
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (k) keys.push(k);
        }
        return keys;
      }
      keys = Object.keys(storage);
    } catch (err) {
      return [];
    }
    return keys;
  }

  function readStorageValue(storage, key) {
    if (!storage || !key) return null;
    if (isSecretKey(key)) return '[redacted]';
    try {
      if (typeof storage.getItem === 'function') return storage.getItem(key);
      return storage[key];
    } catch (err) {
      return null;
    }
  }

  function runEval(code, ctx) {
    var w = ctx.window;
    if (!w) return Promise.reject(new Error('window 不可用'));
    var source = asText(code);
    if (!source.trim()) return Promise.reject(new Error('code 不能为空'));
    var tag = ctx.filename ? '\n//# sourceURL=heybox-dev-mcp/' + asText(ctx.filename).replace(/[\r\n]/g, '') : '';
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var args = ['window', 'BHChat', 'document', 'console'];
    var values = [w, w.BHChat, w.document, w.console];
    try {
      return Promise.resolve(new AsyncFunction(args[0], args[1], args[2], args[3], 'return (' + source + ')' + tag)(
        values[0],
        values[1],
        values[2],
        values[3],
      ));
    } catch (err) {
      try {
        return Promise.resolve(new AsyncFunction(args[0], args[1], args[2], args[3], source + tag)(
          values[0],
          values[1],
          values[2],
          values[3],
        ));
      } catch (err2) {
        return Promise.reject(err2);
      }
    }
  }

  function handleRequest(method, params, ctx) {
    params = params || {};
    ctx = ctx || {};
    var w = ctx.window || (typeof window !== 'undefined' ? window : null);
    var bh = (w && w.BHChat) || {};

    function ok(data) {
      return Promise.resolve({ ok: true, data: data });
    }
    function fail(message) {
      return Promise.resolve({ ok: false, error: asText(message) });
    }

    if (method === 'ping' || method === 'status') {
      var room = null;
      try {
        room = bh.mapState ? bh.mapState(['cur_room_data']).cur_room_data : null;
      } catch (err) {
        room = null;
      }
      return ok({
        plugin: 'heybox-dev-mcp',
        href: w && w.location ? redactUrl(w.location.href) : '',
        title: w && w.document ? asText(w.document.title) : '',
        bhchatVersion: asText(bh.version || ''),
        clientVersion: asText(bh.clientVersion || (w && w.asar_version) || ''),
        ready: !!(w && w.document && w.document.getElementById && w.document.getElementById('app')),
        hasVue: !!(bh.getVue && bh.getVue()),
        hasStore: !!(bh.getStore && bh.getStore()),
        roomId: room && room.room_id != null ? String(room.room_id) : '',
        roomName: room && room.room_name ? String(room.room_name) : '',
        consoleSize: ctx.consoleBuffer ? ctx.consoleBuffer.length : 0,
        networkSize: ctx.networkBuffer ? ctx.networkBuffer.length : 0,
      });
    }

    if (method === 'eval') {
      return runEval(params.code || params.source, { window: w, filename: params.filename })
        .then(function (value) {
          return { ok: true, data: serialize(value, params) };
        })
        .catch(function (err) {
          return { ok: false, error: asText(err && err.message), stack: truncate((err && err.stack) || '', 2000) };
        });
    }

    if (method === 'env') {
      return ok(collectEnv({ window: w, process: ctx.process }));
    }

    if (method === 'vuex') {
      var store = bh.getStore ? bh.getStore() : null;
      if (!store) return fail('Vuex 未就绪');
      if (params.keys && params.keys.length) {
        try {
          return ok(serialize(bh.mapState(params.keys), params));
        } catch (err) {
          return fail(err && err.message);
        }
      }
      var root = store.state || {};
      if (params.path) {
        var walked = walkPath(root, params.path);
        if (!walked.ok) return fail(walked.error);
        return ok(serialize(walked.value, params));
      }
      return ok({
        keys: Object.keys(root),
        getterKeys: store.getters ? Object.keys(store.getters).slice(0, 80) : [],
        snapshot: serialize(params.full ? root : bh.mapState ? bh.mapState() : {}, params),
      });
    }

    if (method === 'webpack_require') {
      var req = (w && w.__bhchat_require__) || ctx.requireFn;
      if (!req) return fail('__bhchat_require__ 不可用');
      var id = params.id == null ? '' : String(params.id);
      if (!id) return fail('id 不能为空');
      try {
        return ok(inspectModule(req(id)));
      } catch (err) {
        return fail(err && err.message);
      }
    }

    if (method === 'webpack_search') {
      return Promise.resolve(
        searchWebpack((w && w.__bhchat_require__) || ctx.requireFn, params.query, params.limit),
      );
    }

    if (method === 'webpack_ids') {
      return Promise.resolve(listWebpackIds((w && w.__bhchat_require__) || ctx.requireFn, params.limit));
    }

    if (method === 'dom') {
      return Promise.resolve(snapshotDom(w && w.document, params.selector, params.mode));
    }

    if (method === 'console') {
      var logs = (ctx.consoleBuffer || []).slice(-(Number(params.limit) || 80));
      return ok(logs);
    }

    if (method === 'network') {
      var net = (ctx.networkBuffer || []).slice(-(Number(params.limit) || 50));
      return ok(net);
    }

    if (method === 'plugins') {
      if (!bh.listPlugins) return fail('BHChat.listPlugins 不可用');
      try {
        return ok(bh.listPlugins());
      } catch (err) {
        return fail(err && err.message);
      }
    }

    if (method === 'storage') {
      var kind = asText(params.namespace || 'local');
      if (kind === 'bhchat') {
        if (!bh.storage || typeof bh.storage.get !== 'function') return fail('BHChat.storage 不可用');
        var key = asText(params.key);
        if (!key) return fail('BHChat.storage 必须指定 key');
        if (isSecretKey(key)) return ok({ key: key, value: '[redacted]' });
        return Promise.resolve(bh.storage.get(key)).then(function (value) {
          return { ok: true, data: { key: key, value: serialize(value, params) } };
        });
      }
      var ls = w && w.localStorage;
      if (params.key) {
        return ok({ key: params.key, value: serialize(readStorageValue(ls, params.key), params) });
      }
      return ok({ keys: listStorageKeys(ls) });
    }

    if (method === 'open_devtools') {
      if (!bh.devtools || typeof bh.devtools.open !== 'function') return fail('BHChat.devtools.open 不可用');
      return Promise.resolve(bh.devtools.open()).then(function (result) {
        return { ok: true, data: result };
      });
    }

    if (method === 'paths') {
      var proc = ctx.process || (typeof process !== 'undefined' ? process : null);
      var dataRoot = '';
      try {
        dataRoot = bh.plugins && typeof bh.plugins.dataRoot === 'function' ? bh.plugins.dataRoot() : '';
      } catch (err) {
        dataRoot = '';
      }
      return ok({
        dataRoot: asText(dataRoot),
        cwd: proc && typeof proc.cwd === 'function' ? proc.cwd() : '',
        execPath: proc ? asText(proc.execPath || '') : '',
        href: w && w.location ? asText(w.location.href) : '',
      });
    }

    return fail('未知方法：' + method);
  }

  return {
    SECRET_KEY_RE: SECRET_KEY_RE,
    isSecretKey: isSecretKey,
    redactUrl: redactUrl,
    serialize: serialize,
    walkPath: walkPath,
    collectEnv: collectEnv,
    inspectModule: inspectModule,
    searchWebpack: searchWebpack,
    listWebpackIds: listWebpackIds,
    snapshotDom: snapshotDom,
    listStorageKeys: listStorageKeys,
    readStorageValue: readStorageValue,
    handleRequest: handleRequest,
  };
});
