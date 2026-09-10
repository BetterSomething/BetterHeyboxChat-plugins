/**
 * 杂项修复：
 * 1. 语音包收藏显示修复（原 laughter-fav-fix）
 * 2. 输入/输出设备过多时，左下角设备菜单限制高度并可滚动
 * 3. 官方发评补上服务端新要求的 query `_rnd`（web 同款 HMAC，不改 body）
 *
 * 官方语音包平台收藏会 $emit('Refresh_User_Laughter')，由主界面 handleRefreshUserLaughter
 * 重新拉取 voice_packs。频道 IM 右键收藏只 commit SET_FAVORITE_VOICE_PACK_IDS，
 * 本插件在收藏与取消收藏后补发同一事件，不伪造协议。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'misc-fix';
  var STORAGE_KEY = 'settings';
  var AUDIO_CLASS = 'bhchat-misc-audio-list';
  var OFFICIAL_REFRESH_EVENT = 'Refresh_User_Laughter';
  var FAVORITE_IDS_MUTATION = 'SET_FAVORITE_VOICE_PACK_IDS';

  var DEFAULTS = {
    laughterFav: true,
    audioDeviceList: true,
    commentRnd: true,
  };

  var settings = {
    laughterFav: DEFAULTS.laughterFav,
    audioDeviceList: DEFAULTS.audioDeviceList,
    commentRnd: DEFAULTS.commentRnd,
  };

  var COMMENT_CREATE_RE = /\/bbs\/app\/comment\/create(?:\?|#|$)/i;
  var COMMENT_RND_KEY = 'Z7mFG4tQp9Ws2LxB8H';
  var lastCommentStatus = '等待发评…';
  var nodeCrypto = null;

  var storeNs = null;
  var hooked = false;
  var refreshTimer = null;
  var refreshing = false;
  var ignoreFavoriteUntil = 0;
  var lastStatus = '等待挂接客户端…';
  var lastRefreshAt = 0;
  var hookRetry = null;
  var storeUnsub = null;
  var origDispatch = null;
  var origCommit = null;
  var origEmit = null;
  var origFetch = null;
  var origXhrOpen = null;
  var origXhrSend = null;
  var hookedBus = null;
  var hookedStore = null;

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function applySettings(saved) {
    saved = saved && typeof saved === 'object' ? saved : {};
    var laughter =
      saved.laughterFav !== undefined ? saved.laughterFav : saved.enabled;
    settings = {
      laughterFav: laughter !== false,
      audioDeviceList: saved.audioDeviceList !== false,
      commentRnd: saved.commentRnd !== false,
    };
    return settings;
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) {
      settings = {
        laughterFav: DEFAULTS.laughterFav,
        audioDeviceList: DEFAULTS.audioDeviceList,
        commentRnd: DEFAULTS.commentRnd,
      };
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      if (saved && typeof saved === 'object') {
        applySettings(saved);
        return settings;
      }
      var oldNs =
        window.BHChat && window.BHChat.storage && window.BHChat.storage.ns
          ? window.BHChat.storage.ns('laughter-fav-fix')
          : null;
      if (!oldNs || typeof oldNs.get !== 'function') {
        applySettings({});
        return settings;
      }
      return oldNs.get(STORAGE_KEY).then(function (oldSaved) {
        applySettings(oldSaved && typeof oldSaved === 'object' ? oldSaved : {});
        return settings;
      });
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      laughterFav: !!settings.laughterFav,
      audioDeviceList: !!settings.audioDeviceList,
      commentRnd: !!settings.commentRnd,
    });
  }

  function applyAudioListFix() {
    var root = document.documentElement;
    if (!root || !root.classList) return;
    if (settings.audioDeviceList) root.classList.add(AUDIO_CLASS);
    else root.classList.remove(AUDIO_CLASS);
  }

  function getStore() {
    if (window.BHChat && window.BHChat.getStore) {
      return window.BHChat.getStore();
    }
    var app = document.getElementById('app');
    if (app && app.__vue__ && app.__vue__.$store) {
      return app.__vue__.$store;
    }
    return null;
  }

  function getClientBus() {
    var req = window.__bhchat_require__;
    var map = window.__bhchat_module_map__ || {};
    var id = map.EVENT_BUS;
    if (!req || !id) return null;
    try {
      if (!req.m || typeof req.m[id] !== 'function') return null;
      var mod = req(id);
      var bus = (mod && (mod.A || mod.default || mod)) || null;
      if (bus && typeof bus.$on === 'function') return bus;
    } catch (err) {
      return null;
    }
    return null;
  }

  function nameOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value.type === 'string') return value.type;
      if (typeof value.name === 'string') return value.name;
    }
    return String(value);
  }

  function isFavoriteIdsMutation(name) {
    return String(name || '') === FAVORITE_IDS_MUTATION;
  }

  function isOfficialRefreshEvent(name) {
    return String(name || '') === OFFICIAL_REFRESH_EVENT;
  }

  function isRefreshName(name) {
    name = String(name || '');
    if (isOfficialRefreshEvent(name)) return true;
    return (
      /(fetch|load|get|list|query|refresh|reload|update).*(laugh|voice.?pack|favorit|collect|收藏|语音包)/i.test(
        name,
      ) ||
      /(laugh|voice.?pack|favorit|collect|收藏|语音包).*(fetch|load|get|list|query|refresh|reload|update)/i.test(
        name,
      )
    );
  }

  function isCollectOrUncollectName(name) {
    name = String(name || '');
    if (isRefreshName(name) || isOfficialRefreshEvent(name)) return false;
    if (isFavoriteIdsMutation(name)) return true;
    return /(collect|uncollect|favorite|unfavorite|favour|star|收藏|取消收藏|add.*(laugh|voice)|remove.*(laugh|voice)|delete.*(laugh|voice)|laugh.*(add|collect|remove|delete)|voice.?pack.*(add|collect|remove|delete))/i.test(
      name,
    );
  }

  function isCollectUrl(url) {
    url = String(url || '');
    if (!url) return false;
    if (/(list|query|get_|\/get\b|\/list\b)/i.test(url) && !/collect|favorite|收藏|取消收藏/i.test(url)) {
      return false;
    }
    return /(laugh|voice.?pack|voice_pack|laughter|collect|uncollect|favorite|favour|收藏|取消收藏|语音包)/i.test(
      url,
    );
  }

  function isCollectPostUrl(url, method) {
    method = String(method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return false;
    return isCollectUrl(url);
  }

  function notifyToast(ok, text) {
    var api = window.toastAPI;
    if (!api) return;
    try {
      if (ok && typeof api.success === 'function') api.success(text);
      else if (!ok && typeof api.error === 'function') api.error(text);
      else if (typeof api.info === 'function') api.info(text);
    } catch (err) {}
  }

  function emitOfficialRefresh() {
    var bus = hookedBus || getClientBus();
    if (!bus || typeof bus.$emit !== 'function') return false;
    ignoreFavoriteUntil = Date.now() + 2500;
    try {
      bus.$emit(OFFICIAL_REFRESH_EVENT);
      return true;
    } catch (err) {
      return false;
    }
  }

  function refreshLists(reason, opts) {
    opts = opts || {};
    var force = !!opts.force;
    if (!force && !settings.laughterFav) return;
    if (refreshing) return;
    refreshing = true;
    lastRefreshAt = Date.now();
    var ok = emitOfficialRefresh();
    lastStatus = ok
      ? '已触发官方刷新（' + (reason || 'manual') + '）'
      : '未找到 EventBus，无法刷新收藏列表';
    if (force) notifyToast(ok, ok ? '已请求刷新收藏列表' : lastStatus);
    setTimeout(function () {
      refreshing = false;
    }, 1600);
  }

  function scheduleRefresh(reason) {
    if (!settings.laughterFav) return;
    if (isFavoriteIdsMutation(String(reason || '').split(':').pop()) && Date.now() < ignoreFavoriteUntil) {
      return;
    }
    if (Date.now() < ignoreFavoriteUntil && /vuex|commit|sub/i.test(String(reason || ''))) {
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshLists(reason);
    }, 280);
  }

  function wrapStore(store) {
    if (!store || hookedStore === store) return;
    hookedStore = store;
    if (typeof store.dispatch === 'function' && !store.dispatch.__bhchat_laughter) {
      origDispatch = store.dispatch.bind(store);
      store.dispatch = function (type) {
        var name = nameOf(type);
        var ret = origDispatch.apply(store, arguments);
        if (settings.laughterFav && isCollectOrUncollectName(name)) {
          Promise.resolve(ret)
            .then(function () {
              scheduleRefresh('vuex-dispatch:' + name);
            })
            .catch(function () {});
        }
        return ret;
      };
      store.dispatch.__bhchat_laughter = true;
    }
    if (typeof store.commit === 'function' && !store.commit.__bhchat_laughter) {
      origCommit = store.commit.bind(store);
      store.commit = function (type) {
        var name = nameOf(type);
        var ret = origCommit.apply(store, arguments);
        if (settings.laughterFav && isCollectOrUncollectName(name)) {
          scheduleRefresh('vuex-commit:' + name);
        }
        return ret;
      };
      store.commit.__bhchat_laughter = true;
    }
    if (typeof store.subscribe === 'function' && !storeUnsub) {
      storeUnsub = store.subscribe(function (mutation) {
        var name = mutation && mutation.type ? mutation.type : '';
        if (settings.laughterFav && isCollectOrUncollectName(name)) {
          scheduleRefresh('vuex-sub:' + name);
        }
      });
    }
  }

  function wrapBus(bus) {
    if (!bus || hookedBus === bus) return;
    hookedBus = bus;
    if (typeof bus.$emit === 'function' && !bus.$emit.__bhchat_laughter) {
      origEmit = bus.$emit.bind(bus);
      bus.$emit = function (event) {
        var name = nameOf(event);
        var ret = origEmit.apply(bus, arguments);
        if (settings.laughterFav && isCollectOrUncollectName(name) && !isOfficialRefreshEvent(name)) {
          scheduleRefresh('bus:' + name);
        }
        return ret;
      };
      bus.$emit.__bhchat_laughter = true;
    }
  }

  function getNodeCrypto() {
    if (nodeCrypto) return nodeCrypto;
    try {
      if (typeof require === 'function') {
        var crypto = require('crypto');
        if (crypto && typeof crypto.createHmac === 'function') {
          nodeCrypto = crypto;
          return nodeCrypto;
        }
      }
    } catch (err) {}
    return null;
  }

  function signCommentRnd(nonce, time) {
    var crypto = getNodeCrypto();
    if (!crypto) return '';
    var msg = COMMENT_RND_KEY + String(nonce) + String(time) + ':' + String(nonce);
    return crypto.createHmac('sha256', COMMENT_RND_KEY).update(msg, 'utf8').digest('hex');
  }

  function isCommentCreateUrl(url) {
    return COMMENT_CREATE_RE.test(String(url || ''));
  }

  function withCommentRnd(url) {
    var raw = String(url || '');
    if (!raw || !settings.commentRnd || !isCommentCreateUrl(raw)) return raw;
    if (/(?:^|[?&])_rnd=/.test(raw)) return raw;
    var nonce = '';
    var time = '';
    try {
      var parsed = new URL(raw, 'https://api.xiaoheihe.cn');
      nonce = parsed.searchParams.get('nonce') || '';
      time = parsed.searchParams.get('_time') || '';
    } catch (err) {
      return raw;
    }
    if (!nonce || !time) {
      lastCommentStatus = '评论请求缺少 nonce/_time，未补签名';
      return raw;
    }
    var hex = signCommentRnd(nonce, time);
    if (!hex) {
      lastCommentStatus = '当前环境没有 crypto，无法补签名';
      return raw;
    }
    lastCommentStatus = '已为评论请求补上签名';
    var sep = raw.indexOf('?') >= 0 ? '&' : '?';
    return raw + sep + '_rnd=' + encodeURIComponent('15:' + hex);
  }

  function wrapNetwork() {
    if (typeof window.fetch === 'function' && !window.fetch.__bhchat_laughter) {
      origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = '';
        var method = 'GET';
        if (typeof input === 'string') {
          url = withCommentRnd(input);
          if (url !== input) input = url;
        } else if (input && input.url) {
          url = withCommentRnd(input.url);
          if (url !== input.url) input = url;
        }
        if (init && init.method) method = init.method;
        else if (input && input.method) method = input.method;
        return origFetch.call(window, input, init).then(function (res) {
          if (settings.laughterFav && res && res.ok && isCollectPostUrl(url, method)) {
            scheduleRefresh('fetch');
          }
          return res;
        });
      };
      window.fetch.__bhchat_laughter = true;
    }
    if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__bhchat_laughter) {
      origXhrOpen = XMLHttpRequest.prototype.open;
      origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        var nextUrl = settings.commentRnd ? withCommentRnd(url) : url;
        this.__bhchat_laughter_method = method;
        this.__bhchat_laughter_url = nextUrl;
        if (arguments.length >= 2 && nextUrl !== url) arguments[1] = nextUrl;
        return origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        xhr.addEventListener('load', function () {
          if (
            settings.laughterFav &&
            xhr.status >= 200 &&
            xhr.status < 300 &&
            isCollectPostUrl(xhr.__bhchat_laughter_url, xhr.__bhchat_laughter_method)
          ) {
            scheduleRefresh('xhr');
          }
        });
        return origXhrSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype.__bhchat_laughter = true;
    }
  }

  function tryHook() {
    wrapNetwork();
    var store = getStore();
    if (store) wrapStore(store);
    var bus = getClientBus();
    if (bus) wrapBus(bus);
    if (store || bus) {
      hooked = true;
      lastStatus =
        '已挂接' +
        (store ? ' Vuex' : '') +
        (bus ? ' EventBus' : '') +
        '，等待收藏或取消收藏';
      return true;
    }
    return false;
  }

  function startHook() {
    if (tryHook()) return;
    var tries = 0;
    hookRetry = setInterval(function () {
      tries += 1;
      if (tryHook() || tries > 120) {
        clearInterval(hookRetry);
        hookRetry = null;
        if (!hooked) lastStatus = '未接到 Vuex / EventBus，收藏刷新暂不可用';
      }
    }, 500);
  }

  function laughterApi() {
    return {
      refresh: function () {
        refreshLists('manual', { force: true });
      },
      getStatus: function () {
        return lastStatus;
      },
      getSettings: function () {
        return { enabled: !!settings.laughterFav };
      },
    };
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.laughterFav = laughterApi();
    window.BHChat.miscFix = {
      getSettings: function () {
        return {
          laughterFav: !!settings.laughterFav,
          audioDeviceList: !!settings.audioDeviceList,
          commentRnd: !!settings.commentRnd,
        };
      },
      getStatus: function () {
        return lastStatus;
      },
      getCommentStatus: function () {
        return lastCommentStatus;
      },
      refreshLaughter: function () {
        refreshLists('manual', { force: true });
      },
    };
  }

  function toggleRow(h, label, on, onClick) {
    return h(
      'div',
      {
        class: 'row bhchat-row-click',
        on: { click: onClick },
      },
      [
        h('span', label),
        h('span', { class: { 'bhchat-switch': true, on: !!on } }, [
          h('span', { class: 'bhchat-switch-core' }),
        ]),
      ],
    );
  }

  function actionBtn(h, text, kind, onClick) {
    return h(
      'button',
      {
        class: {
          'bhchat-btn': true,
          'bhchat-btn-primary': kind === 'primary',
          'bhchat-btn-secondary': kind === 'secondary',
        },
        attrs: { type: 'button' },
        on: { click: onClick },
      },
      text,
    );
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatMiscFixPanel',
      data: function () {
        return {
          laughterFav: settings.laughterFav,
          audioDeviceList: settings.audioDeviceList,
          commentRnd: settings.commentRnd,
          status: lastStatus,
          commentStatus: lastCommentStatus,
        };
      },
      mounted: function () {
        var self = this;
        this.syncFromPlugin();
        this._timer = setInterval(function () {
          self.status = lastStatus;
          self.commentStatus = lastCommentStatus;
        }, 800);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        syncFromPlugin: function () {
          this.laughterFav = settings.laughterFav;
          this.audioDeviceList = settings.audioDeviceList;
          this.commentRnd = settings.commentRnd;
          this.status = lastStatus;
          this.commentStatus = lastCommentStatus;
        },
        persist: function () {
          settings.laughterFav = !!this.laughterFav;
          settings.audioDeviceList = !!this.audioDeviceList;
          settings.commentRnd = !!this.commentRnd;
          applyAudioListFix();
          saveSettings();
        },
        onToggleLaughter: function () {
          this.laughterFav = !this.laughterFav;
          this.persist();
        },
        onToggleAudio: function () {
          this.audioDeviceList = !this.audioDeviceList;
          this.persist();
        },
        onToggleCommentRnd: function () {
          this.commentRnd = !this.commentRnd;
          this.persist();
        },
        onRefresh: function () {
          refreshLists('manual', { force: true });
          this.status = lastStatus;
        },
      },
      render: function (h) {
        return h('div', [
          h('div', { class: 'cell-title' }, '语音包收藏显示修复'),
          h('div', { class: 'bhchat-list' }, [
            toggleRow(h, '收藏或取消收藏后立即刷新列表', this.laughterFav, this.onToggleLaughter),
          ]),
          h('p', { class: 'bhchat-hint' }, this.status),
          h('div', { class: 'bhchat-actions' }, [
            actionBtn(h, '立即刷新收藏列表', 'primary', this.onRefresh),
          ]),
          h('div', { class: 'cell-title' }, '音频设备列表'),
          h('div', { class: 'bhchat-list' }, [
            toggleRow(h, '设备过多时限制菜单高度并可滚动', this.audioDeviceList, this.onToggleAudio),
          ]),
          h(
            'p',
            { class: 'bhchat-hint' },
            '左下角输入/输出设备菜单不再撑出窗口，按键说话和音量会留在下面。',
          ),
          h('div', { class: 'cell-title' }, '官方评论'),
          h('div', { class: 'bhchat-list' }, [
            toggleRow(h, '发评时补上服务端要求的签名', this.commentRnd, this.onToggleCommentRnd),
          ]),
          h(
            'p',
            { class: 'bhchat-hint' },
            '桌面发评缺 query _rnd 会提示「缺失参数」。只改签名，不改正文。',
          ),
          h('p', { class: 'bhchat-hint' }, this.commentStatus),
        ]);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '杂项修复',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    loadSettings().then(function () {
      applyAudioListFix();
      registerApi();
      registerPanel();
      startHook();
      console.log('[BetterHeyboxChat] misc-fix plugin activated');
    });
  }

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  }
})();
