#!/usr/bin/env node
/**
 * Cursor MCP：把工具调用转到黑盒渲染进程的 localhost HTTP 桥。
 * 握手文件：{dataRoot}/heybox-dev-mcp.json（插件启动时写入）。
 * 可选环境变量：HEYBOX_DEV_MCP_URL、HEYBOX_DEV_MCP_TOKEN、HEYBOX_CDP_PORT。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'heybox-dev-mcp';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PORT = 19222;
const HANDSHAKE_NAME = 'heybox-dev-mcp.json';
const POINTER_NAME = 'data-root.txt';

function configHome() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'BetterHeyboxChat');
}

function resolveDataRoot() {
  const env = process.env.BETTERHEYBOXCHAT_PROFILE;
  if (env && path.isAbsolute(env)) return env;
  try {
    const pointer = fs.readFileSync(path.join(configHome(), POINTER_NAME), 'utf8').trim();
    if (pointer && path.isAbsolute(pointer)) return pointer;
  } catch {
    /* default */
  }
  return configHome();
}

export function readHandshake(root) {
  const file = path.join(root || resolveDataRoot(), HANDSHAKE_NAME);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      file,
      url: String(raw.url || (raw.port ? 'http://127.0.0.1:' + raw.port : '')),
      token: String(raw.token || ''),
      port: Number(raw.port) || 0,
      startedAt: String(raw.startedAt || ''),
      clientVersion: String(raw.clientVersion || ''),
    };
  } catch {
    return null;
  }
}

function bridgeTarget() {
  const envUrl = String(process.env.HEYBOX_DEV_MCP_URL || '').trim();
  const envToken = String(process.env.HEYBOX_DEV_MCP_TOKEN || '').trim();
  if (envUrl) return { url: envUrl.replace(/\/+$/, ''), token: envToken, source: 'env' };
  const hs = readHandshake();
  if (hs && hs.url) return { url: hs.url.replace(/\/+$/, ''), token: hs.token, source: hs.file };
  return { url: 'http://127.0.0.1:' + DEFAULT_PORT, token: envToken, source: 'default' };
}

function httpJson(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = opts.body == null ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    const headers = Object.assign(
      {
        Accept: 'application/json',
        Host: target.host,
      },
      opts.headers || {},
    );
    if (body) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: opts.method || 'GET',
        headers,
        timeout: opts.timeout || 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 0, json, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('HTTP 超时'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function rpc(method, params) {
  const target = bridgeTarget();
  const headers = {};
  if (target.token) headers.Authorization = 'Bearer ' + target.token;
  try {
    const res = await httpJson(target.url + '/rpc', {
      method: 'POST',
      headers,
      body: { method, params: params || {} },
    });
    if (res.status === 401) {
      return { ok: false, error: '握手 token 不匹配。请确认黑盒已开、插件已加载，并重启过客户端。' };
    }
    if (res.status === 0 || !res.json) {
      return { ok: false, error: '桥无响应：' + target.url };
    }
    return res.json;
  } catch (err) {
    return {
      ok: false,
      error:
        '连不上黑盒开发桥（' +
        target.url +
        '）。请安装并启用 heybox-dev-mcp，打开黑盒语音。' +
        (err && err.message ? ' ' + err.message : ''),
    };
  }
}

async function health() {
  const target = bridgeTarget();
  try {
    const res = await httpJson(target.url + '/health', { timeout: 2000 });
    return { ok: res.status === 200, target, health: res.json };
  } catch (err) {
    return { ok: false, target, error: err && err.message };
  }
}

function cdpPorts() {
  const extra = Number(process.env.HEYBOX_CDP_PORT || 0);
  const ports = [];
  if (extra) ports.push(extra);
  ports.push(9222, 9229);
  return ports.filter((p, i, arr) => arr.indexOf(p) === i);
}

async function listCdpTargets() {
  const pages = [];
  for (const port of cdpPorts()) {
    try {
      const res = await httpJson('http://127.0.0.1:' + port + '/json/list', { timeout: 800 });
      const list = Array.isArray(res.json) ? res.json : [];
      list.forEach((item) => {
        pages.push({
          port,
          title: item.title || '',
          url: item.url || '',
          type: item.type || '',
          webSocketDebuggerUrl: item.webSocketDebuggerUrl || '',
        });
      });
    } catch {
      /* 该端口没有 CDP */
    }
  }
  return pages;
}

async function cdpEvaluate(expression) {
  const targets = await listCdpTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0];
  if (!page || !page.webSocketDebuggerUrl) {
    return { ok: false, error: '没有可用的 CDP 目标。黑盒默认不开 remote-debugging-port，请用 heybox-dev-mcp 桥。' };
  }
  if (typeof WebSocket !== 'function') {
    return { ok: false, error: '当前 Node 没有 WebSocket，无法走 CDP' };
  }
  return new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: 'CDP 超时' });
    }, 8000);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: String(expression || ''), returnByValue: true, awaitPromise: true },
        }),
      );
    });
    ws.addEventListener('message', (ev) => {
      let msg = {};
      try {
        msg = JSON.parse(String(ev.data || ''));
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      const result = msg.result || {};
      if (result.exceptionDetails) {
        resolve({
          ok: false,
          error: (result.exceptionDetails.exception && result.exceptionDetails.exception.description) || 'CDP 异常',
        });
        return;
      }
      resolve({ ok: true, data: result.result && 'value' in result.result ? result.result.value : result.result });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'CDP WebSocket 失败' });
    });
  });
}

