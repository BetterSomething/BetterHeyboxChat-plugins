/**
 * 屏幕共享增强：共享画面上以弹幕显示房间文字消息，并可用弹幕输入框走官方发信通道发送。
 * 消息来源与 channel-tts 相同：EventBus SOCKET_SEND_MESSAGE / SOCKET_USER_IM_MESSAGE。
 * 共享状态以客户端真实入口为准：
 * - 发起：语音频道左下角面板「屏幕共享」→ cpt-screen-share-config-dialog
 * - 观看：成员卡「观看共享」/ 双击用户 → 官方 isWatching = Boolean(screen_sharing_info.user_id) + .cpt-screen-share-occupy
 * - 输入框挂官方 .screen-share-operate（在 .mid-operate 前），不在 occupy 底边另起一条
 * - 画中画：钩 requestPictureInPicture；Electron 用 canvas.captureStream 合成弹幕，其它环境可走 Document PiP
 * - 自己在共享：Vuex my_screen_sharing；预览 .cpt-screenshare-me-preview（可能被暂停）
 * - 弹幕只叠在 occupy / 自己的 preview 上，绝不挂到房间聊天主区
 * - 右上角官方 quality-block 旁显示 P2P / TRTC / 火山RTC
 * - 左下角 P2P/中转按钮走官方 $rtc，不自建 WebRTC
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'screen-share-danmaku';
  var STORAGE_KEY = 'settings';
  var EXTRACT_FILE = 'extract.js';
  var LAYER_ID = 'bhchat-ss-danmaku-layer';
  var MODE_ID = 'bhchat-ss-mode-block';
  var ROUTE_ID = 'bhchat-ss-route-toggle';
  var BUS_EVENTS = ['SOCKET_SEND_MESSAGE', 'SOCKET_USER_IM_MESSAGE'];

  var RECEIVE_PRIVATE = 1;
  var RECEIVE_AUDIO_CHANNEL = 2;
  var RECEIVE_TEXT_CHANNEL = 3;
  var RECEIVE_CHAT_GROUP = 5;
  var RECEIVE_GLOBAL_TEAM = 6;

  var SPEAKABLE_TYPES = {
    text: true,
    pure_text: true,
    html: true,
    markdown: true,
    textAndImg: true,
    AtOrChannel: true,
    1: true,
    2: true,
    4: true,
    6: true,
    10: true,
  };

  var SKIP_TYPES = {
    sticker: true,
    img: true,
    uploadFile: true,
    teamCard: true,
    teamInvite: true,
    channelAnc: true,
    bot: true,
    teamCardV2: true,
    welcomeMsg: true,
    cdKey: true,
    postComment: true,
    post: true,
    vote: true,
    voteAnc: true,
    customCard: true,
    punishNotify: true,
    fight: true,
    miniProgram: true,
    miniProDetail: true,
    screenShareGift: true,
    3: true,
    5: true,
    7: true,
    8: true,
    9: true,
    11: true,
  };

  var DEFAULTS = {
    overlay: true,
    input: true,
    showName: true,
    showMode: true,
    showRouteToggle: true,
    preferP2P: true,
    opacity: 0.92,
    speed: 8,
  };

  var settings = {
    overlay: DEFAULTS.overlay,
    input: DEFAULTS.input,
    showName: DEFAULTS.showName,
    showMode: DEFAULTS.showMode,
    showRouteToggle: DEFAULTS.showRouteToggle,
    preferP2P: DEFAULTS.preferP2P,
    opacity: DEFAULTS.opacity,
    speed: DEFAULTS.speed,
  };

  var storeNs = null;
  var seenKeys = {};
  var seenCount = 0;
  var hookedBus = null;
  var busRetry = null;
  var unwatchShare = null;
  var shareObserver = null;
  var layerEl = null;
  var trackEl = null;
  var formEl = null;
  var inputEl = null;
  var pipWindow = null;
  var pipVideo = null;
  var pipTrackEl = null;
  var pipHooked = false;
  var origRequestPip = null;
  var origExitPip = null;
  var pipCanvasActive = false;
  var pipCanvas = null;
  var pipHiddenVideo = null;
  var pipRaf = 0;
  var pipItems = [];
  var lastShare = false;
  var lastStatus = '等待屏幕共享…';
  var lastModeLabel = '';
  var routeBusy = false;
  var chromeMutating = false;
  var observerQueued = false;
  var modeEl = null;
  var routeEl = null;
  var trackRows = [0, 0, 0, 0, 0, 0, 0, 0];

  function clamp(n, min, max) {
    n = Number(n);
    if (isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      overlay: raw.overlay !== false,
      input: raw.input !== false,
      showName: raw.showName !== false,
      showMode: raw.showMode !== false,
      showRouteToggle: raw.showRouteToggle !== false,
      preferP2P: raw.preferP2P !== false,
      opacity: clamp(raw.opacity != null ? raw.opacity : DEFAULTS.opacity, 0.3, 1),
      speed: clamp(raw.speed != null ? raw.speed : DEFAULTS.speed, 4, 16),
    };
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) {
      settings = normalizeSettings(DEFAULTS);
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      settings = normalizeSettings(saved);
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      overlay: !!settings.overlay,
      input: !!settings.input,
      showName: !!settings.showName,
      showMode: !!settings.showMode,
      showRouteToggle: !!settings.showRouteToggle,
      preferP2P: !!settings.preferP2P,
      opacity: settings.opacity,
      speed: settings.speed,
    });
  }

  function mapState(keys) {
    if (window.BHChat && window.BHChat.mapState) {
      return window.BHChat.mapState(keys) || {};
    }
    return {};
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

  function getVueRoot() {
    var app = document.getElementById('app');
    return (app && app.__vue__) || null;
  }

  function fallbackExtract() {
    return {
      modeLabel: function (transport, apiType) {
        var t = String(transport || '').toLowerCase();
        if (t === 'p2p') return 'P2P';
        if (t === 'switching') return '切换中';
        var api = String(apiType || '').toLowerCase();
        if (api === 'trtc') return 'TRTC';
        if (api === 'volc') return '火山RTC';
        return '中转';
      },
      isP2P: function (transport) {
        return String(transport || '').toLowerCase() === 'p2p';
      },
      canUseP2P: function (p2pEnabled, memberCount) {
        return p2pEnabled === true && Number(memberCount) === 2;
      },
      p2pUnavailableReason: function (p2pEnabled, memberCount) {
        if (p2pEnabled !== true) return '当前房间未开启 P2P';
        if (Number(memberCount) !== 2) return 'P2P 仅支持两人频道';
        return '';
      },
      toggleTarget: function (transport) {
        return String(transport || '').toLowerCase() === 'p2p' ? 'commercial' : 'p2p';
      },
    };
  }

  function getExtract() {
    return window.BhchatScreenShareDanmaku || fallbackExtract();
  }

  function readPluginFile(rel) {
    var preload = window.bhchatPreload && window.bhchatPreload.plugins;
    if (preload && typeof preload.readUserFile === 'function') {
      try {
        var fromPreload = preload.readUserFile(PLUGIN_ID, rel);
        if (fromPreload) return fromPreload;
      } catch (err) {
        /* ignore */
      }
    }
    if (window.BHChat && window.BHChat.plugins && typeof window.BHChat.plugins.readUserFile === 'function') {
      try {
        return window.BHChat.plugins.readUserFile(PLUGIN_ID, rel) || '';
      } catch (err2) {
        return '';
      }
    }
    return '';
  }

  function injectUserScript(rel) {
    var code = readPluginFile(rel);
    if (!code) return false;
    var script = document.createElement('script');
    script.text = typeof code === 'string' ? code : String(code);
    script.setAttribute('data-bhchat-plugin-file', PLUGIN_ID + '/' + rel);
    document.head.appendChild(script);
    return true;
  }

  function getRtc() {
    var vue = getVueRoot();
    if (vue && vue.$rtc) return vue.$rtc;
    if (vue && vue.$root && vue.$root.$rtc) return vue.$root.$rtc;
    return null;
  }

  function notifyToast(ok, text) {
    var api = window.toastAPI;
    if (!api || !text) return;
    try {
      if (ok && typeof api.success === 'function') api.success(text);
      else if (!ok && typeof api.error === 'function') api.error(text);
      else if (typeof api.info === 'function') api.info(text);
    } catch (err) {}
  }

  function unique(list) {
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) {
        seen[list[i]] = true;
        out.push(list[i]);
      }
    }
    return out;
  }

  function pushId(list, value) {
    if (value != null && value !== '') list.push(String(value));
  }

  function currentScope() {
    var snap = mapState([
      'cur_room_data',
      'cur_text_channel_data',
      'cur_channel_data',
      'channel_data',
      'channelIMId',
      'user_info',
    ]);
    var room = snap.cur_room_data || null;
    var channelIds = [];
    pushId(channelIds, snap.channelIMId);
    if (snap.channel_data && snap.channel_data.channel_id != null) {
      pushId(channelIds, snap.channel_data.channel_id);
    }
    if (snap.cur_text_channel_data && snap.cur_text_channel_data.channel_id != null) {
      pushId(channelIds, snap.cur_text_channel_data.channel_id);
    }
    if (snap.cur_channel_data && snap.cur_channel_data.channel_id != null) {
      pushId(channelIds, snap.cur_channel_data.channel_id);
    }
    return {
      roomId: room && room.room_id != null ? String(room.room_id) : '',
      channelIds: unique(channelIds),
      userId: snap.user_info && snap.user_info.user_id != null ? String(snap.user_info.user_id) : '',
    };
  }

  function looksLikeIm(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (
      obj.channel_id != null ||
      obj.im_seq != null ||
      obj.msg_id != null ||
      obj.receive_type != null ||
      typeof obj.msg === 'string' ||
      typeof obj.text === 'string'
    );
  }

  function unwrapMsg(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (looksLikeIm(payload)) return payload;
    if (payload.data && looksLikeIm(payload.data)) return payload.data;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    return payload;
  }

  function msgKey(msg) {
    if (!msg) return '';
    if (msg.msg_id != null && msg.msg_id !== '') return 'id:' + msg.msg_id;
    if (msg.im_seq != null && msg.im_seq !== '') return 'im:' + msg.im_seq;
    if (msg.sequence != null && msg.sequence !== '') return 'seq:' + msg.sequence;
    return [
      msg.room_id || '',
      msg.channel_id || '',
      msg.user_id || '',
      msg.msg || msg.text || '',
      msg.timestamp || msg.time || msg.send_time || '',
    ].join('|');
  }

  function remember(key) {
    if (!key) return false;
    if (seenKeys[key]) return false;
    seenKeys[key] = true;
    seenCount += 1;
    if (seenCount > 400) {
      seenKeys = {};
      seenCount = 0;
      seenKeys[key] = true;
      seenCount = 1;
    }
    return true;
  }

  function decodeHtml(text) {
    return String(text)
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripMarkup(text) {
    text = String(text || '');
    text = text.replace(/<img[\s\S]*?(?:>|\/>)/gi, '');
    text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    text = text.replace(/\[custom[^\]]*\]/g, '');
    text = text.replace(/\[表情\]/g, '');
    text = text.replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]+>/g, '');
    text = decodeHtml(text);
    return text.replace(/\s+/g, ' ').trim();
  }

  function isSpeakableType(msg) {
    var type = msg && msg.msg_type;
    if (type == null || type === '') return true;
    if (SKIP_TYPES[type]) return false;
    if (SPEAKABLE_TYPES[type]) return true;
    return true;
  }

  function extractText(msg) {
    if (!msg || msg.updated || msg.is_revoke) return '';
    if (!isSpeakableType(msg)) return '';
    var raw = msg.msg != null ? msg.msg : msg.text;
    if (typeof raw !== 'string') raw = '';
    return stripMarkup(raw);
  }

  function extractName(msg) {
    return (
      msg.room_nickname ||
      msg.nickname ||
      msg.username ||
      msg.user_name ||
      '有人'
    );
  }

  function receiveTypeNum(msg) {
    if (!msg || msg.receive_type == null || msg.receive_type === '') return null;
    var n = Number(msg.receive_type);
    return isNaN(n) ? null : n;
  }

  function isRoomTextMsg(msg, scope) {
    if (!msg || !scope) return false;
    var receiveType = receiveTypeNum(msg);
    if (
      receiveType === RECEIVE_PRIVATE ||
      receiveType === RECEIVE_CHAT_GROUP ||
      receiveType === RECEIVE_GLOBAL_TEAM
    ) {
      return false;
    }
    if (msg.room_id != null && scope.roomId && String(msg.room_id) !== scope.roomId) {
      return false;
    }
    return true;
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

  function getShareSnapshot() {
    return mapState(['screen_sharing_info', 'my_screen_sharing', 'screen_share_cpt_height']);
  }

  // 与官方 ScreenShareOccupy.isWatching / utils.hz 一致：只认 user_id。
  // 默认值是 {}；停看时 SET_SCREEN_SHARING_INFO({})，不能把任意非空对象当成正在观看。
  function isSharingInfoActive(info) {
    return !!(info && info.user_id);
  }

  function pickLargest(nodeList, minW, minH) {
    minW = minW || 40;
    minH = minH || 40;
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < nodeList.length; i++) {
      var el = nodeList[i];
      var w = el.offsetWidth || 0;
      var h = el.offsetHeight || 0;
      if (w < minW || h < minH) continue;
      var area = w * h;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best;
  }

  function findShareHost() {
    var snap = getShareSnapshot();
    if (isSharingInfoActive(snap.screen_sharing_info)) {
      var occupy = pickLargest(document.querySelectorAll('.cpt-screen-share-occupy'), 80, 80);
      if (occupy) return occupy;
    }
    if (snap.my_screen_sharing) {
      var preview = pickLargest(document.querySelectorAll('.cpt-screenshare-me-preview'), 80, 80);
      if (preview) return preview;
      var block = pickLargest(document.querySelectorAll('.screen-block, [id^="screen-block-"]'), 80, 80);
      if (block) {
        var previewParent = block.closest
          ? block.closest('.cpt-screenshare-me-preview, .cpt-screen-share-occupy')
          : null;
        if (previewParent && previewParent.offsetWidth >= 80 && previewParent.offsetHeight >= 80) {
          return previewParent;
        }
      }
    }
    return null;
  }

  function findShareWrapper() {
    var wrap = document.querySelector('.cpt-screen-share-wrapper');
    if (wrap) return wrap;
    var host = findShareHost();
    if (host && host.closest) {
      var parent = host.closest('.cpt-screen-share-wrapper');
      if (parent) return parent;
    }
    return host;
  }

  function getTransportSnapshot() {
    var snap = mapState([
      'screen_share_transport',
      'screen_share_p2p_route',
      'screen_share_p2p_enabled',
      'cur_channel_data',
      'my_screen_sharing',
      'screen_sharing_info',
    ]);
    var channel = snap.cur_channel_data || {};
    var members = channel.members;
    return {
      transport: snap.screen_share_transport || '',
      route: snap.screen_share_p2p_route || '',
      p2pEnabled: snap.screen_share_p2p_enabled === true,
      apiType: channel.api_type || channel.rtc_api_type || '',
      memberCount: Array.isArray(members) ? members.length : 0,
      mySharing: !!snap.my_screen_sharing,
      watching: isSharingInfoActive(snap.screen_sharing_info),
    };
  }

  function currentShareRole(snap) {
    snap = snap || getTransportSnapshot();
    if (snap.mySharing) return 'sharer';
    if (snap.watching) return 'viewer';
    return '';
  }

  function isPipSharing() {
    return !!(pipCanvasActive || pipTrackEl || (pipWindow && !pipWindow.closed));
  }

  function isScreenSharing() {
    if (isPipSharing()) return true;
    return !!findShareHost();
  }

  function injectStyles() {
    if (!window.BHChat || !window.BHChat.injectCSS) return;
    window.BHChat.injectCSS(
      '#' +
        LAYER_ID +
        '{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:99999}' +
        '#' +
        LAYER_ID +
        ' .bhchat-ss-track{position:absolute;inset:0;overflow:hidden;pointer-events:none}' +
        '#' +
        LAYER_ID +
        ' .bhchat-ss-item{position:absolute;left:100%;white-space:nowrap;font-size:18px;line-height:24px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.55);will-change:transform}' +
        '#' +
        LAYER_ID +
        ' .bhchat-ss-item .name{opacity:.85;margin-right:6px}' +
        '.bhchat-ss-form{display:flex;align-items:center;gap:6px;flex:1 1 160px;min-width:132px;max-width:280px;margin:0 8px 6px;pointer-events:auto;z-index:10}' +
        '.bhchat-ss-form input{flex:1;min-width:0;height:28px;border:none;border-radius:6px;padding:0 10px;background:rgba(255,255,255,.14);color:#fff;font-size:13px;outline:none}' +
        '.bhchat-ss-form button{height:28px;padding:0 10px;border:none;border-radius:6px;background:var(--brand-fill,#2d7d46);color:#fff;font-weight:700;cursor:pointer;flex-shrink:0}' +
        '.cpt-screen-share-wrapper .screen-share-operate.bhchat-ss-form-focus{opacity:1}' +
        '.cpt-screen-share-wrapper .quality-block[data-bhchat-mode]{width:auto!important;min-width:142px!important;overflow:visible!important;justify-content:flex-start!important}' +
        '.cpt-screen-share-wrapper .quality-block[data-bhchat-mode]::after{display:none!important}' +
        '.cpt-screen-share-wrapper .quality-block[data-bhchat-mode]::before{content:attr(data-bhchat-mode);flex:0 0 auto;min-width:52px;padding:0 6px;font:500 12px/18px Roboto,"Microsoft YaHei",sans-serif;text-align:center;color:#75ef7d;-webkit-text-fill-color:#75ef7d;box-shadow:inset -1px 0 0 rgba(255,255,255,.08)}' +
        '.cpt-screen-share-wrapper .quality-block[data-bhchat-mode]>div:first-child{box-shadow:inset -1px 0 0 rgba(255,255,255,.08)}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle{display:flex;align-items:center;height:24px;margin-right:8px;flex-shrink:0;position:static;left:auto;bottom:auto;padding:0;border:none;border-radius:0;background:transparent;pointer-events:auto;user-select:none;z-index:10}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle button{height:24px;padding:0 8px;border:none;border-radius:4px;background:transparent;color:rgba(255,255,255,.5);font-size:12px;font-weight:500;cursor:pointer}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle button:hover{color:#fff}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle button.active{color:var(--brand-text,#7dd95e);background:transparent}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle button:disabled{opacity:.55;cursor:wait}' +
        '.cpt-screen-share-wrapper .screen-share-operate .bhchat-ss-route-toggle button.dim{opacity:.45}',
    );
  }

  function findOperateHost() {
    return (
      document.querySelector('.cpt-screen-share-wrapper .screen-share-operate') ||
      document.querySelector('.screen-share-operate')
    );
  }

  function removeLayer() {
    if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl);
    layerEl = null;
    trackEl = null;
  }

  function removeForm() {
    if (formEl && formEl.parentNode) formEl.parentNode.removeChild(formEl);
    formEl = null;
    inputEl = null;
  }

  function findOfficialQuality() {
    return document.querySelector('.cpt-screen-share-wrapper .quality-block');
  }

  function findLeftOperate() {
    var operate = findOperateHost();
    return (operate && operate.querySelector('.left-operate')) || null;
  }

  function isOfficialMenuShown() {
    var operate = findOperateHost();
    if (operate && operate.classList.contains('show')) return true;
    var store = getStore();
    return !!(store && store.getters && store.getters.is_show_screen_share_menu);
  }

  function clearQualityMode(el) {
    if (!el) return;
    el.removeAttribute('data-bhchat-mode');
    el.style.removeProperty('width');
    el.style.removeProperty('min-width');
    el.style.removeProperty('overflow');
    el.classList.remove('bhchat-ss-has-mode', 'is-p2p-mode');
  }

  function removeModeBlock() {
    clearQualityMode(findOfficialQuality());
    var leftover = document.getElementById(MODE_ID);
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    modeEl = null;
    lastModeLabel = '';
  }

  function removeRouteToggle() {
    if (routeEl && routeEl.parentNode) routeEl.parentNode.removeChild(routeEl);
    routeEl = null;
  }

  function removeChrome() {
    removeModeBlock();
    removeRouteToggle();
  }

  function ensureLayer() {
    var host = findShareHost();
    if (!host) return null;
    if (layerEl && layerEl.parentNode === host) return layerEl;
    if (layerEl && layerEl.parentNode) layerEl.parentNode.removeChild(layerEl);
    var cs = window.getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    layerEl = document.createElement('div');
    layerEl.id = LAYER_ID;
    trackEl = document.createElement('div');
    trackEl.className = 'bhchat-ss-track';
    layerEl.appendChild(trackEl);
    host.appendChild(layerEl);
    return layerEl;
  }

  function ensureForm() {
    var host = findOperateHost();
    if (!host) return null;
    if (formEl && formEl.parentNode === host) return formEl;
    if (formEl && formEl.parentNode) formEl.parentNode.removeChild(formEl);
    formEl = document.createElement('form');
    formEl.className = 'bhchat-ss-form';
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      submitInput();
    });
    formEl.addEventListener('focusin', function () {
      var op = formEl.closest('.screen-share-operate');
      if (op) op.classList.add('show', 'bhchat-ss-form-focus');
    });
    formEl.addEventListener('focusout', function () {
      var op = formEl.closest('.screen-share-operate');
      if (op) op.classList.remove('bhchat-ss-form-focus');
    });
    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 200;
    inputEl.placeholder = '发送弹幕';
    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = '发送';
    formEl.appendChild(inputEl);
    formEl.appendChild(btn);
    var mid = host.querySelector('.mid-operate');
    if (mid && mid.parentNode === host) host.insertBefore(formEl, mid);
    else host.appendChild(formEl);
    return formEl;
  }

  function ensureModeBlock() {
    var leftover = document.getElementById(MODE_ID);
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    var official = findOfficialQuality();
    if (!official) {
      modeEl = null;
      return null;
    }
    modeEl = official;
    return modeEl;
  }

  function ensureRouteToggle() {
    var host = findLeftOperate() || findOperateHost();
    if (!host) return null;
    if (routeEl && routeEl.parentNode === host) return routeEl;
    var existing = document.getElementById(ROUTE_ID);
    if (routeEl && routeEl.parentNode) routeEl.parentNode.removeChild(routeEl);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    routeEl = document.createElement('div');
    routeEl.id = ROUTE_ID;
    routeEl.className = 'bhchat-ss-route-toggle';
    var p2pBtn = document.createElement('button');
    p2pBtn.type = 'button';
    p2pBtn.setAttribute('data-target', 'p2p');
    p2pBtn.textContent = 'P2P';
    var relayBtn = document.createElement('button');
    relayBtn.type = 'button';
    relayBtn.setAttribute('data-target', 'commercial');
    relayBtn.textContent = '中转';
    p2pBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      switchShareRoute('p2p');
    });
    relayBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      switchShareRoute('commercial');
    });
    routeEl.appendChild(p2pBtn);
    routeEl.appendChild(relayBtn);
    host.insertBefore(routeEl, host.firstChild);
    return routeEl;
  }

  function updateModeBlock() {
    if (!settings.showMode) {
      removeModeBlock();
      return;
    }
    if (!ensureModeBlock()) return;
    var snap = getTransportSnapshot();
    var extract = getExtract();
    var label = extract.modeLabel(snap.transport, snap.apiType);
    lastModeLabel = label;
    if (modeEl.getAttribute('data-bhchat-mode') !== label) {
      modeEl.setAttribute('data-bhchat-mode', label);
    }
    if (modeEl.style.getPropertyValue('min-width') !== '142px') {
      modeEl.style.setProperty('width', 'auto', 'important');
      modeEl.style.setProperty('min-width', '142px', 'important');
      modeEl.style.setProperty('overflow', 'visible', 'important');
    }
  }

  function updateRouteToggle() {
    if (!settings.showRouteToggle) {
      removeRouteToggle();
      return;
    }
    if (!ensureRouteToggle()) return;
    var snap = getTransportSnapshot();
    var extract = getExtract();
    var onP2P = extract.isP2P(snap.transport);
    var switching = String(snap.transport || '').toLowerCase() === 'switching';
    var canP2P = extract.canUseP2P(snap.p2pEnabled, snap.memberCount);
    var buttons = routeEl.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var target = btn.getAttribute('data-target');
      btn.classList.toggle('active', (target === 'p2p' && onP2P) || (target === 'commercial' && !onP2P && !switching));
      btn.classList.toggle('dim', target === 'p2p' && !onP2P && !canP2P);
      btn.disabled = routeBusy || switching;
    }
    routeEl.title = canP2P
      ? '切换 P2P 直连或商业 RTC 中转'
      : extract.p2pUnavailableReason(snap.p2pEnabled, snap.memberCount) || '切换 P2P / 中转';
  }

  function enforcePreferRelay(snap) {
    if (settings.preferP2P) return;
    snap = snap || getTransportSnapshot();
    if (!getExtract().isP2P(snap.transport)) return;
    switchShareRoute('commercial', { silent: true });
  }

  function switchShareRoute(target, opts) {
    opts = opts || {};
    if (routeBusy) return;
    var snap = getTransportSnapshot();
    var extract = getExtract();
    if (target === 'p2p') {
      var reason = extract.p2pUnavailableReason(snap.p2pEnabled, snap.memberCount);
      if (reason) {
        lastStatus = reason;
        if (!opts.silent) notifyToast(false, reason);
        updateRouteToggle();
        return;
      }
      if (extract.isP2P(snap.transport)) return;
      settings.preferP2P = true;
      saveSettings();
      var rtcUp = getRtc();
      if (!rtcUp || typeof rtcUp.tryP2PReupgrade !== 'function') {
        lastStatus = '未找到官方 P2P 入口';
        if (!opts.silent) notifyToast(false, lastStatus);
        return;
      }
      routeBusy = true;
      updateRouteToggle();
      Promise.resolve(rtcUp.tryP2PReupgrade())
        .then(function () {
          lastStatus = '已请求切换到 P2P';
        })
        .catch(function (err) {
          lastStatus = '切换 P2P 失败';
          if (!opts.silent) notifyToast(false, (err && err.message) || lastStatus);
        })
        .then(function () {
          routeBusy = false;
          syncChrome();
        });
      return;
    }
    var current = String(snap.transport || '').toLowerCase();
    if (current !== 'p2p' && current !== 'switching') {
      settings.preferP2P = false;
      saveSettings();
      return;
    }
    settings.preferP2P = false;
    saveSettings();
    var rtc = getRtc();
    if (!rtc) {
      lastStatus = '未找到官方屏幕共享入口';
      if (!opts.silent) notifyToast(false, lastStatus);
      return;
    }
    if (typeof rtc.cancelScheduledP2PReupgrade === 'function') {
      rtc.cancelScheduledP2PReupgrade();
    }
    if (typeof rtc.cancelP2PUpgrade !== 'function') {
      lastStatus = '当前客户端不支持切换中转';
      if (!opts.silent) notifyToast(false, lastStatus);
      return;
    }
    routeBusy = true;
    updateRouteToggle();
    Promise.resolve(rtc.cancelP2PUpgrade(currentShareRole(snap) || 'viewer', 'user_stop'))
      .then(function () {
        lastStatus = '已切换到中转';
      })
      .catch(function (err) {
        lastStatus = '切换中转失败';
        if (!opts.silent) notifyToast(false, (err && err.message) || lastStatus);
      })
      .then(function () {
        routeBusy = false;
        syncChrome();
      });
  }

  function syncChrome() {
    if (chromeMutating) return;
    chromeMutating = true;
    try {
      var sharing = isScreenSharing();
      if (!sharing) {
        removeChrome();
        return;
      }
      updateModeBlock();
      updateRouteToggle();
      enforcePreferRelay();
    } finally {
      chromeMutating = false;
    }
  }

  function isShareVideo(video) {
    if (!video || video.nodeName !== 'VIDEO') return false;
    if (video.closest) {
      if (
        video.closest('.cpt-screen-share-wrapper') ||
        video.closest('.cpt-screen-share-occupy') ||
        video.closest('.cpt-screenshare-me-preview') ||
        video.closest('.screen-block')
      ) {
        return true;
      }
    }
    var id = video.id || (video.parentElement && video.parentElement.id) || '';
    return id.indexOf('screen-block') >= 0;
  }

  function pipItemCss() {
    return (
      '.bhchat-ss-item{position:absolute;left:100%;white-space:nowrap;font-size:18px;line-height:24px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.55)}' +
      '.bhchat-ss-item .name{opacity:.85;margin-right:6px}' +
      '.bhchat-ss-track{position:absolute;inset:0;overflow:hidden;pointer-events:none}'
    );
  }

  function closeDocumentPip() {
    if (!pipWindow && !pipVideo) return;
    var video = pipVideo;
    var win = pipWindow;
    pipWindow = null;
    pipVideo = null;
    pipTrackEl = null;
    if (win && !win.closed) {
      try {
        win.close();
      } catch (err) {}
    }
    if (video) {
      try {
        video.dispatchEvent(new Event('leavepictureinpicture'));
      } catch (err) {}
    }
  }

  function stopCanvasPip() {
    pipCanvasActive = false;
    if (pipRaf) {
      cancelAnimationFrame(pipRaf);
      pipRaf = 0;
    }
    if (pipHiddenVideo && pipHiddenVideo.parentNode) {
      pipHiddenVideo.parentNode.removeChild(pipHiddenVideo);
    }
    pipHiddenVideo = null;
    pipCanvas = null;
    pipItems = [];
  }

  function pushPipItem(name, text) {
    var label = settings.showName ? name + ': ' + text : text;
    var width = Math.max(48, label.length * 14);
    if (pipCanvas) {
      var measure = pipCanvas.getContext('2d');
      if (measure) {
        measure.font = '700 18px "Microsoft YaHei","Segoe UI",sans-serif';
        width = measure.measureText(label).width || width;
      }
    }
    pipItems.push({
      label: label,
      start: (window.performance && performance.now()) || Date.now(),
      duration: clamp(settings.speed, 4, 16) * 1000,
      row: pickRow(),
      width: width,
    });
  }

  function openCanvasPip(video) {
    if (typeof origRequestPip !== 'function') {
      return Promise.reject(new Error('canvas pip unavailable'));
    }
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || video.clientWidth || 1280;
    canvas.height = video.videoHeight || video.clientHeight || 720;
    var ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
      return Promise.reject(new Error('canvas pip unavailable'));
    }
    var hidden = document.createElement('video');
    hidden.setAttribute('playsinline', '');
    hidden.muted = true;
    hidden.autoplay = true;
    hidden.srcObject = canvas.captureStream(30);
    hidden.style.cssText =
      'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(hidden);
    pipCanvas = canvas;
    pipHiddenVideo = hidden;
    pipCanvasActive = true;
    pipItems = [];
    pipVideo = video;

    function draw() {
      if (!pipCanvasActive || !pipCanvas) return;
      try {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var now = (window.performance && performance.now()) || Date.now();
        ctx.textBaseline = 'top';
        ctx.font = '700 18px "Microsoft YaHei","Segoe UI",sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,.75)';
        ctx.shadowBlur = 6;
        for (var i = 0; i < pipItems.length; i++) {
          var it = pipItems[i];
          var t = (now - it.start) / it.duration;
          if (t >= 1) continue;
          ctx.globalAlpha = settings.opacity;
          ctx.fillStyle = '#fff';
          ctx.fillText(it.label, canvas.width - t * (canvas.width + it.width + 40), 8 + it.row * 28);
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      } catch (err) {}
      pipRaf = requestAnimationFrame(draw);
    }
    draw();

    function onLeave() {
      hidden.removeEventListener('leavepictureinpicture', onLeave);
      stopCanvasPip();
      try {
        video.dispatchEvent(new Event('leavepictureinpicture'));
      } catch (err) {}
    }

    var started = hidden.play();
    var request = function () {
      return origRequestPip.call(hidden).then(function (win) {
        hidden.addEventListener('leavepictureinpicture', onLeave);
        return win;
      });
    };
    if (started && typeof started.then === 'function') {
      return started.then(request);
    }
    return request();
  }

  function preferDocumentPip() {
    var ua = navigator.userAgent || '';
    return (
      window.documentPictureInPicture &&
      typeof documentPictureInPicture.requestWindow === 'function' &&
      ua.indexOf('Electron') < 0
    );
  }

  function openBestPip(video) {
    if (preferDocumentPip()) {
      return openDocumentPip(video).catch(function () {
        return openCanvasPip(video);
      });
    }
    return openCanvasPip(video);
  }

  function openDocumentPip(video) {
    var width = video.videoWidth || video.clientWidth || 640;
    var height = video.videoHeight || video.clientHeight || 360;
    return window.documentPictureInPicture.requestWindow({ width: width, height: height }).then(function (win) {
      var prev = pipWindow;
      pipWindow = win;
      pipVideo = video;
      if (prev && prev !== win && !prev.closed) {
        try {
          prev.close();
        } catch (err) {}
      }
      var doc = win.document;
      doc.documentElement.style.cssText = 'width:100%;height:100%';
      doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden;width:100%;height:100%';
      var style = doc.createElement('style');
      style.textContent = pipItemCss();
      doc.head.appendChild(style);
      var root = doc.createElement('div');
      root.style.cssText = 'position:relative;width:100%;height:100%;background:#000;overflow:hidden';
      var clone = doc.createElement('video');
      clone.autoplay = true;
      clone.muted = !!video.muted;
      clone.playsInline = true;
      clone.controls = false;
      if (video.srcObject) clone.srcObject = video.srcObject;
      else if (video.currentSrc) clone.src = video.currentSrc;
      clone.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
      pipTrackEl = doc.createElement('div');
      pipTrackEl.className = 'bhchat-ss-track';
      root.appendChild(clone);
      root.appendChild(pipTrackEl);
      doc.body.appendChild(root);
      clone.play().catch(function () {});
      win.addEventListener('pagehide', function () {
        if (pipWindow === win) closeDocumentPip();
      });
      return win;
    });
  }

  function hookPictureInPicture() {
    if (pipHooked || !window.HTMLVideoElement) return;
    pipHooked = true;
    var proto = HTMLVideoElement.prototype;
    origRequestPip = proto.requestPictureInPicture;
    proto.requestPictureInPicture = function () {
      var video = this;
      var args = arguments;
      if (!settings.overlay || !isShareVideo(video) || typeof origRequestPip !== 'function') {
        return origRequestPip.apply(video, args);
      }
      return openBestPip(video).catch(function () {
        return origRequestPip.apply(video, args);
      });
    };
    if (typeof document.exitPictureInPicture === 'function') {
      origExitPip = document.exitPictureInPicture.bind(document);
      document.exitPictureInPicture = function () {
        if (pipWindow && !pipWindow.closed) {
          closeDocumentPip();
          return Promise.resolve();
        }
        return origExitPip();
      };
    }
    try {
      var desc =
        Object.getOwnPropertyDescriptor(Document.prototype, 'pictureInPictureElement') ||
        Object.getOwnPropertyDescriptor(document, 'pictureInPictureElement');
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        get: function () {
          if (pipWindow && !pipWindow.closed && pipVideo) return pipVideo;
          return desc && desc.get ? desc.get.call(document) : null;
        },
      });
    } catch (err) {}
  }

  function syncLayer() {
    var sharing = isScreenSharing();
    lastShare = sharing;
    hookPictureInPicture();
    if (!sharing) {
      if (pipCanvasActive && origExitPip) {
        origExitPip().catch(function () {});
      }
      stopCanvasPip();
      closeDocumentPip();
      removeLayer();
      removeForm();
      removeChrome();
      lastStatus = '等待屏幕共享…';
      return;
    }
    if (settings.overlay) {
      if (!ensureLayer()) {
        lastStatus = '已检测到屏幕共享，等待画面节点…';
      } else {
        lastStatus = '屏幕共享中，弹幕已开启';
      }
    } else {
      removeLayer();
      lastStatus = '屏幕共享中，弹幕已关';
    }
    if (settings.input) {
      ensureForm();
    } else {
      removeForm();
    }
    syncChrome();
  }

  function pickRow() {
    var min = 0;
    for (var i = 1; i < trackRows.length; i++) {
      if (trackRows[i] < trackRows[min]) min = i;
    }
    trackRows[min] += 1;
    return min;
  }

  function spawnOnTrack(track, hostEl, name, text) {
    if (!track) return;
    var doc = track.ownerDocument || document;
    var row = pickRow();
    var el = doc.createElement('div');
    el.className = 'bhchat-ss-item';
    el.style.top = 8 + row * 28 + 'px';
    el.style.opacity = String(settings.opacity);
    if (settings.showName) {
      var nameEl = doc.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = name + ':';
      el.appendChild(nameEl);
    }
    el.appendChild(doc.createTextNode(text));
    track.appendChild(el);
    var width = el.offsetWidth || 120;
    var hostWidth = (hostEl && hostEl.offsetWidth) || track.offsetWidth || 800;
    var duration = clamp(settings.speed, 4, 16);
    el.style.transition = 'transform ' + duration + 's linear';
    el.style.transform = 'translateX(0)';
    var raf = (doc.defaultView && doc.defaultView.requestAnimationFrame) || requestAnimationFrame;
    raf(function () {
      el.style.transform = 'translateX(-' + (hostWidth + width + 40) + 'px)';
    });
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      trackRows[row] = Math.max(0, trackRows[row] - 1);
    }, duration * 1000 + 80);
  }

  function spawnDanmaku(name, text) {
    if (!settings.overlay || !lastShare) return;
    if (findShareHost()) ensureLayer();
    spawnOnTrack(trackEl, layerEl, name, text);
    if (pipTrackEl) spawnOnTrack(pipTrackEl, pipTrackEl, name, text);
    if (pipCanvasActive) pushPipItem(name, text);
  }

  function onIncoming(payload) {
    try {
      if (!settings.overlay) return;
      var msg = unwrapMsg(payload);
      if (!msg) return;
      var key = msgKey(msg);
      if (!remember(key)) return;
      var scope = currentScope();
      if (!isRoomTextMsg(msg, scope)) return;
      var text = extractText(msg);
      if (!text) return;
      spawnDanmaku(extractName(msg), text);
    } catch (err) {
      console.warn('[BetterHeyboxChat] screen-share-danmaku message handler:', err);
    }
  }

  function hookBus() {
    if (hookedBus) return true;
    var bus = getClientBus();
    if (!bus) return false;
    for (var i = 0; i < BUS_EVENTS.length; i++) {
      bus.$on(BUS_EVENTS[i], onIncoming);
    }
    hookedBus = bus;
    return true;
  }

  function startBusHook() {
    if (hookBus()) return;
    var tries = 0;
    busRetry = setInterval(function () {
      tries += 1;
      if (hookBus() || tries > 120) {
        clearInterval(busRetry);
        busRetry = null;
      }
    }, 500);
  }

  function walkVue(vm, fn, depth) {
    if (!vm || depth > 40) return;
    try {
      fn(vm);
    } catch (err) {}
    var children = vm.$children || [];
    for (var i = 0; i < children.length; i++) {
      walkVue(children[i], fn, depth + 1);
    }
  }

  function isSendName(name) {
    return /(send).*(msg|im|text|channel|message)|(msg|im|text|channel|message).*(send)/i.test(
      String(name || ''),
    );
  }

  function sendViaOfficial(text) {
    var scope = currentScope();
    var payload = {
      msg: text,
      text: text,
      room_id: scope.roomId,
      channel_id: scope.channelIds[0] || '',
    };
    var store = getStore();
    if (store && store._actions) {
      var names = Object.keys(store._actions);
      for (var i = 0; i < names.length; i++) {
        if (isSendName(names[i])) {
          try {
            store.dispatch(names[i], payload);
            lastStatus = '已通过 Vuex 发送弹幕';
            return true;
          } catch (err) {}
        }
      }
    }
    var bus = hookedBus || getClientBus();
    if (bus && typeof bus.$emit === 'function') {
      var events = ['SEND_MESSAGE', 'SEND_IM_MESSAGE', 'SEND_CHANNEL_MESSAGE', 'SOCKET_SEND_TEXT'];
      for (var j = 0; j < events.length; j++) {
        try {
          bus.$emit(events[j], payload);
        } catch (err) {}
      }
    }
    var sent = false;
    walkVue(
      getVueRoot(),
      function (vm) {
        if (sent) return;
        var keys = ['sendMessage', 'sendText', 'sendIm', 'submitMsg', 'handleSend'];
        for (var k = 0; k < keys.length; k++) {
          if (typeof vm[keys[k]] === 'function') {
            try {
              vm[keys[k]](text);
              sent = true;
              lastStatus = '已通过官方组件发送弹幕';
              return;
            } catch (err) {}
          }
        }
      },
      0,
    );
    if (sent) return true;
    var composer = document.querySelector(
      'textarea, input[class*="im"], input[class*="message"], [class*="im-input"] textarea, [class*="msg-input"] textarea',
    );
    if (composer) {
      var proto = composer.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(composer, text);
      else composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      var sendBtn = document.querySelector(
        'button[class*="send"], .send-btn, [class*="im"] button[type="submit"]',
      );
      if (sendBtn) {
        sendBtn.click();
        lastStatus = '已通过输入框发送弹幕';
        return true;
      }
    }
    lastStatus = '未找到官方发信入口，弹幕未发出';
    return false;
  }

  function submitInput() {
    if (!inputEl) return;
    var text = String(inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    sendViaOfficial(text);
  }

  function startShareWatch() {
    syncLayer();
    if (window.BHChat && window.BHChat.watch) {
      unwatchShare = window.BHChat.watch(function () {
        var snap = getShareSnapshot();
        var host = findShareHost();
        var transport = getTransportSnapshot();
        return [
          snap.my_screen_sharing ? '1' : '0',
          isSharingInfoActive(snap.screen_sharing_info) ? '1' : '0',
          String(snap.screen_share_cpt_height || 0),
          host ? host.className + ':' + host.offsetWidth + 'x' + host.offsetHeight : '',
          String(transport.transport || ''),
          String(transport.route || ''),
          transport.p2pEnabled ? '1' : '0',
          String(transport.apiType || ''),
          String(transport.memberCount || 0),
          isOfficialMenuShown() ? '1' : '0',
          findOfficialQuality() ? 'q' : '',
        ].join('|');
      }, syncLayer);
    }
    if (window.MutationObserver) {
      shareObserver = new MutationObserver(function () {
        if (chromeMutating || observerQueued) return;
        observerQueued = true;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        raf(function () {
          observerQueued = false;
          if (chromeMutating) return;
          var now = isScreenSharing();
          var host = findShareHost();
          var operate = findOperateHost();
          var left = findLeftOperate();
          var quality = findOfficialQuality();
          if (
            now !== lastShare ||
            (now && layerEl && host && layerEl.parentNode !== host) ||
            (now && settings.input && operate && (!formEl || formEl.parentNode !== operate)) ||
            (now && settings.showMode && quality && quality.getAttribute('data-bhchat-mode') !== lastModeLabel) ||
            (now && routeEl && left && routeEl.parentNode !== left)
          ) {
            syncLayer();
          }
        });
      });
      shareObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.screenShareDanmaku = {
      send: sendViaOfficial,
      getStatus: function () {
        return lastStatus;
      },
      getSettings: function () {
        return {
          overlay: !!settings.overlay,
          input: !!settings.input,
          showName: !!settings.showName,
          showMode: !!settings.showMode,
          showRouteToggle: !!settings.showRouteToggle,
          preferP2P: !!settings.preferP2P,
          opacity: settings.opacity,
          speed: settings.speed,
        };
      },
      getMode: function () {
        var snap = getTransportSnapshot();
        return {
          label: getExtract().modeLabel(snap.transport, snap.apiType),
          transport: snap.transport,
          apiType: snap.apiType,
          canUseP2P: getExtract().canUseP2P(snap.p2pEnabled, snap.memberCount),
        };
      },
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatScreenShareDanmakuPanel',
      data: function () {
        return {
          overlay: settings.overlay,
          input: settings.input,
          showName: settings.showName,
          showMode: settings.showMode,
          showRouteToggle: settings.showRouteToggle,
          preferP2P: settings.preferP2P,
          opacity: Math.round(settings.opacity * 100),
          speed: settings.speed,
        };
      },
      mounted: function () {
        this.syncFromPlugin();
      },
      methods: {
        syncFromPlugin: function () {
          this.overlay = settings.overlay;
          this.input = settings.input;
          this.showName = settings.showName;
          this.showMode = settings.showMode;
          this.showRouteToggle = settings.showRouteToggle;
          this.preferP2P = settings.preferP2P;
          this.opacity = Math.round(settings.opacity * 100);
          this.speed = settings.speed;
        },
        persist: function () {
          settings.overlay = !!this.overlay;
          settings.input = !!this.input;
          settings.showName = !!this.showName;
          settings.showMode = !!this.showMode;
          settings.showRouteToggle = !!this.showRouteToggle;
          settings.preferP2P = !!this.preferP2P;
          settings.opacity = clamp(this.opacity / 100, 0.3, 1);
          settings.speed = clamp(this.speed, 4, 16);
          saveSettings();
          syncLayer();
        },
      },
      render: function (h) {
        var self = this;
        function rangeStyle(value, min, max) {
          var pct = ((Number(value) - min) / (max - min)) * 100;
          return {
            background:
              'linear-gradient(to right, var(--brand-text,#7dd95e) ' +
              pct +
              '%, var(--opacity-2,#ffffff14) ' +
              pct +
              '%)',
          };
        }
        function toggleRow(label, field) {
          return h(
            'div',
            {
              class: 'row bhchat-row-click',
              on: {
                click: function () {
                  self[field] = !self[field];
                  self.persist();
                },
              },
            },
            [
              h('span', label),
              h('span', { class: { 'bhchat-switch': true, on: !!self[field] } }, [
                h('span', { class: 'bhchat-switch-core' }),
              ]),
            ],
          );
        }
        return h('div', [
          h('div', { class: 'cell-title' }, '屏幕共享增强'),
          h('div', { class: 'bhchat-list' }, [
            toggleRow('共享画面显示弹幕', 'overlay'),
            toggleRow('显示弹幕发送框', 'input'),
            toggleRow('弹幕显示昵称', 'showName'),
            toggleRow('显示连接模式', 'showMode'),
            toggleRow('显示 P2P/中转切换', 'showRouteToggle'),
            toggleRow('优先使用 P2P', 'preferP2P'),
            h('div', { class: 'row' }, [
              h('span', '透明度 ' + this.opacity + '%'),
              h('input', {
                class: 'bhchat-native-range',
                style: rangeStyle(this.opacity, 30, 100),
                attrs: { type: 'range', min: '30', max: '100' },
                domProps: { value: String(this.opacity) },
                on: {
                  input: function (e) {
                    self.opacity = Number(e.target.value);
                    self.persist();
                  },
                },
              }),
            ]),
            h('div', { class: 'row' }, [
              h('span', '速度（秒）'),
              h('input', {
                class: 'bhchat-native-input bhchat-input-compact',
                attrs: { type: 'number', min: '4', max: '16', step: '1' },
                domProps: { value: this.speed },
                on: {
                  change: function (e) {
                    self.speed = clamp(e.target.value, 4, 16);
                    self.persist();
                  },
                },
              }),
            ]),
          ]),
        ]);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '屏幕共享增强',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    if (!window.BhchatScreenShareDanmaku) injectUserScript(EXTRACT_FILE);
    loadSettings().then(function () {
      injectStyles();
      registerApi();
      registerPanel();
      startBusHook();
      startShareWatch();
      console.log('[BetterHeyboxChat] screen-share-danmaku plugin activated');
    });
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
