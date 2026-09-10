/**
 * 内存优化：按档位做轻回收 / 归还工作集。
 * 策略在本插件；特权面走 BHChat.perf。不关硬件加速、覆盖层、AI 降噪。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'perf-tune';
  var STORAGE_KEY = 'settings';
  var LIGHT_INTERVAL_MS = 5 * 60 * 1000;
  var POLL_MS = 10 * 1000;
  var IDLE_B_MS = 5 * 60 * 1000;
  var IDLE_C_MS = 2 * 60 * 1000;
  var TRIM_GAP_MS = 60 * 1000;
  var MEM_POLL_MS = 2000;
  var MEM_BADGE_ID = 'bhchat-perf-mem';
  var OFFICIAL_CACHE_DEFAULT = {
    private_message_cache: 10,
    im_message_cache: 10,
    room_cache: 10,
  };
  var OFFICIAL_CACHE_LOW = {
    private_message_cache: 3,
    im_message_cache: 3,
    room_cache: 3,
  };

  var settings = { mode: 'A' };
  var lastStatus = '等待挂接…';
  var lastLightAt = 0;
  var lastTrimAt = 0;
  var lastInputAt = Date.now();
  var lastHidden = false;
  var pollTimer = null;
  var storeNs = null;
  var uncertain = false;
  var listenersBound = false;
  var memTimer = null;
  var memCurrentMb = 0;
  var memMaxMb = 0;
  var memMinMb = 0;

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function normalizeMode(mode) {
    var text = String(mode || 'A').toUpperCase();
    if (text === 'B' || text === 'C') return text;
    return 'A';
  }

  function pluginActive() {
    return !(window.BHChat && window.BHChat.isPluginEnabled) || window.BHChat.isPluginEnabled(PLUGIN_ID);
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve(settings);
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      settings = { mode: normalizeMode(saved.mode) };
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, { mode: settings.mode });
  }

  function perfApi() {
    return window.BHChat && window.BHChat.perf ? window.BHChat.perf : null;
  }

  function callPerf(method, arg) {
    var api = perfApi();
    if (!api || typeof api[method] !== 'function') {
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve(api[method](arg));
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  function mapState(keys) {
    if (!window.BHChat || typeof window.BHChat.mapState !== 'function') return {};
    return window.BHChat.mapState(keys) || {};
  }

  function findOfficialCacheApi() {
    var req = window.__bhchat_require__;
    if (typeof req !== 'function') return null;
    var installed = req.c;
    if (!installed || typeof installed !== 'object') return null;
    var ids = Object.keys(installed);
    for (var i = 0; i < ids.length; i++) {
      var exp = installed[ids[i]] && installed[ids[i]].exports;
      var api = exp && (exp.A || exp.default || exp);
      if (
        api &&
        typeof api.setLimit === 'function' &&
        typeof api.getLimit === 'function' &&
        api.cache_limit &&
        typeof api.cache_limit === 'object'
      ) {
        return api;
      }
    }
    return null;
  }

  function applyOfficialCache(mode) {
    var api = findOfficialCacheApi();
    if (!api) return false;
    var next = mode === 'B' || mode === 'C' ? OFFICIAL_CACHE_LOW : OFFICIAL_CACHE_DEFAULT;
    try {
      api.setLimit(next);
      return true;
    } catch (err) {
      return false;
    }
  }

  function readBusyState() {
    var store = window.BHChat && typeof window.BHChat.getStore === 'function' ? window.BHChat.getStore() : null;
    if (!store) {
      uncertain = true;
      return { inVoice: true, sharing: true, uncertain: true };
    }
    uncertain = false;
    var snap = mapState([
      'cur_channel_data',
      'rtc_connection',
      'channel_connecting',
      'my_screen_sharing',
      'screen_sharing_info',
    ]);
    var voice = snap.cur_channel_data || {};
    var inVoice = !!(
      (voice && voice.channel_id) ||
      snap.rtc_connection ||
      snap.channel_connecting
    );
    var sharing = !!(
      snap.my_screen_sharing ||
      (snap.screen_sharing_info && snap.screen_sharing_info.user_id)
    );
    return { inVoice: inVoice, sharing: sharing, uncertain: false };
  }

  function markInput() {
    lastInputAt = Date.now();
  }

  function idleMsFor(mode) {
    return mode === 'C' ? IDLE_C_MS : IDLE_B_MS;
  }

  function describeState(win, busy, didTrim, needsRestart) {
    if (needsRestart) return '启动开关将在重启后生效';
    if (busy.uncertain) return '判断不准，按使用中处理（只轻回收）';
    if (busy.inVoice) return '正在语音，不归还工作集';
    if (busy.sharing) return '正在共享，不归还工作集';
    if (didTrim) return '已归还工作集';
    if (win && win.visible && !win.minimized) return '窗口可见，只做轻回收';
    if (win && win.minimized) return '已最小化，等待闲置回收';
    if (win && !win.visible) return '托盘闲置，可归还工作集';
    return lastStatus || '已挂接';
  }

  function shouldTrim(mode, win, busy) {
    if (!pluginActive() || busy.uncertain || busy.inVoice || busy.sharing) return false;
    if (!win || win.ok === false) return false;
    var now = Date.now();
    if (lastTrimAt && now - lastTrimAt < TRIM_GAP_MS) return false;
    var tray = win.visible === false && !win.minimized;
    if (tray) return true;
    if (mode === 'A') return false;
    if (win.minimized) return true;
    return now - lastInputAt >= idleMsFor(mode);
  }

  function lightReclaim(force) {
    var now = Date.now();
    if (!force && lastLightAt && now - lastLightAt < LIGHT_INTERVAL_MS) {
      return Promise.resolve(null);
    }
    lastLightAt = now;
    return callPerf('lightReclaim').catch(function () {
      return null;
    });
  }

  function maybeTrim(mode, win, busy) {
    if (!shouldTrim(mode, win, busy)) return Promise.resolve(false);
    lastTrimAt = Date.now();
    return callPerf('trimWorkingSet')
      .then(function (result) {
        return !!(result && result.ok);
      })
      .catch(function () {
        return false;
      });
  }

  function tick() {
    if (!pluginActive()) return Promise.resolve();
    var busy = readBusyState();
    return callPerf('getWindowState')
      .then(function (win) {
        win = win || { visible: true, minimized: false, focused: true, ok: false };
        var hidden = typeof document !== 'undefined' && document.hidden;
        var enteredTray = hidden && !lastHidden && win.visible === false;
        lastHidden = hidden;
        var forceLight = enteredTray;
        return lightReclaim(forceLight).then(function () {
          return maybeTrim(settings.mode, win, busy).then(function (didTrim) {
            return callPerf('getStatus').then(function (status) {
              lastStatus = describeState(win, busy, didTrim, !!(status && status.needsRestart));
              return lastStatus;
            });
          });
        });
      })
      .catch(function () {
        lastStatus = '回收接口未就绪';
      });
  }

  function persistMode(mode) {
    settings.mode = normalizeMode(mode);
    applyOfficialCache(settings.mode);
    return saveSettings()
      .then(function () {
        return callPerf('setConfig', { enabled: true, mode: settings.mode });
      })
      .then(function () {
        return tick();
      });
  }

  function clearTimers() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (memTimer) {
      clearInterval(memTimer);
      memTimer = null;
    }
  }

  function readMemoryMb() {
    if (!window.BHChat || !window.BHChat.perf || typeof window.BHChat.perf.getMemory !== 'function') {
      return Promise.resolve(0);
    }
    return Promise.resolve(window.BHChat.perf.getMemory())
      .then(function (info) {
        if (!info || !info.ok || !info.workingSetKb) return 0;
        return Math.max(1, Math.round(Number(info.workingSetKb) / 1024));
      })
      .catch(function () {
        return 0;
      });
  }

  function indicatorShowing() {
    var ind = document.getElementById('bhchat-indicator');
    if (!ind) return false;
    if (window.BHChat && window.BHChat.indicator && typeof window.BHChat.indicator.isVisible === 'function') {
      return !!window.BHChat.indicator.isVisible();
    }
    return ind.style.display !== 'none';
  }

  function ensureMemBadge() {
    var el = document.getElementById(MEM_BADGE_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = MEM_BADGE_ID;
    document.documentElement.appendChild(el);
    return el;
  }

  function applyMemBadge() {
    var el = document.getElementById(MEM_BADGE_ID);
    if (!el || !pluginActive()) return;
    if (!memCurrentMb) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.bottom = indicatorShowing() ? '20px' : '5px';
    el.textContent = memCurrentMb + 'MB 高' + memMaxMb + ' 低' + memMinMb;
    el.title = '当前 ' + memCurrentMb + 'MB · 本次最高 ' + memMaxMb + 'MB · 本次最低 ' + memMinMb + 'MB';
  }

  function tickMemory() {
    return readMemoryMb().then(function (mb) {
      if (!mb) return;
      memCurrentMb = mb;
      if (!memMaxMb || mb > memMaxMb) memMaxMb = mb;
      if (!memMinMb || mb < memMinMb) memMinMb = mb;
      applyMemBadge();
    });
  }

  function startMemBadge() {
    ensureMemBadge();
    if (!memTimer) {
      tickMemory();
      memTimer = setInterval(tickMemory, MEM_POLL_MS);
    }
  }

  function stopMemBadge() {
    if (memTimer) {
      clearInterval(memTimer);
      memTimer = null;
    }
    var el = document.getElementById(MEM_BADGE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function stop() {
    clearTimers();
    stopMemBadge();
    applyOfficialCache('A');
  }

  function start() {
    clearTimers();
    applyOfficialCache(settings.mode);
    startMemBadge();
    if (!listenersBound) {
      listenersBound = true;
      ['pointerdown', 'keydown', 'wheel', 'mousemove'].forEach(function (name) {
        window.addEventListener(name, markInput, true);
      });
      document.addEventListener('visibilitychange', function () {
        tick();
      });
    }
    pollTimer = setInterval(tick, POLL_MS);
    tick();
  }

  function injectStyles() {
    if (!window.BHChat || typeof window.BHChat.injectCSS !== 'function') return;
    window.BHChat.injectCSS(
      [
        '.betterheyboxchat-setting-block .bhchat-radio{width:16px;height:16px;flex-shrink:0;box-sizing:border-box;border:2px solid var(--opacity-2,rgba(255,255,255,.16));border-radius:50%;position:relative}',
        '.betterheyboxchat-setting-block .bhchat-radio.on{border-color:var(--brand-text,#7dd95e)}',
        '.betterheyboxchat-setting-block .bhchat-radio.on:after{content:"";position:absolute;width:8px;height:8px;left:2px;top:2px;background:var(--brand-text,#7dd95e);border-radius:50%}',
        '#' + MEM_BADGE_ID + '{position:fixed;right:5px;bottom:20px;z-index:2147483646;padding:0 4px;height:13px;line-height:13px;border-radius:3px;text-align:center;font:8px/13px system-ui,sans-serif;font-weight:600;letter-spacing:.2px;color:#134e3a;background:#6ee7b7;opacity:.65;pointer-events:none;user-select:none;box-shadow:0 0 0 1px rgba(0,0,0,.15);white-space:nowrap}',
      ].join(''),
    );
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.perfTune = {
      getSettings: function () {
        return { mode: settings.mode };
      },
      getStatus: function () {
        return lastStatus;
      },
    };
  }

  function buildPanelComponent() {
    return {
      data: function () {
        return {
          mode: settings.mode,
          status: lastStatus,
          needsRestart: false,
          advanced: settings.mode !== 'A',
        };
      },
      mounted: function () {
        var self = this;
        this.syncFromPlugin();
        this._timer = setInterval(function () {
          self.status = lastStatus;
          self.mode = settings.mode;
        }, 800);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        syncFromPlugin: function () {
          var self = this;
          this.mode = settings.mode;
          this.advanced = settings.mode !== 'A';
          this.status = lastStatus;
          callPerf('getStatus').then(function (status) {
            self.needsRestart = !!(status && status.needsRestart);
            if (status && status.config && status.config.mode) {
              self.mode = normalizeMode(status.config.mode);
            }
          });
        },
        onSelect: function (mode) {
          var self = this;
          this.mode = normalizeMode(mode);
          persistMode(this.mode).then(function () {
            self.syncFromPlugin();
          });
        },
        onRestart: function () {
          if (window.BHChat && typeof window.BHChat.restart === 'function') {
            window.BHChat.restart();
          }
        },
      },
      render: function (h) {
        var self = this;
        function modeRow(id, title, desc) {
          var selected = self.mode === id;
          return h(
            'div',
            {
              class: 'row bhchat-row-click',
              on: {
                click: function () {
                  self.onSelect(id);
                },
              },
            },
            [
              h('span', [
                h('div', title),
                desc ? h('div', { class: 'bhchat-hint', style: { marginTop: '4px' } }, desc) : null,
              ]),
              h('span', { class: { 'bhchat-radio': true, on: selected } }),
            ],
          );
        }
        var rows = [
          modeRow('A', '稳妥（推荐）', '语音中只做轻回收，缩到托盘后启动轻量模式释放内存'),
        ];
        if (this.advanced || this.mode !== 'A') {
          rows.push(
            modeRow('B', '进阶', '1 档基础上，窗口最小化或 5 分钟未操作启动轻量模式释放内存'),
          );
          rows.push(
            modeRow(
              'C',
              '激进',
              '2 档基础上，闲置时间改为 2 分钟；可能导致覆盖层和屏幕共享出现不可预料的问题',
            ),
          );
        }
        var children = [
          h('div', { class: 'cell-title' }, '内存优化'),
          h('div', { class: 'bhchat-list' }, rows),
        ];
        if (!this.advanced && this.mode === 'A') {
          children.push(
            h('div', { class: 'bhchat-actions' }, [
              h(
                'button',
                {
                  class: { 'bhchat-btn': true, 'bhchat-btn-danger': true },
                  attrs: { type: 'button' },
                  on: {
                    click: function () {
                      self.advanced = true;
                    },
                  },
                },
                '显示高级档位',
              ),
            ]),
          );
        }
        if (this.needsRestart) {
          children.push(
            h('div', { class: 'bhchat-actions' }, [
              h(
                'button',
                {
                  class: { 'bhchat-btn': true, 'bhchat-btn-primary': true },
                  attrs: { type: 'button' },
                  on: { click: this.onRestart },
                },
                '立即重启使启动开关生效',
              ),
            ]),
          );
        }
        children.push(h('div', { class: 'bhchat-hint' }, this.status || ''));
        return h('div', children);
      },
    };
  }

  function activate() {
    loadSettings().then(function () {
      applyOfficialCache(settings.mode);
      return callPerf('setConfig', { enabled: pluginActive(), mode: settings.mode });
    }).then(function () {
      injectStyles();
      registerApi();
      if (window.BHChat && window.BHChat.registerPanel) {
        window.BHChat.registerPanel({
          id: PLUGIN_ID,
          title: '内存优化',
          component: buildPanelComponent(),
        });
      }
      if (pluginActive()) start();
      if (window.BHChat && window.BHChat.on) {
        window.BHChat.on('plugin-enabled-changed', function (info) {
          if (!info || info.id !== PLUGIN_ID) return;
          if (info.enabled) start();
          else stop();
        });
      }
    });
  }

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  } else {
    activate();
  }
})();
