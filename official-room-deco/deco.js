/**
 * 官方房间背景 decorate payload，以及按工厂源码探测 decorate / 上传模块。
 * 不看 can_change_bg_pic / room_decorate 门闩，不写死 webpack 数字 ID。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  // Electron 渲染进程有 Node 的 module，不能只走 CommonJS，否则 window 上没有 helpers。
  if (typeof window !== 'undefined') {
    window.BhchatOfficialRoomDeco = api;
  } else if (root) {
    root.BhchatOfficialRoomDeco = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROOM_DECORATE_CLOSE_ALL = 2;
  var ROOM_DECORATE_OPEN_ALL = 1;
  var MAX_UPLOAD_KB = 5120;

  function pick(patchVal, roomVal, fallback) {
    if (patchVal != null) return patchVal;
    if (roomVal != null) return roomVal;
    return fallback;
  }

  function canSubmit(room) {
    if (!room || room.room_id == null || room.room_id === '') {
      return { ok: false, error: '请先进入一个房间' };
    }
    return { ok: true };
  }

  function isClientUploadBlocked(room, globalConfig) {
    var flag = globalConfig && globalConfig.numbers ? Number(globalConfig.numbers.room_decorate) : 0;
    if (flag === ROOM_DECORATE_CLOSE_ALL) return true;
    if (flag === ROOM_DECORATE_OPEN_ALL) return false;
    return !(room && room.can_change_bg_pic);
  }

  function asRoomId(value) {
    if (value == null || value === '') return '';
    return String(value);
  }

  function buildDecoratePayload(room, patch) {
    room = room || {};
    patch = patch || {};
    var nextPic = patch.bg_pic != null ? patch.bg_pic : room.bg_pic || '';
    var hasPic = !!nextPic;
    var mainColor = hasPic
      ? pick(patch.bg_pic_main_color, room.bg_pic_main_color, '#1F2225')
      : '';
    var barColor = hasPic
      ? pick(patch.bar_color, room.bar_color, '#1F2225,#1F2225')
      : pick(patch.bar_color, room.bar_color, '');
    return {
      type: pick(patch.type, null, 'room'),
      room_id: asRoomId(room.room_id),
      bg_color: hasPic ? '' : pick(patch.bg_color, room.bg_color, ''),
      transparency: Number(pick(patch.transparency, room.transparency, hasPic ? 70 : 0)) || 0,
      blur_rate: Number(pick(patch.blur_rate, room.blur_rate, 0)) || 0,
      main_color_v2: Number(pick(patch.main_color_v2, room.main_color_v2, 0)) || 0,
      bar_color: barColor,
      bar_main_color_v2: Number(pick(patch.bar_main_color_v2, room.bar_main_color_v2, 0)) || 0,
      bg_pic: hasPic ? nextPic : '',
      bg_pic_main_color: mainColor,
      show_channel_bar_filter: hasPic
        ? !!pick(patch.show_channel_bar_filter, room.show_channel_bar_filter, true)
        : false,
      can_change_bg_pic: !!hasPic,
    };
  }

  function parseDecorateResult(res) {
    var data = res && (res.data || res);
    if (!data || typeof data !== 'object') {
      return { ok: false, status: 'error', errorType: '', message: '无响应', raw: data || null };
    }
    if (data.status === 'ok') {
      return { ok: true, status: 'ok', errorType: '', message: '', result: data.result, raw: data };
    }
    return {
      ok: false,
      status: data.status || 'error',
      errorType: data.error_type || '',
      message: data.msg || data.message || data.error_type || '服务端拒绝',
      raw: data,
    };
  }

  function validateUploadFile(file, options) {
    options = options || {};
    var maxKb = options.maxKb || MAX_UPLOAD_KB;
    if (!file) return { ok: false, error: '未选择文件' };
    if (file.size / 1024 > maxKb) return { ok: false, error: '不能上传超过5mb的图片！' };
    var type = file.type || '';
    if (type === 'image/gif' && !options.allowGif) {
      return { ok: false, error: '当前房间等级不支持 GIF' };
    }
    if (type && !/^image\/(jpeg|jpg|pjpeg|png|gif)$/i.test(type)) {
      return { ok: false, error: '仅支持 JPG / PNG / GIF' };
    }
    return { ok: true };
  }

  function factorySource(req, id) {
    try {
      return String((req && req.m && req.m[id]) || '');
    } catch (err) {
      return '';
    }
  }

  function safeRequire(req, id) {
    if (typeof req !== 'function' || id == null || id === '') return null;
    try {
      return req(id);
    } catch (err) {
      return null;
    }
  }

  function looksLikeRoomApi(mod) {
    return !!(mod && typeof mod.DC === 'function');
  }

  function looksLikeUploader(mod) {
    var up = mod && (mod.default || mod);
    return !!(up && typeof up.uploadCustomFile === 'function');
  }

  function unwrapUploader(mod) {
    if (!looksLikeUploader(mod)) return null;
    return mod.default && typeof mod.default.uploadCustomFile === 'function' ? mod.default : mod;
  }

  function looksLikeRoomApiFactory(src) {
    if (!src) return false;
    return src.indexOf('/chatroom/v2/room/decorate') !== -1;
  }

  function looksLikeUploaderFactory(src) {
    return !!(src && src.indexOf('uploadCustomFile') !== -1);
  }

  function eachFactoryId(req, visit) {
    var factories = (req && req.m) || {};
    var ids = Object.keys(factories);
    for (var i = 0; i < ids.length; i++) {
      if (visit(ids[i], factorySource(req, ids[i])) === true) return;
    }
  }

  function findRoomApi(req) {
    if (typeof req !== 'function') return null;
    var found = null;
    eachFactoryId(req, function (id, src) {
      if (!looksLikeRoomApiFactory(src)) return;
      var mod = safeRequire(req, id);
      if (looksLikeRoomApi(mod)) {
        found = mod;
        return true;
      }
    });
    return found;
  }

  function findUploaderModule(req) {
    if (typeof req !== 'function') return null;
    var found = null;
    eachFactoryId(req, function (id, src) {
      if (!looksLikeUploaderFactory(src)) return;
      var mod = safeRequire(req, id);
      if (looksLikeUploader(mod)) {
        found = mod;
        return true;
      }
    });
    return found;
  }

  function discoverUploaderChunks(req) {
    var chunks = [];
    eachFactoryId(req, function (_id, src) {
      if (src.indexOf('uploadCustomFile') === -1 && src.indexOf('room_deco_pic') === -1) return;
      var re = /\.e\(\s*(\d+)\s*\)/g;
      var match;
      while ((match = re.exec(src))) {
        if (chunks.indexOf(match[1]) === -1) chunks.push(match[1]);
      }
    });
    return chunks;
  }

  function loadUploader(req) {
    if (typeof req !== 'function') return Promise.resolve(null);
    var ready = unwrapUploader(findUploaderModule(req));
    if (ready) return Promise.resolve(ready);
    var chunks = discoverUploaderChunks(req);
    var chain = Promise.resolve();
    for (var i = 0; i < chunks.length; i++) {
      (function (chunkId) {
        chain = chain.then(function () {
          if (unwrapUploader(findUploaderModule(req))) return;
          if (typeof req.e !== 'function') return;
          return req.e(chunkId);
        });
      })(chunks[i]);
    }
    return chain
      .then(function () {
        return unwrapUploader(findUploaderModule(req));
      })
      .catch(function () {
        return null;
      });
  }

  return {
    ROOM_DECORATE_CLOSE_ALL: ROOM_DECORATE_CLOSE_ALL,
    ROOM_DECORATE_OPEN_ALL: ROOM_DECORATE_OPEN_ALL,
    MAX_UPLOAD_KB: MAX_UPLOAD_KB,
    canSubmit: canSubmit,
    isClientUploadBlocked: isClientUploadBlocked,
    buildDecoratePayload: buildDecoratePayload,
    parseDecorateResult: parseDecorateResult,
    validateUploadFile: validateUploadFile,
    findRoomApi: findRoomApi,
    loadUploader: loadUploader,
  };
});
