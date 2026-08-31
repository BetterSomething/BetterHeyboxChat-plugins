/**
 * 本机开发桥：在渲染进程开 127.0.0.1 HTTP，给 Cursor MCP 调 eval / Vuex / webpack。
 * 只绑本机回环；握手文件写 dataRoot，不把用户 pkey 写入存储。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'heybox-dev-mcp';
  var HOST_FILE = 'host.js';
  var HANDSHAKE_NAME = 'heybox-dev-mcp.json';
  var DEFAULT_PORT = 19222;
  var PORT_SPAN = 20;
  var CONSOLE_CAP = 200;
  var NETWORK_CAP = 80;

  var server = null;
  var listenPort = 0;
  var token = '';
  var lastError = '';
  var startedAt = '';
  var lastRpcAt = '';
  var rpcCount = 0;
  var consoleBuffer = [];
  var networkBuffer = [];
  var hooksInstalled = false;
  var origConsole = {};
  var origFetch = null;
  var origXhrOpen = null;
  var origXhrSend = null;

  function getHost() {
    return window.BhchatHeyboxDevMcp || null;
  }

  function readPluginFile(rel) {
    var preload = window.bhchatPreload && window.bhchatPreload.plugins;
    if (preload && typeof preload.readUserFile === 'function') {
      try {
        var fromPreload = preload.readUserFile(PLUGIN_ID, rel);
        if (fromPreload) return fromPreload;
      } catch (err) {
        /* 再试别的路径 */
      }
    }
    var api = window.BHChat && window.BHChat.plugins;
    if (api && typeof api.readUserFile === 'function') {
      try {
        var fromApi = api.readUserFile(PLUGIN_ID, rel);
        if (fromApi) return fromApi;
      } catch (err2) {
        /* ignore */
      }
    }
    try {
      var fs = nodeRequire('fs');
      var pathMod = nodeRequire('path');
      var root = dataRoot();
      if (fs && pathMod && root) {
        var file = pathMod.join(root, 'plugins', PLUGIN_ID, rel);
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
      }
    } catch (err3) {
      /* ignore */
    }
    return '';
  }

  function ensureHost() {
    if (getHost()) return true;
    var code = readPluginFile(HOST_FILE);
    if (code) {
      var script = document.createElement('script');
      script.text = typeof code === 'string' ? code : String(code);
      script.setAttribute('data-bhchat-plugin-file', PLUGIN_ID + '/' + HOST_FILE);
      document.head.appendChild(script);
      if (getHost()) return true;
    }
    try {
      var pathMod = nodeRequire('path');
      var root = dataRoot();
      if (pathMod && root) {
        var loaded = nodeRequire(pathMod.join(root, 'plugins', PLUGIN_ID, HOST_FILE));
        if (loaded) {
          window.BhchatHeyboxDevMcp = loaded;
          return true;
        }
      }
    } catch (err) {
      /* ignore */
    }
    return !!getHost();
  }

  function nodeRequire(name) {
    try {
      if (typeof require === 'function') return require(name);
    } catch (err) {
      /* ignore */
    }
    try {
      if (typeof window !== 'undefined' && typeof window.require === 'function') {
        return window.require(name);
      }
    } catch (err2) {
      /* ignore */
    }
    return null;
  }

  function dataRoot() {
    try {
      var api = window.BHChat && window.BHChat.plugins;
      if (api && typeof api.dataRoot === 'function') return api.dataRoot() || '';
    } catch (err) {
      /* ignore */
    }
    return '';
  }

  function handshakePath() {
    var root = dataRoot();
    var path = nodeRequire('path');
    if (!root || !path) return '';
    return path.join(root, HANDSHAKE_NAME);
  }

  function randomToken() {
    var crypto = nodeRequire('crypto');
    if (crypto && typeof crypto.randomBytes === 'function') {
      return crypto.randomBytes(16).toString('hex');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function writeHandshake() {
    var fs = nodeRequire('fs');
    var file = handshakePath();
    if (!fs || !file) return false;
    try {
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            port: listenPort,
            token: token,
            pid: typeof process !== 'undefined' ? process.pid : 0,
            startedAt: startedAt,
            url: 'http://127.0.0.1:' + listenPort,
            clientVersion:
              (window.BHChat && window.BHChat.clientVersion) || window.asar_version || '',
            bhchatVersion: (window.BHChat && window.BHChat.version) || '',
          },
          null,
          2,
        ),
        'utf8',
      );
      return true;
    } catch (err) {
      lastError = '写握手文件失败：' + ((err && err.message) || err);
      return false;
    }
  }

  function removeHandshake() {
    var fs = nodeRequire('fs');
    var file = handshakePath();
    if (!fs || !file) return;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      /* ignore */
    }
  }

  function pushConsole(level, args) {
    var text = '';
    try {
      text = Array.prototype.map
        .call(args || [], function (item) {
          if (typeof item === 'string') return item;
          try {
            return JSON.stringify(item);
          } catch (err) {
            return String(item);
          }
        })
        .join(' ');
    } catch (err2) {
      text = '';
    }
    consoleBuffer.push({
      t: new Date().toISOString(),
      level: level,
      text: text.slice(0, 2000),
    });
    if (consoleBuffer.length > CONSOLE_CAP) consoleBuffer.splice(0, consoleBuffer.length - CONSOLE_CAP);
  }

  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      origConsole[level] = console[level];
      console[level] = function () {
        pushConsole(level, arguments);
        if (typeof origConsole[level] === 'function') {
          return origConsole[level].apply(console, arguments);
        }
      };
    });
    if (typeof window.fetch === 'function') {
      origFetch = window.fetch;
      window.fetch = function (input, init) {
        var started = Date.now();
        var url = '';
        var method = 'GET';
        try {
          url = typeof input === 'string' ? input : (input && input.url) || '';
          method = (init && init.method) || (input && input.method) || 'GET';
        } catch (err) {
          /* ignore */
        }
        return origFetch.apply(this, arguments).then(
          function (res) {
            pushNetwork(method, url, res && res.status, Date.now() - started);
            return res;
          },
          function (err) {
            pushNetwork(method, url, 0, Date.now() - started, err && err.message);
            throw err;
          },
        );
      };
    }
    if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
      origXhrOpen = XMLHttpRequest.prototype.open;
      origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bhchatDev = { method: method, url: url, started: 0 };
        return origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (xhr.__bhchatDev) xhr.__bhchatDev.started = Date.now();
        xhr.addEventListener('loadend', function () {
          var meta = xhr.__bhchatDev || {};
          pushNetwork(meta.method || 'GET', meta.url || '', xhr.status, Date.now() - (meta.started || Date.now()));
        });
        return origXhrSend.apply(this, arguments);
      };
    }
  }

  function pushNetwork(method, url, status, ms, error) {
    var host = getHost();
    networkBuffer.push({
      t: new Date().toISOString(),
      method: String(method || 'GET').toUpperCase(),
      url: host ? host.redactUrl(url) : String(url || ''),
      status: Number(status) || 0,
      ms: Number(ms) || 0,
      error: error ? String(error) : '',
    });
    if (networkBuffer.length > NETWORK_CAP) networkBuffer.splice(0, networkBuffer.length - NETWORK_CAP);
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          reject(new Error('请求体过大'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', function () {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, code, body) {
    var text = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  }

  function tokenOf(req) {
    var auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    var header = (req.headers && (req.headers['x-heybox-dev-token'] || req.headers['X-Heybox-Dev-Token'])) || '';
    if (header) return String(header);
    if (String(auth).slice(0, 7).toLowerCase() === 'bearer ') return String(auth).slice(7).trim();
    return '';
  }

  function handleHttp(req, res) {
    if (req.socket && req.socket.remoteAddress && req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1' && req.socket.remoteAddress !== ':ffff:127.0.0.1') {
      sendJson(res, 403, { ok: false, error: '只接受本机连接' });
      return;
    }
    var url = req.url || '/';
    var path = url.split('?')[0];
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      sendJson(res, 200, {
        ok: true,
        plugin: PLUGIN_ID,
        port: listenPort,
        startedAt: startedAt,
        rpcCount: rpcCount,
      });
      return;
    }
    if (req.method !== 'POST' || path !== '/rpc') {
      sendJson(res, 404, { ok: false, error: '请 POST /rpc' });
      return;
    }
    if (!token || tokenOf(req) !== token) {
      sendJson(res, 401, { ok: false, error: 'token 无效' });
      return;
    }
    readBody(req)
      .then(function (raw) {
        var payload = raw ? JSON.parse(raw) : {};
        var method = payload.method || payload.name;
        var params = payload.params || payload.arguments || {};
        lastRpcAt = new Date().toISOString();
        rpcCount += 1;
        if (!ensureHost()) return { ok: false, error: 'host 未就绪（host.js 未注入）' };
        var host = getHost();
        if (!host) return { ok: false, error: 'host 未就绪（host.js 未注入）' };
        return host.handleRequest(method, params, {
          window: window,
          process: typeof process !== 'undefined' ? process : null,
          consoleBuffer: consoleBuffer,
          networkBuffer: networkBuffer,
        });
      })
      .then(function (result) {
        sendJson(res, 200, result);
      })
      .catch(function (err) {
        sendJson(res, 400, { ok: false, error: (err && err.message) || '坏请求' });
      });
  }

  function listenOn(http, port) {
    return new Promise(function (resolve, reject) {
      var s = http.createServer(handleHttp);
      s.on('error', reject);
      s.listen(port, '127.0.0.1', function () {
        resolve(s);
      });
    });
  }

  function startServer() {
    var http = nodeRequire('http');
    if (!http || typeof http.createServer !== 'function') {
      lastError = '渲染进程没有 Node http，无法开桥';
      return Promise.resolve(false);
    }
    return stopServer().then(function () {
      token = randomToken();
      lastError = '';
      var port = DEFAULT_PORT;
      function tryPort() {
        return listenOn(http, port).catch(function (err) {
          if (err && err.code === 'EADDRINUSE' && port < DEFAULT_PORT + PORT_SPAN) {
            port += 1;
            return tryPort();
          }
          throw err;
        });
      }
      return tryPort()
        .then(function (s) {
          server = s;
          listenPort = port;
          startedAt = new Date().toISOString();
          if (!writeHandshake()) {
            lastError = lastError || '握手文件未写入，MCP 可能连不上';
          }
          return true;
        })
        .catch(function (err) {
          lastError = (err && err.message) || String(err);
          server = null;
          listenPort = 0;
          return false;
        });
    });
  }

  function stopServer() {
    return new Promise(function (resolve) {
      removeHandshake();
      if (!server) {
        listenPort = 0;
        resolve();
        return;
      }
      var s = server;
      server = null;
      listenPort = 0;
      try {
        s.close(function () {
          resolve();
        });
      } catch (err) {
        resolve();
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return Promise.resolve();
  }

  function statusText() {
    if (lastError) return lastError;
    if (listenPort) {
      return (
        '监听 127.0.0.1:' +
        listenPort +
        ' · RPC ' +
        rpcCount +
        ' 次' +
        (lastRpcAt ? ' · 最近 ' + lastRpcAt : '') +
        ' · 握手 ' +
        (handshakePath() || '未写入')
      );
    }
    return '未监听';
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.heyboxDevMcp = {
      getStatus: function () {
        return {
          listening: !!listenPort,
          port: listenPort,
          url: listenPort ? 'http://127.0.0.1:' + listenPort : '',
          handshake: handshakePath(),
          rpcCount: rpcCount,
          lastRpcAt: lastRpcAt,
          error: lastError,
        };
      },
      start: startServer,
      stop: stopServer,
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatHeyboxDevMcpPanel',
      data: function () {
        return {
          status: statusText(),
          listening: !!listenPort,
        };
      },
      mounted: function () {
        var self = this;
        this._timer = setInterval(function () {
          self.status = statusText();
          self.listening = !!listenPort;
        }, 800);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        onRestart: function () {
          var self = this;
          startServer().then(function () {
            self.status = statusText();
            self.listening = !!listenPort;
          });
        },
        onOpen: function () {
          if (window.BHChat && window.BHChat.devtools && window.BHChat.devtools.open) {
            window.BHChat.devtools.open();
          }
        },
        onCopyConfig: function () {
          var snippet =
            '"heybox-dev": {\n  "command": "node",\n  "args": ["G:\\\\DevProject\\\\BetterHeyboxChat-plugins\\\\heybox-dev-mcp\\\\mcp-server.mjs"]\n}';
          var self = this;
          copyText(snippet).then(function () {
            self.status = '已复制 Cursor mcp.json 片段（token 仍只在握手文件里）';
          });
        },
      },
      render: function (h) {
        return h('div', [
          h('div', { class: 'cell-title' }, '开发调试 MCP'),
          h('p', { class: 'text-tx-2 text-[13px]' }, '本机 127.0.0.1 HTTP 桥。Cursor 读 dataRoot 握手文件，不要把 token 提交仓库。'),
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: { 'bhchat-btn': true, 'bhchat-btn-primary': true },
                attrs: { type: 'button' },
                on: { click: this.onRestart },
              },
              this.listening ? '重启桥接' : '启动桥接',
            ),
            h(
              'button',
              {
                class: { 'bhchat-btn': true, 'bhchat-btn-secondary': true },
                attrs: { type: 'button' },
                on: { click: this.onOpen },
              },
              '打开 DevTools',
            ),
            h(
              'button',
              {
                class: { 'bhchat-btn': true, 'bhchat-btn-secondary': true },
                attrs: { type: 'button' },
                on: { click: this.onCopyConfig },
              },
              '复制 MCP 配置',
            ),
          ]),
          h('div', { class: 'bhchat-hint' }, this.status || ''),
        ]);
      },
    };
  }

  function activate() {
    if (!ensureHost()) lastError = lastError || 'host.js 未注入';
    installHooks();
    registerApi();
    if (window.BHChat && window.BHChat.registerPanel) {
      window.BHChat.registerPanel({
        id: PLUGIN_ID,
        title: '开发调试 MCP',
        component: buildPanelComponent(),
      });
    }
    startServer();
  }

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  } else {
    activate();
  }
})();
