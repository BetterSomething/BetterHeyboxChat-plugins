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
  var API_FOLLOW_FEEDS = API_ORIGIN + '/bbs/app/profile/subscribed/events';
  var API_FOLLOW_USER_EVENTS = API_ORIGIN + '/bbs/app/profile/events';
  var API_FOLLOWING_LIST = API_ORIGIN + '/bbs/app/profile/following/simple_list';
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

  // 关注流响应：result.moments[] 是多态卡片（BBSLinkObj 等），
  // content_type 4=帖子、1/33/36/38=资讯、40=转发、42=游戏评价、18=登录提示、22=推荐开关等。
  // 只保留能直接渲染的帖子类卡片（42 单独归一化），其余丢弃。
  var FOLLOW_RENDERABLE_TYPES = { 4: 1, 1: 1, 33: 1, 36: 1, 38: 1, 39: 1, 35: 1, 37: 1, 40: 1, 42: 1 };

  function isRenderableMoment(moment) {
    if (!moment || typeof moment !== 'object') return false;
    var type = Number(moment.content_type);
    if (!FOLLOW_RENDERABLE_TYPES[type]) return false;
    if (isAdCard(moment)) return false;
    // 42 是游戏评价卡：本体无 linkid 内容，需要 games[0] 撑起来，单独判断
    return true;
  }

  // 关注流里的 42 卡是"用户给游戏打分+短评"，转成与帖子卡兼容的形状：
  // 标题取游戏名，描述取评价文字，点击打开游戏话题帖。
  function normalizeGameReviewCard(moment) {
    var game = Array.isArray(moment.games) && moment.games[0] ? moment.games[0] : null;
    var inner = moment.link && typeof moment.link === 'object' ? moment.link : {};
    var desc = asText(inner.description);
    if (!desc) return null;
    var gameId = game ? (game.steam_appid != null ? game.steam_appid : game.appid) : null;
    var topicId = inner.topics && inner.topics[0] ? inner.topics[0].topic_id : '';
    return {
      linkid: pickLinkId(inner) || (moment.linkid != null ? String(moment.linkid) : ''),
      title: game ? asText(game.name) : (topicId ? '' : '游戏评价'),
      description: desc,
      user: inner.user || moment.user,
      thumbs: [],
      imgs: [],
      topics: Array.isArray(inner.topics) ? inner.topics : [],
      topic_id: topicId,
      comment_num: inner.comment_num != null ? inner.comment_num : 0,
      up: inner.up != null ? inner.up : 0,
      create_at: inner.create_at || moment.create_at,
      create_str: inner.create_str || moment.create_str,
      score: inner.score != null ? inner.score : null,
      _review_game_id: gameId == null ? '' : String(gameId),
    };
  }

  // 关注流 moments → 可渲染的帖子卡列表。42 游戏评价卡会被归一化，无法归一化的丢弃。
  function pickFollowLinks(moments) {
    if (!Array.isArray(moments)) return [];
    var out = [];
    for (var i = 0; i < moments.length; i++) {
      var moment = moments[i];
      if (!isRenderableMoment(moment)) continue;
      if (Number(moment.content_type) === 42) {
        var normalized = normalizeGameReviewCard(moment);
        if (normalized && normalized.linkid) out.push(normalized);
        continue;
      }
      if (!pickLinkId(moment)) continue;
      out.push(moment);
    }
    return out;
  }

  // 关注流响应解析：{ ok, links, lastval, hasMore }
  function parseFollowPayload(res) {
    var data = unwrapHttp(res);
    if (!data || data.status !== 'ok') {
      return { ok: false, links: [], lastval: '', hasMore: false };
    }
    var result = data.result && typeof data.result === 'object' ? data.result : {};
    var links = pickFollowLinks(result.moments);
    var lastval = result.lastval != null && result.lastval !== '' ? String(result.lastval) : '';
    return { ok: true, links: links, lastval: lastval, hasMore: links.length > 0 };
  }

  // 好友列表（following/simple_list）：{ ok, friends: [{userid,name,avatar,level}], hasMore }
  function parseFollowingList(res) {
    var data = unwrapHttp(res);
    if (!data || data.status !== 'ok' || !data.result) {
      return { ok: false, friends: [], hasMore: false };
    }
    var raw = Array.isArray(data.result.follow_list) ? data.result.follow_list : [];
    var friends = [];
    for (var i = 0; i < raw.length; i++) {
      var u = raw[i];
      if (!u || typeof u !== 'object') continue;
      var uid = u.userid != null && u.userid !== '' ? String(u.userid) : '';
      if (!uid) continue;
      friends.push({
        userid: uid,
        name: asText(u.username || u.name),
        avatar: asText(u.avartar || u.avatar),
        level: userLevel(u),
        unread: u.unread != null ? Number(u.unread) || 0 : 0,
      });
    }
    return { ok: true, friends: friends, hasMore: Number(data.result.has_more) > 0 };
  }

  function userLevel(user) {
    if (user.level_info && user.level_info.level != null && user.level_info.level !== '') {
      var n = Number(user.level_info.level);
      if (isFinite(n)) return n;
    }
    if (user.level != null && user.level !== '') {
      var m = Number(user.level);
      if (isFinite(m)) return m;
    }
    return null;
  }

  return {
    BBS_HOME_URL: BBS_HOME_URL,
    API_ORIGIN: API_ORIGIN,
    API_FEEDS: API_FEEDS,
    API_TOPIC_FEEDS: API_TOPIC_FEEDS,
    API_CATEGORIES: API_CATEGORIES,
    API_FOLLOW_FEEDS: API_FOLLOW_FEEDS,
    API_FOLLOW_USER_EVENTS: API_FOLLOW_USER_EVENTS,
    API_FOLLOWING_LIST: API_FOLLOWING_LIST,
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
    parseFollowPayload: parseFollowPayload,
    parseFollowingList: parseFollowingList,
    pickFollowLinks: pickFollowLinks,
    filterRenderableLinks: filterRenderableLinks,
    browserLinkUrl: browserLinkUrl,
  };
});
