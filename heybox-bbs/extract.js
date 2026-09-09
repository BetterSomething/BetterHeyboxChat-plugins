/**
 * 社区信息流：卡片字段、广告过滤、话题去重。纯函数，不发请求。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.BhchatHeyboxBbs = api;
  } else if (root) {
    root.BhchatHeyboxBbs = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BBS_HOME_URL = 'https://xiaoheihe.cn/app/bbs/home';
  var API_ORIGIN = 'https://api.xiaoheihe.cn';
  var API_FEEDS = API_ORIGIN + '/bbs/app/feeds';
  var API_TOPIC_FEEDS = API_ORIGIN + '/bbs/app/topic/feeds';
  var API_CATEGORIES = API_ORIGIN + '/bbs/app/topic/categories';
  var PAGE_LIMIT = 20;

  function asText(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function isAdCard(link) {
    if (!link || typeof link !== 'object') return false;
    if (link.is_ad === true || link.is_promotion === true) return true;
    if (asText(link.title) === '推广') return true;
    var tag = link.link_tag;
    if (typeof tag === 'string' && asText(tag) === '推广') return true;
    return false;
  }

  function pickLinkId(link) {
    if (!link || typeof link !== 'object') return '';
    var id = link.linkid != null && link.linkid !== '' ? link.linkid : link.link_id;
    if (id == null || id === '') return '';
    return String(id);
  }

  // 官方聊天里打开详情用的是字符串类型，不是信息流里的数字 link_type。
  function officialLinkType(link) {
    if (link && link.has_video) return 'video';
    if (link && link.use_concept_type) return 'concept';
    return 'article';
  }

  function pickTitle(link) {
    if (!link || typeof link !== 'object') return '未命名帖子';
    var title = asText(link.title);
    if (title) return title;
    var desc = asText(link.description);
    if (desc) return desc;
    return '未命名帖子';
  }

  function pickDescription(link) {
    if (!link || typeof link !== 'object') return '';
    var title = asText(link.title);
    var desc = asText(link.description);
    if (!desc) return '';
    if (!title) return '';
    return desc;
  }

  function pickUser(link) {
    var user = link && link.user && typeof link.user === 'object' ? link.user : {};
    var name = asText(user.username || user.name);
    var avatar = asText(user.avartar || user.avatar);
    var level = null;
    if (user.level_info && user.level_info.level != null && user.level_info.level !== '') {
      var fromInfo = Number(user.level_info.level);
      if (isFinite(fromInfo)) level = fromInfo;
    } else if (user.level != null && user.level !== '') {
      var fromLevel = Number(user.level);
      if (isFinite(fromLevel)) level = fromLevel;
    }
    return { name: name, avatar: avatar, level: level };
  }

  function urlFromImageItem(item) {
    if (typeof item === 'string') return asText(item);
    if (!item || typeof item !== 'object') return '';
    return asText(item.url || item.thumb || item.src);
  }

  function collectUrls(arr, out) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      var url = urlFromImageItem(arr[i]);
      if (url) out.push(url);
    }
  }

  function pickImages(link) {
    var thumbs = [];
    collectUrls(link && link.thumbs, thumbs);
    if (thumbs.length) return thumbs;
    var imgs = [];
    collectUrls(link && link.imgs, imgs);
    return imgs;
  }

  function pickTopic(link) {
    if (!link || typeof link !== 'object') return null;
    var raw = null;
    if (Array.isArray(link.topics) && link.topics[0]) raw = link.topics[0];
    else if (link.topic && typeof link.topic === 'object') raw = link.topic;
    if (raw) {
      var id = raw.topic_id != null && raw.topic_id !== '' ? raw.topic_id : raw.id;
      var name = asText(raw.name || raw.title || raw.topic_name);
      if ((id == null || id === '') && !name) return null;
      return { id: id == null || id === '' ? '' : String(id), name: name };
    }
    if (link.topic_name) {
      return {
        id: link.topic_id == null || link.topic_id === '' ? '' : String(link.topic_id),
        name: asText(link.topic_name),
      };
    }
    return null;
  }

  function formatRelativeTime(createAt, createStr, nowMs) {
    var ready = asText(createStr);
    if (ready) return ready;
    var ts = Number(createAt);
    if (!isFinite(ts) || ts <= 0) return '';
    if (ts < 1e12) ts *= 1000;
    var now = nowMs != null ? Number(nowMs) : Date.now();
    if (!isFinite(now)) now = Date.now();
    var diff = Math.max(0, now - ts);
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + '分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + '天前';
    var date = new Date(ts);
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var mm = month < 10 ? '0' + month : String(month);
    var dd = day < 10 ? '0' + day : String(day);
    return date.getFullYear() + '-' + mm + '-' + dd;
  }

  function mergeTopicChips(recommendChildren, hotChildren) {
    var seen = {};
    var out = [];
    function addList(arr) {
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var item = arr[i];
        if (!item || typeof item !== 'object') continue;
        var id = item.topic_id != null && item.topic_id !== '' ? String(item.topic_id) : item.id != null ? String(item.id) : '';
        var name = asText(item.name || item.title);
        if (!id || !name || seen[id]) continue;
        seen[id] = true;
        out.push({ id: id, name: name });
      }
    }
    addList(recommendChildren);
    addList(hotChildren);
    return out;
  }

  function groupTopicChips(recommendChildren, hotChildren) {
    var recommend = mergeTopicChips(recommendChildren, []);
    var seen = {};
    var i;
    for (i = 0; i < recommend.length; i++) seen[recommend[i].id] = true;
    var hotAll = mergeTopicChips(hotChildren, []);
    var hot = [];
    for (i = 0; i < hotAll.length; i++) {
      if (seen[hotAll[i].id]) continue;
      hot.push(hotAll[i]);
    }
    return { recommend: recommend, hot: hot };
  }

  function shouldLoadMore(remainPx, loading, hasMore) {
    return Number(remainPx) < 80 && !loading && !!hasMore;
  }

  function unwrapHttp(res) {
    if (!res || typeof res !== 'object') return null;
    if (res.data && typeof res.data === 'object' && ('status' in res.data || res.data.result)) {
      return res.data;
    }
    return res;
  }

  function parseListPayload(res) {
    var data = unwrapHttp(res);
    if (!data || data.status !== 'ok') {
      return { ok: false, links: [], lastval: '', hasMore: false };
    }
    var result = data.result && typeof data.result === 'object' ? data.result : {};
    var links = Array.isArray(result.links) ? result.links : [];
    var lastval = result.lastval != null && result.lastval !== '' ? String(result.lastval) : '';
    return { ok: true, links: links, lastval: lastval, hasMore: links.length > 0 };
  }

  function filterRenderableLinks(links) {
    if (!Array.isArray(links)) return [];
    var out = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (!link || typeof link !== 'object') continue;
      if (isAdCard(link)) continue;
      if (!pickLinkId(link)) continue;
      out.push(link);
    }
    return out;
  }

  function browserLinkUrl(linkId) {
    return 'https://www.xiaoheihe.cn/app/bbs/link/' + encodeURIComponent(String(linkId));
  }

  return {
    BBS_HOME_URL: BBS_HOME_URL,
    API_ORIGIN: API_ORIGIN,
    API_FEEDS: API_FEEDS,
    API_TOPIC_FEEDS: API_TOPIC_FEEDS,
    API_CATEGORIES: API_CATEGORIES,
    PAGE_LIMIT: PAGE_LIMIT,
    isAdCard: isAdCard,
    pickLinkId: pickLinkId,
    officialLinkType: officialLinkType,
    pickTitle: pickTitle,
    pickDescription: pickDescription,
    pickUser: pickUser,
    pickImages: pickImages,
    pickTopic: pickTopic,
    formatRelativeTime: formatRelativeTime,
    mergeTopicChips: mergeTopicChips,
    groupTopicChips: groupTopicChips,
    shouldLoadMore: shouldLoadMore,
    parseListPayload: parseListPayload,
    filterRenderableLinks: filterRenderableLinks,
    browserLinkUrl: browserLinkUrl,
  };
});
