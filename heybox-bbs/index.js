/**
 * 左栏官方 tab 自绘社区推荐流；点卡片走官方 ShowLinkDetail。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'heybox-bbs';
  var ROUTE_NAME = 'bhchat-bbs';
  var ROUTE_PATH = '/bbs';
  var ENTRY_ID = 'bhchat-bbs-entry';
  var EXTRACT_FILE = 'extract.js';
  var DETAIL_WAIT_MS = 800;

  var routeAdded = false;
  var started = false;
  var entryObs = null;
  var signedGetFn = null;
  var httpResolved = false;

  function getExtract() {
    return window.BhchatHeyboxBbs || null;
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

  function getRouter() {
    var app = document.getElementById('app');
    var vue = app && app.__vue__;
    if (!vue) return null;
    return vue.$router || (vue.$root && vue.$root.$router) || null;
  }

  function safeRequire(id) {
    var req = window.__bhchat_require__;
    if (typeof req !== 'function' || id == null || id === '') return null;
    try {
      return req(id);
    } catch (err) {
      return null;
    }
  }

  function looksLikeHttpFactory(src) {
    if (!src) return false;
    return (
      src.indexOf('heybox_chat') !== -1 &&
      src.indexOf('BASE_XHH') !== -1 &&
      src.indexOf('bH') !== -1 &&
      src.indexOf('rP') !== -1
    );
  }

  function resolveSignedGet() {
    if (httpResolved) return signedGetFn;
    httpResolved = true;
    signedGetFn = null;
    var req = window.__bhchat_require__;
    if (typeof req !== 'function') return null;
    var map = window.__bhchat_module_map__ || {};
    if (map.HTTP) {
      var mapped = safeRequire(map.HTTP);
      if (mapped && typeof mapped.bH === 'function') {
        signedGetFn = mapped.bH.bind(mapped);
        return signedGetFn;
      }
    }
    var factories = req.m || {};
    var ids = Object.keys(factories);
    for (var i = 0; i < ids.length; i++) {
      var src = '';
      try {
        src = String(factories[ids[i]] || '');
      } catch (err) {
        src = '';
      }
      if (!looksLikeHttpFactory(src)) continue;
      var mod = safeRequire(ids[i]);
      if (mod && typeof mod.bH === 'function') {
        signedGetFn = mod.bH.bind(mod);
        return signedGetFn;
      }
    }
    return null;
  }

  function signedGet(url, params) {
    try {
      var get = resolveSignedGet();
      if (!get) return Promise.reject(new Error('官方签名 HTTP 未就绪'));
      return Promise.resolve(get(url, params || {}));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function emitShowLinkDetail(linkId, linkType) {
    var map = window.__bhchat_module_map__ || {};
    var busMod = safeRequire(map.EVENT_BUS || '30570');
    var bus = busMod && (busMod.A || busMod.default || busMod);
    if (!bus || typeof bus.$emit !== 'function') return false;
    try {
      if (linkType == null || linkType === '') {
        bus.$emit('ShowLinkDetail', linkId, -1);
      } else {
        bus.$emit('ShowLinkDetail', linkId, -1, linkType);
      }
      return true;
    } catch (err) {
      console.warn('[BetterHeyboxChat] heybox-bbs ShowLinkDetail:', err && err.message);
      return false;
    }
  }

  function openHomeInBrowser() {
    var E = getExtract();
    window.open((E && E.BBS_HOME_URL) || 'https://xiaoheihe.cn/app/bbs/home');
  }

  function openLinkInBrowser(linkId) {
    var E = getExtract();
    if (E && typeof E.browserLinkUrl === 'function') {
      window.open(E.browserLinkUrl(linkId));
      return;
    }
    window.open('https://www.xiaoheihe.cn/app/bbs/link/' + encodeURIComponent(String(linkId)));
  }

  function isBbsRoute(route) {
    return !!(route && (route.name === ROUTE_NAME || route.path === ROUTE_PATH || route.path === '/bbs'));
  }

  function syncEntryActive() {
    var entry = document.getElementById(ENTRY_ID);
    if (!entry) return;
    var block = entry.querySelector('.shortcut-block');
    if (!block) return;
    var router = getRouter();
    var on = isBbsRoute(router && router.currentRoute);
    if (on) block.classList.add('active');
    else block.classList.remove('active');
  }

  function buildEntry() {
    var wrap = document.createElement('div');
    wrap.id = ENTRY_ID;
    wrap.className = 'tool-container flex-col-items-center relative pb-[6px] bhchat-bbs-entry';
    wrap.innerHTML =
      '<div class="cpt-shortcut-block-wrapper">' +
      '<div class="tool-shortcuts shortcut-block circle relative" title="社区">' +
      '<svg class="bhchat-bbs-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="社区">' +
      '<rect x="5" y="6" width="18" height="16" rx="3.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M9 12h10M9 16.5h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>' +
      '</div></div>';
    wrap.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openBbs();
    });
    return wrap;
  }

  function ensureEntry() {
    var layout = document.querySelector('.left-sidebar-layout');
    if (!layout) return null;
    var mini = layout.querySelector('.tool-container');
    var rooms = layout.querySelector('.cpt-room-container');
    if (!mini || !rooms) return document.getElementById(ENTRY_ID);
    var entry = document.getElementById(ENTRY_ID) || buildEntry();
    if (entry.previousElementSibling !== mini || entry.nextElementSibling !== rooms) {
      mini.parentNode.insertBefore(entry, rooms);
    }
    syncEntryActive();
    return entry;
  }

  function watchSidebar() {
    if (entryObs) return;
    entryObs = new MutationObserver(function () {
      ensureEntry();
    });
    entryObs.observe(document.body, { childList: true, subtree: true });
    ensureEntry();
  }

  function hBtn(h, text, kind, onClick) {
    return h(
      'button',
      {
        class: { 'bhchat-btn': true, 'bhchat-btn-primary': kind === 'primary', 'bhchat-btn-secondary': kind !== 'primary' },
        attrs: { type: 'button' },
        on: { click: onClick || function () {} },
      },
      text,
    );
  }

  function renderImages(h, urls) {
    if (!urls || !urls.length) return null;
    var shown = urls.slice(0, 3);
    var nodes = [];
    for (var i = 0; i < shown.length; i++) {
      var last = i === shown.length - 1 && urls.length > 3;
      nodes.push(
        h('div', { class: 'bhchat-bbs-img-wrap' }, [
          h('img', { class: 'bhchat-bbs-img', attrs: { src: shown[i], alt: '' } }),
          last ? h('span', { class: 'bhchat-bbs-img-more' }, '共 ' + urls.length + ' 张') : null,
        ]),
      );
    }
    return h('div', { class: { 'bhchat-bbs-imgs': true, 'is-single': urls.length === 1 } }, nodes);
  }

  function renderCard(h, self, E, link) {
    var user = E.pickUser(link);
    var topic = E.pickTopic(link);
    var imgs = E.pickImages(link);
    var desc = E.pickDescription(link);
    var time = E.formatRelativeTime(link.create_at, link.create_str);
    var avatar = user.avatar
      ? h('img', { class: 'bhchat-bbs-avatar', attrs: { src: user.avatar, alt: '' } })
      : h('div', { class: 'bhchat-bbs-avatar-empty' });
    var authorKids = [avatar, h('span', { class: 'bhchat-bbs-author-name text-tx-1' }, user.name || '盒友')];
    if (user.level != null) {
      authorKids.push(h('span', { class: 'bhchat-bbs-author-level text-tx-3' }, 'Lv.' + user.level));
    }
    var meta = [];
    if (topic && topic.name) {
      meta.push(
        h(
          'button',
          {
            class: 'bhchat-bbs-topic-link',
            attrs: { type: 'button' },
            on: {
              click: function (ev) {
                self.onOpenTopicFromCard(ev, topic);
              },
            },
          },
          topic.name,
        ),
      );
    }
    if (time) meta.push(h('span', time));
    meta.push(h('span', '评 ' + (link.comment_num != null ? link.comment_num : 0)));
    meta.push(h('span', '赞 ' + (link.up != null ? link.up : 0)));
    return h(
      'div',
      {
        class: 'bhchat-bbs-card',
        on: {
          click: function () {
            self.onOpenCard(link);
          },
        },
      },
      [
        h('div', { class: 'bhchat-bbs-author' }, authorKids),
        h('div', { class: 'bhchat-bbs-card-title' }, E.pickTitle(link)),
        desc ? h('div', { class: 'bhchat-bbs-card-desc' }, desc) : null,
        renderImages(h, imgs),
        h('div', { class: 'bhchat-bbs-meta' }, meta),
      ],
    );
  }

  function buildPageComponent() {
    return {
      name: 'BhchatBbsNativePage',
      data: function () {
        return {
          tab: 'recommend',
          topicId: '',
          topics: [],
          recommendTopics: [],
          hotTopics: [],
          links: [],
          loading: false,
          loadingMore: false,
          error: '',
          footerError: '',
          hasMore: true,
          lastval: '',
          topicsLoaded: false,
          detailOpen: false,
          detailHint: '',
          detailLinkId: '',
          detailTimer: 0,
          detailObs: null,
        };
      },
      mounted: function () {
        syncEntryActive();
        this.startDetailWatch();
        this.enterRecommend();
      },
      beforeDestroy: function () {
        this.stopDetailWatch();
        this.resetFeed();
        if (this.detailTimer) {
          clearTimeout(this.detailTimer);
          this.detailTimer = 0;
        }
        syncEntryActive();
      },
      methods: {
        resetFeed: function () {
          this.tab = 'recommend';
          this.topicId = '';
          this.topics = [];
          this.recommendTopics = [];
          this.hotTopics = [];
          this.links = [];
          this.detailOpen = false;
          this.loading = false;
          this.loadingMore = false;
          this.error = '';
          this.footerError = '';
          this.hasMore = true;
          this.lastval = '';
          this.topicsLoaded = false;
          this.detailHint = '';
          this.detailLinkId = '';
        },
        extract: function () {
          return getExtract();
        },
        enterRecommend: function () {
          this.tab = 'recommend';
          this.loadTopics();
          if (!this.links.length) this.loadList(true);
        },
        onSelectTab: function (tab) {
          if (tab === 'follow') {
            this.tab = 'follow';
            this.detailHint = '';
            return;
          }
          if (this.tab === 'recommend') {
            this.refresh();
            return;
          }
          this.enterRecommend();
        },
        onSelectTopic: function (topicId) {
          var next = topicId == null ? '' : String(topicId);
          this.tab = 'recommend';
          this.topicId = next;
          this.loadList(true);
        },
        refresh: function () {
          if (this.tab !== 'recommend') return;
          if (this.loading || this.loadingMore) return;
          this.loadList(true);
        },
        loadTopics: function () {
          var self = this;
          var E = this.extract();
          if (!E || this.topicsLoaded || this.tab !== 'recommend') return;
          signedGet(E.API_CATEGORIES, {})
            .then(function (res) {
              var data = res && res.data && (res.data.status || res.data.result) ? res.data : res;
              if (!data || data.status !== 'ok' || !data.result) return;
              var rec = data.result.recommend_for_user_topics;
              var hot = data.result.latest_hot_topics;
              var grouped =
                typeof E.groupTopicChips === 'function'
                  ? E.groupTopicChips(rec && rec.children, hot && hot.children)
                  : { recommend: E.mergeTopicChips(rec && rec.children, []), hot: [] };
              self.recommendTopics = grouped.recommend || [];
              self.hotTopics = grouped.hot || [];
              self.topics = self.recommendTopics.concat(self.hotTopics);
              self.topicsLoaded = true;
            })
            .catch(function (err) {
              console.warn('[BetterHeyboxChat] heybox-bbs topics:', err && err.message);
            });
        },
        loadList: function (reset) {
          var self = this;
          var E = this.extract();
          if (!E) {
            this.error = '社区模块未就绪';
            return;
          }
          if (this.tab !== 'recommend') return;
          if (this.loading || this.loadingMore) return;
          if (!reset && !this.hasMore) return;

          if (reset) {
            this.loading = true;
            this.error = '';
            this.footerError = '';
            this.hasMore = true;
            this.lastval = '';
            this.links = [];
          } else {
            this.loadingMore = true;
            this.footerError = '';
          }

          var params;
          var url;
          if (this.topicId) {
            url = E.API_TOPIC_FEEDS;
            params = { topic_id: this.topicId, limit: E.PAGE_LIMIT };
            if (!reset && this.lastval) params.lastval = this.lastval;
            else if (!reset) params.offset = this.links.length;
          } else {
            url = E.API_FEEDS;
            params = { pull: reset ? 1 : 0, limit: E.PAGE_LIMIT };
          }

          signedGet(url, params)
            .then(function (res) {
              var parsed = E.parseListPayload(res);
              if (!parsed.ok) {
                throw new Error('status not ok');
              }
              var fresh = E.filterRenderableLinks(parsed.links);
              if (reset) {
                self.links = fresh;
              } else {
                var seen = {};
                var i;
                for (i = 0; i < self.links.length; i++) {
                  seen[E.pickLinkId(self.links[i])] = true;
                }
                for (i = 0; i < fresh.length; i++) {
                  var id = E.pickLinkId(fresh[i]);
                  if (!id || seen[id]) continue;
                  seen[id] = true;
                  self.links.push(fresh[i]);
                }
              }
              self.lastval = parsed.lastval;
              self.hasMore = parsed.hasMore;
              self.error = '';
            })
            .catch(function (err) {
              console.warn('[BetterHeyboxChat] heybox-bbs feed:', err && err.message);
              if (reset) {
                self.error = '加载失败';
                self.hasMore = false;
              } else {
                self.footerError = '加载失败，点击重试';
              }
            })
            .then(function () {
              self.loading = false;
              self.loadingMore = false;
            });
        },
        onScroll: function (ev) {
          var E = this.extract();
          if (!E || this.tab !== 'recommend') return;
          var el = ev && ev.target;
          if (!el) return;
          var remain = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (E.shouldLoadMore(remain, this.loading || this.loadingMore, this.hasMore)) {
            this.loadList(false);
          }
        },
        onOpenCard: function (link) {
          var self = this;
          var E = this.extract();
          if (!E || !link) return;
          var id = E.pickLinkId(link);
          if (!id) return;
          this.detailHint = '';
          this.detailLinkId = id;
          var emitted = emitShowLinkDetail(id, link.link_type);
          if (!emitted) {
            this.detailHint = '无法打开内置详情';
            return;
          }
          if (this.detailTimer) clearTimeout(this.detailTimer);
          this.detailTimer = setTimeout(function () {
            self.detailTimer = 0;
            if (!document.querySelector('.views-post-detail')) {
              self.detailHint = '无法打开内置详情';
            }
          }, DETAIL_WAIT_MS);
        },
        onOpenTopicFromCard: function (ev, topic) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          if (!topic || !topic.id) return;
          this.onSelectTopic(topic.id);
        },
        onOpenHome: function () {
          openHomeInBrowser();
        },
        onOpenHintLink: function () {
          if (this.detailLinkId) openLinkInBrowser(this.detailLinkId);
        },
        isOfficialDetailOpen: function () {
          return !!document.querySelector('.views-post-detail, .link-detail');
        },
        syncDetailOpen: function () {
          var open = this.isOfficialDetailOpen();
          if (open !== this.detailOpen) this.detailOpen = open;
        },
        startDetailWatch: function () {
          var self = this;
          this.syncDetailOpen();
          if (this.detailObs) return;
          this.detailObs = new MutationObserver(function () {
            self.syncDetailOpen();
          });
          this.detailObs.observe(document.body, { childList: true, subtree: true });
        },
        stopDetailWatch: function () {
          if (!this.detailObs) return;
          this.detailObs.disconnect();
          this.detailObs = null;
        },
        renderChip: function (h, topic, active) {
          var self = this;
          return h(
            'button',
            {
              class: { 'bhchat-bbs-chip': true, 'is-active': !!active },
              attrs: { type: 'button' },
              on: {
                click: function () {
                  self.onSelectTopic(topic ? topic.id : '');
                },
              },
            },
            topic ? topic.name : '全部',
          );
        },
        renderRail: function (h) {
          if (this.tab !== 'recommend' || this.detailOpen) return null;
          if (!this.recommendTopics.length && !this.hotTopics.length) return null;
          var nodes = [h('div', { class: 'bhchat-bbs-rail-title' }, '为你推荐'), this.renderChip(h, null, !this.topicId)];
          var i;
          for (i = 0; i < this.recommendTopics.length; i++) {
            nodes.push(this.renderChip(h, this.recommendTopics[i], this.topicId === this.recommendTopics[i].id));
          }
          if (this.hotTopics.length) {
            nodes.push(h('div', { class: 'bhchat-bbs-rail-title' }, '近期热门'));
            for (i = 0; i < this.hotTopics.length; i++) {
              nodes.push(this.renderChip(h, this.hotTopics[i], this.topicId === this.hotTopics[i].id));
            }
          }
          return h('aside', { class: 'bhchat-bbs-rail large-scrollbar' }, nodes);
        },
        renderBody: function (h, E) {
          var self = this;
          if (!E) {
            return [
              h('div', { class: 'bhchat-bbs-state' }, [
                h('div', '社区模块未就绪'),
                h('div', { class: 'bhchat-bbs-state-actions' }, [hBtn(h, '在浏览器打开', 'primary', self.onOpenHome)]),
              ]),
            ];
          }
          if (this.tab === 'follow') {
            return [
              h('div', { class: 'bhchat-bbs-state' }, [
                h('div', '关注流即将支持'),
                h('div', { class: 'bhchat-bbs-state-actions' }, [
                  hBtn(h, '查看推荐', 'primary', function () {
                    self.onSelectTab('recommend');
                  }),
                ]),
              ]),
            ];
          }
          var nodes = [];
          if (this.detailHint) {
            nodes.push(
              h('div', { class: 'bhchat-bbs-hint' }, [
                h('span', this.detailHint),
                h(
                  'button',
                  {
                    class: 'bhchat-bbs-retry',
                    attrs: { type: 'button' },
                    on: { click: self.onOpenHintLink },
                  },
                  '在浏览器打开该帖',
                ),
              ]),
            );
          }
          if (this.error === '加载失败' || this.error === '社区模块未就绪') {
            nodes.push(
              h('div', { class: 'bhchat-bbs-state' }, [
                h('div', '加载失败'),
                h('div', { class: 'bhchat-bbs-state-actions' }, [
                  hBtn(h, '重试', 'primary', function () {
                    self.loadList(true);
                  }),
                  hBtn(h, '在浏览器打开', 'secondary', self.onOpenHome),
                ]),
              ]),
            );
            return nodes;
          }
          if (!resolveSignedGet() && !this.links.length && !this.loading) {
            nodes.push(
              h('div', { class: 'bhchat-bbs-state' }, [
                h('div', '官方接口未就绪'),
                h('div', { class: 'bhchat-bbs-state-actions' }, [
                  hBtn(h, '重试', 'primary', function () {
                    httpResolved = false;
                    signedGetFn = null;
                    self.loadList(true);
                  }),
                  hBtn(h, '在浏览器打开', 'secondary', self.onOpenHome),
                ]),
              ]),
            );
            return nodes;
          }
          if (this.loading && !this.links.length) {
            nodes.push(h('div', { class: 'bhchat-bbs-state' }, [h('div', { class: 'text-tx-3' }, '加载中…')]));
            return nodes;
          }
          if (!this.links.length) {
            nodes.push(h('div', { class: 'bhchat-bbs-state' }, [h('div', '这里还没有帖子')]));
            return nodes;
          }
          for (var i = 0; i < this.links.length; i++) {
            nodes.push(renderCard(h, self, E, this.links[i]));
          }
          if (this.footerError) {
            nodes.push(
              h('div', { class: 'bhchat-bbs-footer' }, [
                h(
                  'button',
                  {
                    class: 'bhchat-bbs-retry',
                    attrs: { type: 'button' },
                    on: {
                      click: function () {
                        self.loadList(false);
                      },
                    },
                  },
                  this.footerError,
                ),
              ]),
            );
          } else if (this.loadingMore) {
            nodes.push(h('div', { class: 'bhchat-bbs-footer' }, '加载中…'));
          }
          return nodes;
        },
      },
      render: function (h) {
        var self = this;
        var E = this.extract();
        var titleKids = [
          h('div', { class: 'bhchat-bbs-title-text' }, '社区'),
          h('div', { class: 'bhchat-bbs-tabs' }, [
            h(
              'button',
              {
                class: { 'bhchat-bbs-tab': true, 'is-active': this.tab === 'follow' },
                attrs: { type: 'button' },
                on: {
                  click: function () {
                    self.onSelectTab('follow');
                  },
                },
              },
              '关注',
            ),
            h(
              'button',
              {
                class: { 'bhchat-bbs-tab': true, 'is-active': this.tab === 'recommend' },
                attrs: { type: 'button' },
                on: {
                  click: function () {
                    self.onSelectTab('recommend');
                  },
                },
              },
              '推荐',
            ),
          ]),
          h('div', { class: 'bhchat-bbs-title-grow' }),
        ];
        if (this.tab === 'recommend') {
          titleKids.push(
            h(
              'button',
              {
                class: { 'bhchat-bbs-refresh': true, 'is-busy': this.loading && !this.loadingMore },
                attrs: { type: 'button', disabled: this.loading || this.loadingMore, title: '刷新' },
                on: {
                  click: function () {
                    self.refresh();
                  },
                },
              },
              [h('i', { class: 'iconfont icon-clockwise-bold' })],
            ),
          );
        }
        return h(
          'div',
          { class: { 'bhchat-bbs-host': true, 'is-detail-open': this.detailOpen }, ref: 'host' },
          [
            h('div', { class: 'bhchat-bbs-title' }, titleKids),
            h('div', { class: 'bhchat-bbs-body' }, [
              h(
                'div',
                {
                  class: 'bhchat-bbs-list large-scrollbar',
                  on: {
                    scroll: function (ev) {
                      self.onScroll(ev);
                    },
                  },
                },
                [h('div', { class: 'bhchat-bbs-feed' }, this.renderBody(h, E))],
              ),
              this.renderRail(h),
            ]),
          ],
        );
      },
    };
  }

  function replaceExistingRoute(router, page) {
    if (!router || typeof router.getRoutes !== 'function') return false;
    var routes = router.getRoutes();
    for (var i = 0; i < routes.length; i++) {
      var rec = routes[i];
      if (!rec || rec.name !== ROUTE_NAME) continue;
      rec.components = rec.components || {};
      rec.components.default = page;
      rec.component = page;
      rec.instances = {};
      return true;
    }
    return false;
  }

  function addRoute() {
    var router = getRouter();
    if (!router || typeof router.addRoute !== 'function' || routeAdded) return router;
    var page = buildPageComponent();
    if (router.hasRoute && router.hasRoute(ROUTE_NAME)) {
      replaceExistingRoute(router, page);
      routeAdded = true;
      return router;
    }
    router.addRoute('main', {
      name: ROUTE_NAME,
      path: ROUTE_PATH,
      component: page,
    });
    if (typeof router.afterEach === 'function') {
      router.afterEach(function () {
        syncEntryActive();
      });
    }
    routeAdded = true;
    return router;
  }

  function openBbs() {
    var router = addRoute() || getRouter();
    if (!router) return;
    router.push({ name: ROUTE_NAME }).catch(function () {
      router.push(ROUTE_PATH).catch(function () {});
    });
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatBbsPanel',
      methods: {
        onOpenBrowser: function () {
          openHomeInBrowser();
        },
      },
      render: function (h) {
        var self = this;
        return h('div', [
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: { 'bhchat-btn': true, 'bhchat-btn-primary': true },
                attrs: { type: 'button' },
                on: {
                  click: function () {
                    self.onOpenBrowser();
                  },
                },
              },
              '在浏览器打开',
            ),
          ]),
        ]);
      },
    };
  }

  function activate() {
    if (started) return;
    started = true;
    try {
      if (!window.BhchatHeyboxBbs) injectUserScript(EXTRACT_FILE);
    } catch (err) {
      console.warn('[BetterHeyboxChat] heybox-bbs extract:', err && err.message);
    }
    addRoute();
    watchSidebar();
    if (window.BHChat && window.BHChat.registerPanel) {
      window.BHChat.registerPanel({
        id: PLUGIN_ID,
        title: '小黑盒社区',
        component: buildPanelComponent(),
      });
    }
  }

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  }
  if ((document.getElementById('app') && document.getElementById('app').__vue__) || !window.BHChat) {
    activate();
  }
})();
