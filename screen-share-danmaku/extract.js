/**
 * 屏幕共享连接模式文案与切换判定。纯函数，不调 $rtc。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.BhchatScreenShareDanmaku = api;
  } else if (root) {
    root.BhchatScreenShareDanmaku = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function asText(value) {
    if (value == null) return '';
    return String(value).toLowerCase();
  }

  function modeLabel(transport, apiType) {
    var t = asText(transport);
    if (t === 'p2p') return 'P2P';
    if (t === 'switching') return '切换中';
    var api = asText(apiType);
    if (api === 'trtc') return 'TRTC';
    if (api === 'volc') return '火山RTC';
    return '中转';
  }

  function isP2P(transport) {
    return asText(transport) === 'p2p';
  }

  function canUseP2P(p2pEnabled, memberCount) {
    return p2pEnabled === true && Number(memberCount) === 2;
  }

  function p2pUnavailableReason(p2pEnabled, memberCount) {
    if (p2pEnabled !== true) return '当前房间未开启 P2P';
    if (Number(memberCount) !== 2) return 'P2P 仅支持两人频道';
    return '';
  }

  function toggleTarget(transport) {
    return isP2P(transport) ? 'commercial' : 'p2p';
  }

  return {
    modeLabel: modeLabel,
    isP2P: isP2P,
    canUseP2P: canUseP2P,
    p2pUnavailableReason: p2pUnavailableReason,
    toggleTarget: toggleTarget,
  };
});