function textResult(value, isError) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text }],
    isError: !!isError,
  };
}

function schema(properties, required) {
  return {
    type: 'object',
    properties: properties || {},
    required: required || [],
    additionalProperties: false,
  };
}

const TOOLS = [
  {
    name: 'heybox_status',
    description: '探测黑盒语音是否在跑、开发桥是否就绪、当前房间和 BHChat 版本。调试前先调这个。',
    inputSchema: schema({}),
    run: async () => {
      const live = await health();
      const viaRpc = live.ok ? await rpc('status', {}) : null;
      const cdp = await listCdpTargets();
      return {
        bridge: live,
        page: viaRpc,
        cdpTargets: cdp,
        hint: live.ok
          ? '开发桥已就绪，可以直接 heybox_eval。'
          : '开发桥未就绪：安装 heybox-dev-mcp，打开黑盒。CDP 仅在客户端带 remote-debugging-port 时可用。',
      };
    },
  },
  {
    name: 'heybox_eval',
    description:
      '在黑盒渲染进程执行 JavaScript，返回 JSON 序列化结果。可用 window / BHChat / document。这是裸 eval，不要用来导出 pkey。',
    inputSchema: schema(
      {
        code: { type: 'string', description: '要执行的 JS。表达式或语句都可以。' },
        maxDepth: { type: 'number', description: '序列化深度，默认 5' },
      },
      ['code'],
    ),
    run: async (args) => rpc('eval', { code: args.code, maxDepth: args.maxDepth }),
  },
  {
    name: 'heybox_eval_file',
    description: '读取本机 JS 文件，在黑盒渲染进程执行。适合丢一段探测脚本。路径必须是绝对路径。',
    inputSchema: schema(
      {
        path: { type: 'string', description: '本机绝对路径，例如 G:\\\\DevProject\\\\probe.js' },
      },
      ['path'],
    ),
    run: async (args) => {
      const file = String(args.path || '');
      if (!path.isAbsolute(file)) return { ok: false, error: 'path 必须是绝对路径' };
      let source = '';
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch (err) {
        return { ok: false, error: '读文件失败：' + (err && err.message) };
      }
      return rpc('eval', { code: source, filename: path.basename(file) });
    },
  },
  {
    name: 'heybox_env',
    description:
      '读渲染进程环境：location、asar 版本、BHChat 版本、ELECTRON_ENV、process.env（pkey/token 已打码）。',
    inputSchema: schema({}),
    run: async () => rpc('env', {}),
  },
  {
    name: 'heybox_vuex',
    description:
      '读官方 Vuex。不传参列出已知快照；keys 走 BHChat.mapState；path 按点号深入 store.state。密钥字段会打码。',
    inputSchema: schema({
      keys: { type: 'array', items: { type: 'string' }, description: '例如 ["cur_room_data","room_list"]' },
      path: { type: 'string', description: '例如 cur_room_data.room_id' },
      full: { type: 'boolean', description: 'true 时尝试序列化整个 state（可能很大）' },
      maxDepth: { type: 'number' },
    }),
    run: async (args) => rpc('vuex', args),
  },
  {
    name: 'heybox_webpack_require',
    description: '调用 window.__bhchat_require__(id)，列出导出键和函数名。模块 ID 仅 1.56.0 有效。',
    inputSchema: schema({ id: { type: 'string', description: 'webpack 模块 ID，例如 30570' } }, ['id']),
    run: async (args) => rpc('webpack_require', { id: String(args.id) }),
  },
  {
    name: 'heybox_webpack_search',
    description: '在 webpack 工厂源码和导出名里搜索字符串，返回模块 ID 和片段。',
    inputSchema: schema(
      {
        query: { type: 'string', description: '子串，例如 screen_share 或 SOCKET_SEND_MESSAGE' },
        limit: { type: 'number', description: '最多命中数，默认 20' },
      },
      ['query'],
    ),
    run: async (args) => rpc('webpack_search', { query: args.query, limit: args.limit }),
  },
  {
    name: 'heybox_webpack_ids',
    description: '列出 webpack 工厂 / 缓存里的模块 ID。',
    inputSchema: schema({ limit: { type: 'number', description: '默认 200' } }),
    run: async (args) => rpc('webpack_ids', { limit: args.limit }),
  },
  {
    name: 'heybox_dom',
    description: 'querySelectorAll。mode=summary|html|attrs。',
    inputSchema: schema({
      selector: { type: 'string', description: 'CSS 选择器，默认 body' },
      mode: { type: 'string', description: 'summary | html | attrs' },
    }),
    run: async (args) => rpc('dom', { selector: args.selector, mode: args.mode }),
  },
  {
    name: 'heybox_console',
    description: '插件挂钩后的最近 console 输出。',
    inputSchema: schema({ limit: { type: 'number', description: '默认 80' } }),
    run: async (args) => rpc('console', { limit: args.limit }),
  },
  {
    name: 'heybox_network',
    description: '插件挂钩后的最近 fetch / XHR（URL 查询串里的 token/pkey 已打码）。',
    inputSchema: schema({ limit: { type: 'number', description: '默认 50' } }),
    run: async (args) => rpc('network', { limit: args.limit }),
  },
  {
    name: 'heybox_plugins',
    description: 'BHChat.listPlugins()，看哪些插件已加载。',
    inputSchema: schema({}),
    run: async () => rpc('plugins', {}),
  },
  {
    name: 'heybox_storage',
    description: '读 localStorage 键或指定 key。pkey 等密钥只返回 [redacted]。namespace=bhchat 时走 BHChat.storage.get。',
    inputSchema: schema({
      namespace: { type: 'string', description: 'local 或 bhchat' },
      key: { type: 'string' },
    }),
    run: async (args) => rpc('storage', args),
  },
  {
    name: 'heybox_open_devtools',
    description: '请求主进程打开原生 DevTools（F12 同一条 IPC）。',
    inputSchema: schema({}),
    run: async () => rpc('open_devtools', {}),
  },
  {
    name: 'heybox_paths',
    description: '数据根、exe、cwd、当前 href。用来定位安装目录和握手文件。',
    inputSchema: schema({}),
    run: async () => rpc('paths', {}),
  },
  {
    name: 'heybox_cdp_targets',
    description: '扫描本机常见 remote-debugging-port，列出 CDP 页面。黑盒默认可能没有。',
    inputSchema: schema({}),
    run: async () => ({ targets: await listCdpTargets() }),
  },
  {
    name: 'heybox_cdp_eval',
    description: '若黑盒开了 remote-debugging-port，走 CDP Runtime.evaluate。平时请用 heybox_eval。',
    inputSchema: schema({ expression: { type: 'string' } }, ['expression']),
    run: async (args) => cdpEvaluate(args.expression),
  },
];

