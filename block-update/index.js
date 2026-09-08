/**
 * 屏蔽客户端更新：阻断官方检查更新 API，检查失败则不弹窗。
 * 主进程 webRequest / IPC 兜底；不伪造更新协议、不改 bytenode。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'block-update';
  var STORAGE_KEY = 'settings';
  var CHECK_PATH = '/chatroom/v2/settings/version/update/check';
  var CONTENT_PATH = '/chatroom/v2/settings/version/content';

  var DEFAULTS = {
    blockClient: true,
    blockHotfix: true,
  };

  var settings = {
    blockClient: DEFAULTS.blockClient,
    blockHotfix: DEFAULTS.blockHotfix,
  };

  var storeNs = null;
  var lastStatus = '等待挂接…';
  var origFetch = null;
  var origXhrOpen = null;
  var origXhrSend = null;
  var origSendRequest = null;
  var hookedNet = false;

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) {
      settings = { blockClient: DEFAULTS.blockClient, blockHotfix: DEFAULTS.blockHotfix };
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      settings = {
        blockClient: saved.blockClient !== false,
        blockHotfix: saved.blockHotfix !== false,
      };
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      blockClient: !!settings.blockClient,
      blockHotfix: !!settings.blockHotfix,
    });
  }

  function writeFlags() {
    if (window.bhchatPreload && window.bhchatPreload.updateBlock) {
      return window.bhchatPreload.updateBlock.set({
        client: !!settings.blockClient,
        hotfix: !!settings.blockHotfix,
      });
    }
    return { client: !!settings.blockClient, hotfix: !!settings.blockHotfix };
  }

  function pluginActive() {
    return !(window.BHChat && window.BHChat.isPluginEnabled) || window.BHChat.isPluginEnabled(PLUGIN_ID);
  }

  function shouldBlockUrl(url) {
    var text = String(url || '');
    if (!pluginActive()) return false;
    if (text.indexOf(CHECK_PATH) === -1 && text.indexOf(CONTENT_PATH) === -1) return false;
    return !!(settings.blockClient || settings.blockHotfix);
  }

  function blockedError() {
    lastStatus = '已阻断官方检查更新接口';
    var err = new Error(lastStatus);
    err.name = 'BhchatUpdateBlocked';
    return err;
  }

  function wrapNetwork() {
    if (hookedNet) return true;
    if (typeof window.fetch === 'function' && !window.fetch.__bhchat_block) {
      origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = input && typeof input === 'object' && input.url != null ? input.url : input;
        if (shouldBlockUrl(url)) return Promise.reject(blockedError());
        return origFetch(input, init);
      };
      window.fetch.__bhchat_block = true;
    }
    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype && !window.XMLHttpRequest.prototype.open.__bhchat_block) {
      origXhrOpen = window.XMLHttpRequest.prototype.open;
      origXhrSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.open = function (method, url) {
        this.__bhchat_update_url = url;
        this.__bhchat_update_block = shouldBlockUrl(url);
        return origXhrOpen.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.open.__bhchat_block = true;
      window.XMLHttpRequest.prototype.send = function () {
        if (this.__bhchat_update_block && shouldBlockUrl(this.__bhchat_update_url)) {
          var xhr = this;
          setTimeout(function () {
            try {
              if (typeof xhr.dispatchEvent === 'function') {
                xhr.dispatchEvent(new Event('error'));
              }
              if (typeof xhr.onerror === 'function') xhr.onerror(blockedError());
            } catch (err) {}
          }, 0);
          return;
        }
        return origXhrSend.apply(this, arguments);
      };
    }
    var api = window.electronAPI;
    if (api && typeof api.sendRequest === 'function' && !api.sendRequest.__bhchat_block) {
      origSendRequest = api.sendRequest.bind(api);
      api.sendRequest = function (options) {
        var url = options && (options.url || options.uri || options.path);
        if (shouldBlockUrl(url)) return Promise.reject(blockedError());
        return origSendRequest(options);
      };
      api.sendRequest.__bhchat_block = true;
    }
    hookedNet = true;
    return true;
  }

  function describePatch(info) {
    if (!info) return '尚未拿到补丁状态（需 Debug 安装器重装后由 main-bridge 写入）';
    var repaired = info.repaired || [];
    var intact = info.intact || [];
    var missing = info.missing || [];
    if (repaired.length) return '本轮已补回：' + repaired.join('、');
    if (missing.length) return '缺失：' + missing.join('、') + '，请用安装器重装';
    if (intact.length) return '补丁完整（' + intact.join('、') + '）';
    return '补丁状态未知';
  }

  function refreshStatus() {
    var info = window.BHChat && window.BHChat.patch ? window.BHChat.patch.getStatus() : null;
    lastStatus =
      (settings.blockClient || settings.blockHotfix ? '检查更新：已阻断' : '检查更新：放行') +
      '；' +
      (settings.blockClient ? '完整更新：已屏蔽' : '完整更新：放行') +
      '；' +
      (settings.blockHotfix ? '热更新：已屏蔽' : '热更新：放行') +
      '。' +
      describePatch(info);
    return lastStatus;
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.blockUpdate = {
      getSettings: function () {
        return {
          blockClient: !!settings.blockClient,
          blockHotfix: !!settings.blockHotfix,
        };
      },
      getStatus: function () {
        return refreshStatus();
      },
      ensurePatch: function () {
        if (window.BHChat.patch && window.BHChat.patch.ensure) {
          return window.BHChat.patch.ensure();
        }
        return null;
      },
    };
  }

  function persist() {
    return saveSettings().then(function () {
      writeFlags();
      refreshStatus();
    });
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatBlockUpdatePanel',
      data: function () {
        return {
          blockClient: settings.blockClient,
          blockHotfix: settings.blockHotfix,
          status: lastStatus,
        };
      },
      mounted: function () {
        var self = this;
        this.syncFromPlugin();
        this._timer = setInterval(function () {
          self.status = lastStatus;
        }, 800);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        syncFromPlugin: function () {
          this.blockClient = settings.blockClient;
          this.blockHotfix = settings.blockHotfix;
          this.status = refreshStatus();
        },
        persist: function () {
          settings.blockClient = !!this.blockClient;
          settings.blockHotfix = !!this.blockHotfix;
          persist();
          this.status = lastStatus;
        },
        onToggleClient: function () {
          this.blockClient = !this.blockClient;
          this.persist();
        },
        onToggleHotfix: function () {
          this.blockHotfix = !this.blockHotfix;
          this.persist();
        },
        onEnsure: function () {
          var info =
            window.BHChat && window.BHChat.patch && window.BHChat.patch.ensure
              ? window.BHChat.patch.ensure()
              : null;
          this.status = describePatch(info);
          lastStatus = this.status;
        },
      },
      render: function (h) {
        function rowSwitch(label, on, onClick) {
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
        return h('div', [
          h('div', { class: 'bhchat-list' }, [
            rowSwitch('屏蔽完整客户端更新', this.blockClient, this.onToggleClient),
            rowSwitch('屏蔽热更新', this.blockHotfix, this.onToggleHotfix),
          ]),
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: { 'bhchat-btn': true, 'bhchat-btn-primary': true },
                attrs: { type: 'button' },
                on: { click: this.onEnsure },
              },
              '立即检查并修复补丁',
            ),
          ]),
          h('div', { class: 'bhchat-hint' }, this.status || ''),
        ]);
      },
    };
  }

  function activate() {
    loadSettings().then(function () {
      writeFlags();
      wrapNetwork();
      refreshStatus();
      registerApi();
      if (window.BHChat && window.BHChat.registerPanel) {
        window.BHChat.registerPanel({
          id: PLUGIN_ID,
          title: '屏蔽客户端更新',
          component: buildPanelComponent(),
        });
      }
      if (window.BHChat && window.BHChat.onClientUpdate) {
        window.BHChat.onClientUpdate(function () {
          refreshStatus();
        });
      }
    });
  }

  wrapNetwork();
  writeFlags();

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  } else {
    activate();
  }
})();