function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

async function callTool(name, args) {
  const tool = findTool(name);
  if (!tool) return textResult({ ok: false, error: '未知工具：' + name }, true);
  try {
    const result = await tool.run(args || {});
    const failed = result && result.ok === false;
    return textResult(result, failed);
  } catch (err) {
    return textResult({ ok: false, error: err && err.message ? err.message : String(err) }, true);
  }
}

function writeMessage(msg) {
  // Cursor / @modelcontextprotocol/sdk 1.x 用换行 JSON，不是 LSP Content-Length。
  fs.writeSync(1, JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'notifications/initialized' || msg.method === 'initialized') return;
  if (msg.method === 'notifications/cancelled') return;
  if (idIsEmpty(msg.id) && !msg.method) return;

  if (msg.method === 'initialize') {
    sendResult(msg.id, {
      protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }
  if (msg.method === 'ping') {
    sendResult(msg.id, {});
    return;
  }
  if (msg.method === 'tools/list') {
    sendResult(msg.id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const result = await callTool(name, args);
    sendResult(msg.id, result);
    return;
  }
  if (msg.method) {
    sendError(msg.id, -32601, 'Method not found: ' + msg.method);
  }
}

function idIsEmpty(id) {
  return id === undefined || id === null;
}

function startStdio() {
  let buffer = Buffer.alloc(0);
  process.stderr.write('[heybox-dev-mcp] stdio ready\n');
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1 && /content-length:/i.test(buffer.slice(0, headerEnd).toString('utf8'))) {
        const header = buffer.slice(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const len = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + len) break;
        const body = buffer.slice(start, start + len).toString('utf8');
        buffer = buffer.slice(start + len);
        try {
          handleMessage(JSON.parse(body));
        } catch (err) {
          process.stderr.write('[heybox-dev-mcp] bad rpc: ' + err + '\n');
        }
        continue;
      }
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).toString('utf8').replace(/\r$/, '').trim();
      buffer = buffer.slice(nl + 1);
      if (!line || line[0] !== '{') continue;
      try {
        handleMessage(JSON.parse(line));
      } catch (err) {
        process.stderr.write('[heybox-dev-mcp] bad newline json: ' + err + '\n');
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

function isDirectRun() {
  try {
    const self = path.normalize(fileURLToPath(import.meta.url)).toLowerCase();
    const arg = path.normalize(path.resolve(process.argv[1] || '')).toLowerCase();
    return self === arg;
  } catch {
    return true;
  }
}

if (isDirectRun()) {
  startStdio();
}
