/**
 * MD3 皮肤 1.0.0 —— 一套把黑盒语音改成 Material You 观感的插件
 *
 * 它做四件事：
 *   ① 配色：由主题色生成 MD3 调色板，覆盖客户端设计变量（深浅两套、纯色无渐变）
 *   ② 画布：接管客户端背景（渐变/房间图），按 MD3 表面层级铺色
 *   ③ 控件与动效：按钮/输入/列表圆角、状态层、按下波纹、MD3 曲线
 *   ④ 图标：把系统图标换成 Material Symbols（实心/线框、可跟随主题色）
 *
 * 关键实现前提（踩过的坑，改代码前先看）：
 *   · 客户端把配色变量同时定义在 `body` 与 `body .theme-reset`（含 `[theme=…]` 属性写法），
 *     变量块必须把所有选择器都写上，否则左栏/语音卡/输入框会拿不到新色
 *   · 房间背景是 <img>（.layout-bg img / .background-img），不是 CSS 背景，必须 display:none
 *   · 语音栏降噪/麦克风的图标是「方块 + 挖空字形」的复合 SVG 路径，只能藏掉 svg 再自己画
 *   · `.theme-reset` 常带 theme 属性，客户端用更高特异性覆盖，所以每支都要显式列出
 *
 * 支持的客户端：1.56.0 ~ 1.60.0
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'md3-skin';
  var CONF_KEY = 'settings';
  var STYLE_ID = 'bhchat-md3-skin';
  var PRESETS = [
    { id: 'md3', name: 'MD3 紫', seed: '#6750a4' },
    { id: 'blue', name: '湖蓝', seed: '#0b57d0' },
    { id: 'teal', name: '青碧', seed: '#006a6a' },
    { id: 'green', name: '苔绿', seed: '#386a20' },
    { id: 'amber', name: '琥珀', seed: '#8b5000' },
    { id: 'red', name: '朱红', seed: '#b3261e' },
    { id: 'slate', name: '石板灰', seed: '#49454f' },
    { id: 'rose', name: '玫瑰', seed: '#984061' },
  ];

  var VARIANTS = {
    tonal: { id: 'tonal', name: '柔和', chroma: 36 },
    vibrant: { id: 'vibrant', name: '鲜明', chroma: 60 },
    neutral: { id: 'neutral', name: '中性', chroma: 8 },
  };

  var DEFAULTS = {
    enabled: false,

    // ---- 配色
    seed: '#6750a4', // 手动主题色（MD3 基线紫）
    variant: 'tonal', // tonal | vibrant | neutral
    themeLock: 'off', // off=跟随客户端/房间 | dark=强制深色 | light=强制浅色

    // ---- 壁纸取色
    wallpaper: '', // 当前生效的图（仅内存，不落盘）
    wallpapers: [], // 壁纸库元信息 [{id,name,seed,size,at}]，图数据存在 wall_<id> 键
    activeWallId: '',
    wallMode: 'fixed', // fixed=固定在当前这张 | rotate=轮换
    rotateOrder: 'random', // random | sequence
    rotateWhen: 'launch', // launch=每次打开 | daily=每日
    rotateIndex: 0, // 顺序轮换游标
    rotateAt: '', // 上次轮换日期（YYYY-MM-DD）
    wallpaperMode: 'off', // off=不用 | color=仅取色 | cover=作背景
    wallpaperOpacity: 0.35, // 作背景时的遮罩强度
    wallpaperBlur: 0, // 壁纸高斯模糊（px，0 = 不模糊）
    panelBlur: 0, // 面板/顶栏的毛玻璃强度（px，作用在面板自身，不动壁纸）
    panelOpacity: 85, // 侧栏/输入区不透明度（%，100=不透明）
    wallpaperQuality: 'standard', // standard | high | original —— 只影响之后选的图
    roomCard: 'full', // full=完整房间卡片（横幅+工具条）| compact=只留头像和名字
    headerOpacity: 100, // 房间名顶栏不透明度（0=全透，会看到下面滚过的内容）
    shareOpacity: 0, // 屏幕共享底板不透明度（黑色，0=全透）
    accentBoost: 1, // 强调色饱和度倍率
    bgChroma: 1, // 背景饱和度倍率
    bgBright: 1, // 背景明亮倍率

    // ---- 表面与画布
    canvas: true, // 接管客户端背景（渐变/房间图）
    look: 'md3', // md3 | telegram（中性紧凑）
    railSelect: 'ring', // ring | square | bar | tint
    killSidebarDecor: true,
    killIconBox: true,
    shellTop: true,
    shellRail: true,

    // ---- 控件与动效
    ripple: true,
    comp: { button: true, icon: true, list: true, input: true, dialog: true, motion: true },

    // ---- 图标
    iconReplace: true, // 总开关：关掉后所有图标槽位一律不生效
    style: 'filled', // filled | outlined
    scope: 'button', // button | all
    colorMode: 'brand', // brand | text | custom
    customColor: '#7dd95e',
    blockSize: 66,
    glyphPx: 20,
    slots: {
      railInbox: true,
      railTools: true,
      gear: true,
      search: false,
      notice: false,
      noticeOff: false,
      horn: false,
      more: false,
      friends: false,
      voiceDenoise: true,
      voiceMic: true,
      voiceSpeaker: true,
      voiceMicOff: true,
      voiceMicLocked: true,
      voiceSpkOff: true,
      voiceMuteSvg: true,
    },
  };

  function cloneDefaults() {
    var d = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      d[k] = DEFAULTS[k];
    });
    d.comp = Object.assign({}, DEFAULTS.comp);
    d.slots = Object.assign({}, DEFAULTS.slots);
    return d;
  }

  var settings = cloneDefaults();

  var kv = null;
  var rotateTimer = null;
  var styleEl = null;
  var panelRefresh = null;
  var current = { seed: '', source: '', roles: null };
  var diag = []; // 取色/定色过程记录，面板展示用
  var unwatchRoom = null;
  var extractSeq = 0;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // ---------------------------------------------------------------- 颜色

  function parseHex(hex) {
    var s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }

  function toHex(c) {
    function p(n) {
      var v = clamp(Math.round(n), 0, 255).toString(16);
      return v.length === 1 ? '0' + v : v;
    }
    return '#' + p(c.r) + p(c.g) + p(c.b);
  }

  function withAlpha(c, a) {
    var v = clamp(Math.round(a * 255), 0, 255).toString(16);
    if (v.length === 1) v = '0' + v;
    return toHex(c) + v;
  }

  function srgbToLinear(v) {
    var x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(x) {
    var v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return clamp(v * 255, 0, 255);
  }

  /** sRGB → XYZ(D65) → CIELAB */
  function rgbToLab(c) {
    var r = srgbToLinear(c.r);
    var g = srgbToLinear(c.g);
    var b = srgbToLinear(c.b);
    var x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    var y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    var z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
    }
    var fx = f(x);
    var fy = f(y);
    var fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function labToRgb(lab) {
    var fy = (lab.L + 16) / 116;
    var fx = fy + lab.a / 500;
    var fz = fy - lab.b / 200;
    function inv(t) {
      return t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787;
    }
    var x = inv(fx) * 0.95047;
    var y = inv(fy);
    var z = inv(fz) * 1.08883;
    var r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    var g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
    var b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
  }

  function labToLch(lab) {
    return {
      L: lab.L,
      C: Math.sqrt(lab.a * lab.a + lab.b * lab.b),
      h: Math.atan2(lab.b, lab.a) * (180 / Math.PI),
    };
  }

  function lchToLab(lch) {
    var rad = lch.h * (Math.PI / 180);
    return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) };
  }

  /** 在色域外就逐步降彩度，保证输出一定落在 sRGB 内 */
  function lchToHexSafe(lch) {
    var c = lch.C;
    for (var i = 0; i < 24; i++) {
      var rgb = labToRgb(lchToLab({ L: lch.L, C: c, h: lch.h }));
      var inGamut =
        rgb.r >= -0.5 && rgb.r <= 255.5 && rgb.g >= -0.5 && rgb.g <= 255.5 && rgb.b >= -0.5 && rgb.b <= 255.5;
      if (inGamut) return toHex(rgb);
      c *= 0.85;
    }
    return toHex(labToRgb(lchToLab({ L: lch.L, C: 0, h: lch.h })));
  }

  // ------------------------------------------------------ MD3 tone → roles

  /**
   * 由 seed 生成两套 MD3 色彩角色（dark / light）。
   * tone 就是 CIELAB 的 L*，这也是 MD3 tonal palette 的定义方式。
   */
  function buildRoles(seedHex, variantId, opts) {
    var opt = opts || {};
    var accentBoost = typeof opt.accentBoost === 'number' ? opt.accentBoost : 1;
    var bgChroma = typeof opt.bgChroma === 'number' ? opt.bgChroma : 1;
    var bgBright = typeof opt.bgBright === 'number' ? opt.bgBright : 1;
    var seed = parseHex(seedHex);
    if (!seed) return null;
    var lch = labToLch(rgbToLab(seed));
    var hue = lch.h;
    var chromaTarget = (VARIANTS[variantId] || VARIANTS.tonal).chroma;
    // seed 本身太灰（比如黑色压缩图）时给一个保底彩度，否则整界面会变水泥
    var chroma = clamp(Math.max(chromaTarget, Math.min(lch.C, chromaTarget)) * accentBoost, 2, 90);

    function tone(L, c) {
      return lchToHexSafe({ L: Math.round(L), C: c == null ? chroma : c, h: hue });
    }
    /** 表面色（受背景饱和度/明亮度影响）；isLight 时亮度按加法偏移，深色按乘法 */
    function surf(L, isLight) {
      var nl = isLight ? clamp(L + (bgBright - 1) * 10, 0, 100) : clamp(L * bgBright, 0, 100);
      return lchToHexSafe({ L: Math.round(nl), C: Math.min(4, chroma * 0.1) * bgChroma, h: hue });
    }

    function neutral(L) {
      // neutral 系列只留一点点色相，MD3 里是靠很低的 chroma
      return lchToHexSafe({ L: Math.round(L), C: Math.min(4, chroma * 0.1), h: hue });
    }

    return {
      dark: {
        primary: tone(80),
        onPrimary: tone(20, chroma * 0.6),
        primaryContainer: tone(30),
        onPrimaryContainer: tone(90, chroma * 0.4),
        secondary: tone(80, chroma * 0.45),
        secondaryContainer: tone(30, chroma * 0.45),
        onSecondaryContainer: tone(90, chroma * 0.3),
        surface: surf(6, false),
        surfaceContainerLow: surf(12, false),
        surfaceContainer: surf(17, false),
        surfaceContainerHigh: surf(22, false),
        surfaceContainerHighest: surf(30, false),
        contentGray: tone(16, 3),
        // 主容器色的邻居档：让「紫色画布」也能拉层级
        containerLow: tone(24, 32),
        containerHigh: tone(38, 36),
        onSurface: surf(90, false),
        onSurfaceVariant: surf(80, false),
        outline: surf(60, false),
        outlineVariant: surf(30, false),
        error: lchToHexSafe({ L: 80, C: 45, h: 25 }),
      },
      light: {
        primary: tone(40),
        onPrimary: surf(100, true),
        primaryContainer: tone(90),
        onPrimaryContainer: tone(10),
        secondary: tone(40, chroma * 0.45),
        secondaryContainer: tone(90, chroma * 0.45),
        onSecondaryContainer: tone(10, chroma * 0.3),
        // 浅色按「底板略暗、卡片纯白」排（参考 iOS/Clash 那类观感，不是 MD3 规范的反向层级）
        surface: surf(96, true),
        surfaceContainerLow: surf(99, true),
        surfaceContainer: surf(99, true),
        surfaceContainerHigh: surf(100, true),
        surfaceContainerHighest: surf(100, true),
        contentGray: tone(92, 3),
        containerLow: tone(94, 24),
        containerHigh: tone(80, 32),
        onSurface: surf(10, true),
        onSurfaceVariant: surf(30, true),
        outline: surf(50, true),
        outlineVariant: surf(80, true),
        error: lchToHexSafe({ L: 40, C: 45, h: 25 }),
      },
      meta: {
        hue: Math.round(((hue % 360) + 360) % 360), // 归一化到 0–360，方便面板显示
        chroma: Math.round(chroma),
        seed: toHex(seed),
      },
    };
  }

  // --------------------------------------------- MD3 roles → 客户端变量

  function tokensFromRoles(roles) {
    return {
      dark: {
        // 导出给其它插件稳定取用：即使别的插件改写 --brand-text，这个也不会被抢
        // 客户端用 --opacity-* 这类「白色/黑色 + 透明度」当文字与描边色，
        // 不接管的话锁定主题后文字会变成另一种底色上的颜色（深底黑字）
        '--opacity-0': 'rgba(255,255,255,.02)',
        '--opacity-1': 'rgba(255,255,255,.04)',
        '--opacity-2': 'rgba(255,255,255,.08)',
        '--opacity-3': 'rgba(255,255,255,.28)',
        '--opacity-4': 'rgba(255,255,255,.5)',
        '--opacity-5': 'rgba(255,255,255,.88)',
        '--opacity-6': 'rgba(255,255,255,.72)',
        '--opacity-10': 'rgba(255,255,255,.1)',
        '--opacity-20': 'rgba(255,255,255,.2)',
        '--opacity-3-6': 'rgba(255,255,255,.17)',
        '--opacity-s1': 'rgba(28,28,28,.5)',
        '--opacity-s2': 'rgba(0,0,0,.2)',
        '--opacity-s3': 'rgba(0,0,0,.3)',
        '--opacity-s4': 'rgba(0,0,0,.5)',
        '--opacity-s5': 'rgba(0,0,0,.7)',
        '--text-3-op-10': withAlpha(roles.dark.onSurfaceVariant, 0.1),
        '--text-3-op-20': withAlpha(roles.dark.onSurfaceVariant, 0.2),
        '--text-2-op-40': withAlpha(roles.dark.onSurfaceVariant, 0.4),
        '--md3-primary': roles.dark.primary,
        '--md3-primary-container': roles.dark.primaryContainer,
        '--md3-surface': roles.dark.surface,
        '--md3-surface-low': roles.dark.surfaceContainerLow,
        '--md3-surface-high': roles.dark.surfaceContainerHigh,
        '--md3-surface-highest': roles.dark.surfaceContainerHighest,
        '--md3-container-low': roles.dark.containerLow,
        '--md3-content-gray': roles.dark.contentGray,
        '--md3-container-high': roles.dark.containerHigh,
        '--brand-fill': roles.dark.primary,
        '--brand-fill-op-40': withAlpha(roles.dark.primary, 0.4),
        '--brand-text': roles.dark.primary,
        '--brand-h': roles.dark.primary, // 不做渐变，纯色
        '--brand-h-last': roles.dark.secondary,
        '--f-success-fill': roles.dark.primary,
        '--f-success-text': roles.dark.primary,
        '--f-error-fill': roles.dark.error,
        '--f-error-text': roles.dark.error,
        '--fill-1': roles.dark.surfaceContainerHigh,
        '--fill-1-50': withAlpha(roles.dark.surfaceContainerHigh, 0.5),
        '--fill-2': roles.dark.surfaceContainer,
        '--fill-2-90': withAlpha(roles.dark.surfaceContainer, 0.9),
        '--fill-3': roles.dark.surfaceContainerLow,
        '--fill-button': roles.dark.surfaceContainerHigh,
        '--fill-input': roles.dark.surfaceContainerLow,
        '--fill-select': withAlpha(roles.dark.primaryContainer, 0.35),
        '--fill-navi': roles.dark.surface,
        '--fill-popover': roles.dark.surfaceContainerHigh,
        '--fill-chat-bubble': withAlpha(roles.dark.primaryContainer, 0.6),
        '--text-1': roles.dark.onSurface,
        '--text-2': roles.dark.onSurfaceVariant,
        '--text-3': withAlpha(roles.dark.onSurfaceVariant, 0.75),
        '--text-4': withAlpha(roles.dark.onSurfaceVariant, 0.55),
        '--line-1': roles.dark.outlineVariant,
        '--line-2': withAlpha(roles.dark.outline, 0.45),
      },
      light: {
        '--opacity-0': 'rgba(0,0,0,.02)',
        '--opacity-1': 'rgba(0,0,0,.05)',
        '--opacity-2': 'rgba(0,0,0,.08)',
        '--opacity-3': 'rgba(0,0,0,.28)',
        '--opacity-4': 'rgba(0,0,0,.5)',
        '--opacity-5': 'rgba(0,0,0,.88)',
        '--opacity-6': 'rgba(0,0,0,.65)',
        '--opacity-10': 'rgba(0,0,0,.1)',
        '--opacity-20': 'rgba(0,0,0,.2)',
        '--opacity-3-6': 'rgba(0,0,0,.17)',
        '--opacity-s1': 'rgba(231,231,231,.5)',
        '--opacity-s2': 'rgba(0,0,0,.07)',
        '--opacity-s3': 'rgba(255,255,255,.3)',
        '--opacity-s4': 'rgba(255,255,255,.5)',
        '--opacity-s5': 'rgba(255,255,255,.75)',
        '--text-3-op-10': withAlpha(roles.light.onSurfaceVariant, 0.1),
        '--text-3-op-20': withAlpha(roles.light.onSurfaceVariant, 0.2),
        '--text-2-op-40': withAlpha(roles.light.onSurfaceVariant, 0.4),
        '--md3-primary': roles.light.primary,
        '--md3-primary-container': roles.light.primaryContainer,
        '--md3-surface': roles.light.surface,
        '--md3-surface-low': roles.light.surfaceContainerLow,
        '--md3-surface-high': roles.light.surfaceContainerHigh,
        '--md3-surface-highest': roles.light.surfaceContainerHighest,
        '--md3-container-low': roles.light.containerLow,
        '--md3-content-gray': roles.light.contentGray,
        '--md3-container-high': roles.light.containerHigh,
        '--brand-fill': roles.light.primary,
        '--brand-fill-op-40': withAlpha(roles.light.primary, 0.4),
        '--brand-text': roles.light.primary,
        '--brand-h': roles.light.primary, // 不做渐变，纯色
        '--brand-h-last': roles.light.secondary,
        '--f-success-fill': roles.light.primary,
        '--f-success-text': roles.light.primary,
        '--f-error-fill': roles.light.error,
        '--f-error-text': roles.light.error,
        '--fill-1': roles.light.surfaceContainerHigh,
        '--fill-1-50': withAlpha(roles.light.surfaceContainerHigh, 0.5),
        '--fill-2': roles.light.surfaceContainer,
        '--fill-2-90': withAlpha(roles.light.surfaceContainer, 0.9),
        '--fill-3': roles.light.surfaceContainerLow,
        '--fill-button': roles.light.surfaceContainerHigh,
        '--fill-input': roles.light.surfaceContainerLow,
        '--fill-select': withAlpha(roles.light.primaryContainer, 0.45),
        '--fill-navi': roles.light.surface,
        '--fill-popover': roles.light.surfaceContainerHigh,
        '--fill-chat-bubble': withAlpha(roles.light.primaryContainer, 0.5),
        '--text-1': roles.light.onSurface,
        '--text-2': roles.light.onSurfaceVariant,
        '--text-3': withAlpha(roles.light.onSurfaceVariant, 0.8),
        '--text-4': withAlpha(roles.light.onSurfaceVariant, 0.6),
        '--line-1': roles.light.outlineVariant,
        '--line-2': withAlpha(roles.light.outline, 0.45),
      },
    };
  }

  // MD3 的动效曲线与时长（官方规范值）
  var MOTION = {
    standard: 'cubic-bezier(.2,0,0,1)',
    emphasized: 'cubic-bezier(.3,0,0,1)',
  };

  /** MD3 状态层：用 inset 阴影叠一层，不改背景、不影响布局 */
  function stateLayer(pct) {
    return 'box-shadow:inset 0 0 0 999px color-mix(in srgb,var(--text-1) ' + pct + '%,transparent)';
  }

  /**
   * P2：控件 MD3 化。
   * 原则：只改圆角 / 状态层 / 描边 / 过渡，**不改任何 width/height/margin/padding** ——
   * 前两次错位都是动布局度量造成的。
   */
  function componentCss(comp) {
    var out = [];
    var ease = MOTION.standard;

    if (comp.motion) {
      out.push(
        'html body .cpt-chat-form-button,html body .tools-item,html body .icon-btn,' +
          'html body .cpt-friend-item,html body .cpt-channel-item-wrapper{transition:' +
          'border-radius .15s ' + ease + ',box-shadow .15s ' + ease + ',background-color .15s ' + ease + '}',
      );
    }

    if (comp.button) {
      // Filled Button：全圆角 + 8%/12% 状态层
      out.push(
        'html body .submit-timing-button{border-radius:20px;overflow:hidden}' +
          'html body .submit-timing-button .cpt-chat-form-button{border-radius:20px!important}' +
          'html body .submit-timing-button:not(.disabled):hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.08)}' +
          'html body .submit-timing-button:not(.disabled):active{box-shadow:inset 0 0 0 999px rgba(255,255,255,.12)}' +
          // 空房间页那个邀请按钮也是 Button，但它是 .no-channel .btn，单独给
          'html body .no-channel .btn{border-radius:20px}' +
          'html body .no-channel .btn:hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.08)}',
      );
    }

    if (comp.icon) {
      // Icon Button：圆形 + 状态层
      out.push(
        'html body .tools-item{border-radius:50%}' +
          'html body .icon-btn{border-radius:50%}' +
          'html body .tools-item:hover,html body .icon-btn:hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.08)}' +
          'html body .tools-item:active,html body .icon-btn:active{box-shadow:inset 0 0 0 999px rgba(255,255,255,.12)}',
      );
    }

    if (comp.list) {
      // List Item：12px 圆角 + 状态层（行高不动）
      out.push(
        'html body .cpt-friend-item,html body .cpt-channel-item-wrapper{border-radius:12px}' +
          'html body .cpt-friend-item:hover,html body .cpt-channel-item-wrapper:hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.06)}' +
          'html body .cpt-friend-item:active,html body .cpt-channel-item-wrapper:active{box-shadow:inset 0 0 0 999px rgba(255,255,255,.1)}',
      );
    }

    if (comp.input) {
      // Outlined 输入区：28 圆角 + 1px 描边，聚焦 2px 品牌色
      out.push(
        'html body .im-rich-text-message-input{border-radius:28px;box-shadow:inset 0 0 0 1px var(--line-2);' +
          'transition:box-shadow .15s ' + ease + '}' +
          'html body .im-rich-text-message-input:focus-within{box-shadow:inset 0 0 0 2px var(--brand-text)}' +
          'html body .cpt-search-input{border-radius:28px}',
      );
    }

    if (comp.dialog) {
      out.push(
        'html body .el-dialog__body{border-radius:28px}' +
          'html body .bhchat-dialog{border-radius:28px}',
      );
    }

    // 键盘可达性：MD3 焦点环（不影响鼠标操作）
    out.push(
      'html body .cpt-chat-form-button:focus-visible,html body .tools-item:focus-visible,' +
        'html body .cpt-friend-item:focus-visible{outline:2px solid var(--brand-text);outline-offset:2px}',
    );

    return out.join('');
  }

  // ------------------------------------------------------------ P3 波纹

  var RIPPLE_CLASS = 'bhchat-md3-ripple';
  var RIPPLE_CLIP_CLASS = 'bhchat-md3-ripple-clip';
  var RIPPLE_TARGETS = [
    '.submit-timing-button',
    '.no-channel .btn',
    '.tools-item',
    '.icon-btn',
    '.bhchat-btn',
    '.cpt-friend-item',
    '.cpt-channel-item-wrapper',
  ].join(',');
  var rippleBound = false;
  var rippleSeq = 0;

  function rippleCss() {
    if (!settings.ripple) return '';
    return (
      // 裁切层：和宿主同框、继承圆角、overflow:hidden —— 波纹只在被点的控件里扩散
      'html body .' + RIPPLE_CLIP_CLASS + '{position:absolute;inset:0;overflow:hidden;' +
      'border-radius:inherit;pointer-events:none;z-index:0}' +
      'html body .' + RIPPLE_CLASS + '{position:absolute;border-radius:50%;pointer-events:none;' +
      'transform:scale(0);background-color:color-mix(in srgb,var(--text-1) 32%,transparent);' +
      'animation:bhchat-md3-ripple .5s ' + MOTION.standard + ' forwards}' +
      '@keyframes bhchat-md3-ripple{to{transform:scale(1);opacity:0}}' +
      // 波纹宿主需要定位上下文；只加 position，不改尺寸
      'html body ' + RIPPLE_TARGETS.split(',').join(',html body ') + '{position:relative}'
    );
  }

  /** 在宿主上画一个波纹：先套一层 overflow:hidden 的裁切层，圆只在宿主框内扩散 */
  function pulse(host, clientX, clientY) {
    if (!settings.enabled || !settings.ripple || !host || !host.getBoundingClientRect) return null;
    if (typeof host.appendChild !== 'function') return null;
    if (rippleSeq > 40) return null;
    try {
      var rect = host.getBoundingClientRect();
      // 只要盖满对角线即可；2 倍会溢到相邻控件外
      var size = Math.round(Math.sqrt(rect.width * rect.width + rect.height * rect.height) * 1.1);
      var x = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
      var y = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;

      var clip = document.createElement('span');
      clip.className = RIPPLE_CLIP_CLASS;

      var el = document.createElement('span');
      el.className = RIPPLE_CLASS;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.left = x - size / 2 + 'px';
      el.style.top = y - size / 2 + 'px';

      clip.appendChild(el);
      host.appendChild(clip);
      rippleSeq++;

      setTimeout(function () {
        if (clip.parentNode) clip.parentNode.removeChild(clip);
        rippleSeq = Math.max(0, rippleSeq - 1);
      }, 560);
      return el;
    } catch (err) {
      return null;
    }
  }

  function findRippleHost(node) {
    var el = node;
    var guard = 0;
    while (el && el.nodeType === 1 && guard < 6) {
      try {
        if (el.matches && el.matches(RIPPLE_TARGETS)) return el;
      } catch (err) {
        return null;
      }
      el = el.parentElement;
      guard++;
    }
    return null;
  }

  function attachRipple() {
    if (rippleBound || !settings.ripple) return;
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener(
      'pointerdown',
      function (ev) {
        if (!settings.enabled || !settings.ripple) return;
        if (ev && ev.button != null && ev.button !== 0) return; // 只响应左键/触摸
        var host = findRippleHost(ev && ev.target);
        if (!host) return;
        pulse(host, ev.clientX, ev.clientY);
      },
      true,
    );
    rippleBound = true;
  }

  function detachRipple() {
    // 只清掉残留节点；监听器留着也无害（内部会先判 settings）
    try {
      var list = document.querySelectorAll('.' + RIPPLE_CLIP_CLASS) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
      }
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * 外框（应用外壳）：顶部 30px 的窗口底色 + 左侧 66px 导航栏。
   * 这两块不跟内容区走同一个背景层，换肤后容易留着旧色，所以单独对齐到 MD3 表面色。
   * 只动 background-color，不碰任何尺寸。
   */
  /** 画布底色：固定用 MD3 surface（档位选项已移除） */
  function canvasColor() {
    return 'var(--md3-surface,var(--fill-1))';
  }

  /**
   * 接管画布：掐掉客户端的渐变/图片背景，整窗用 MD3 纯色填充。
   * 客户端背景是 Vue 绑在 .layout-bg 的 inline style 上，把 background-image / filter / opacity 一起压掉；
   * 那个 filter: blur(...) 就是换房间时整屏重绘卡顿的来源。
   */
  function canvasCss() {
    if (!settings.canvas) return '';
    var c = canvasColor();
    return (
      // 权威底色只有一层：html / body
      'html,body{background-color:' + c + ' !important;background-image:none !important}' +
      // 房间背景图是 <img class="img-dom img-fit-cover"> 装在 .background-img.cpt-chat-img 里，
      // 不是 CSS 背景，background-image:none 压不到，必须直接把 img 藏掉
      'html body .layout-bg img,html body .layout-bg .cpt-chat-img,' +
      'html body .background-img,html body .layout-bg-wrapper img' +
      '{display:none !important}' +
      // 客户端那些叠在上面的背景层全部透明，露出下面这一层
      'html body .layout-bg,html body .layout-bg-wrapper{background:transparent !important;' +
      'background-image:none !important;filter:none !important;opacity:1 !important}' +
      // 整条结构链全部透明，只留 html/body 一层出颜色
      'html body #app,html body .desktop,html body .l-home-layout-wrapper,' +
      'html body .layout-content-outer,html body .layout-content-wrapper,html body .layout-content,' +
      'html body .view-room-inner-page,html body .view-room-inner-page-content,' +
      'html body .cpt-im-wrapper,html body .cpt-message-list,html body .scroll-list-content,' +
      'html body .cpt-scroll-list{background-color:transparent !important;background-image:none !important}' +
      // 左下「+」与工具块：客户端用内联 style 写房间的 bar_color，
      // `background: ${getBarColor}` 这种内联样式只有 !important 能压
      'html body .guide-wrapper,html body .add-room-wrapper,' +
      'html body .cpt-shortcut-block-wrapper.guide-wrapper' +
      '{background:var(--md3-surface-high,var(--fill-3)) !important;background-image:none !important}' +
      // 语音栏图标底框：客户端给 .icon-container / .icon 挂了 background-image 渐变，
      // 表现为「降噪 / 麦克风」后面一块方框，只压 background-color 是压不掉的
      (settings.killIconBox
        ? 'html body .cpt-voice-panel .ai-icon .ln-bg,' +
          'html body .cpt-voice-panel .ai-icon .cl-bg,' +
          'html body .ln-bg,' +
          'html body .cl-bg' +
          '{background:none !important;animation:none !important}' +
          'html body .cpt-voice-panel .icon-container,' +
          'html body .cpt-voice-panel .icon-container *' +
          '{background-image:none !important}'
        : '') +
      // 侧栏底部那层「淡出渐变条」：内联 linear-gradient(房间色)
      'html body .left-sidebar-layout .sticky.pointer-events-none' +
      '{background:none !important;background-image:none !important}' +
      // 迷你语音条 / 收件箱块：内联 background: 房间色
      'html body .mini-voice-panel-container,html body .friends-msg-wrapper' +
      '{background:transparent !important;background-image:none !important}' +
      // 顶栏 30px：.cpt-electron-title-bar 自己没有 background 规则
      'html body .cpt-electron-title-bar{background-color:' + c + ' !important;' +
      'background-image:none !important}' +
      // 侧栏里的装饰渐变/散光（品牌色叠层、遮罩淡出）一并清掉
      (settings.killSidebarDecor
        ? 'html body .left-sidebar-layout *{background-image:none !important}' +
          'html body .left-sidebar-layout .sticky,' +
          'html body .left-sidebar-layout .icon{box-shadow:none !important}'
        : '') +
      'html body .layout-bg{background-image:none !important;filter:none !important;opacity:1 !important}' +
      // 注意：不要在这里再给 .layout-bg-wrapper 上色 —— 上面已经把整条结构链设为 transparent，
      // 后写的同优先级规则会反过来覆盖它（曾经就是这么把画布刷成主容器色的）
      'html body .left-sidebar-layout{background-color:var(--md3-surface-low,var(--fill-2)) !important}' +
      'html body .desktop{background-color:transparent}'
    );
  }

  /** 侧栏面板用「比画布高一档」的表面色，形成 MD3 的层级 */
  function panelSurface() {
    return 'var(--md3-surface-low,var(--fill-2))';
  }

  /** 输入框用比画布更高的一档 */
  function inputSurface() {
    return 'var(--md3-surface-highest,var(--fill-3))';
  }

  /**
   * 层级：画布（自选档）→ 频道栏/成员栏（+1 档）→ 输入框（最高档）。
   * 再补一条极淡的分隔线（用 inset shadow，不占布局）。
   */
  function panelCss() {
    var panel = panelSurface();
    var line = 'rgba(255,255,255,0.06)';
    return (
      'html body .cpt-channel-sidebar,html body .friends-sidebar,html body .cpt-voice-panel .sidebar' +
      '{background-color:' + panel + ' !important}' +
      // 房间名那条顶栏被客户端写死成 #080808，不接管就是一条黑杠。
      // 半透明时加背景模糊，避免下面滚过的文字糊在一起
      'html body .top-bar{background-color:color-mix(in srgb, ' + panelSurface() + ' ' +
      clamp(settings.headerOpacity, 0, 100) + '%, transparent) !important;background-image:none !important;' +
      (settings.headerOpacity < 100
        ? 'backdrop-filter:blur(' + (settings.panelBlur > 0 ? settings.panelBlur : 10) + 'px) !important;' +
          '-webkit-backdrop-filter:blur(' + (settings.panelBlur > 0 ? settings.panelBlur : 10) + 'px) !important;'
        : '') +
      '}' +
      'html body .cpt-screen-share-occupy,html body .cpt-screen-share-wrapper .screen-block' +
      '{background-color:rgba(0,0,0,' + clamp(settings.shareOpacity, 0, 100) / 100 + ') !important}' +
      'html body .cpt-channel-sidebar' +
      '{box-shadow:inset -1px 0 0 0 ' + line + ' !important}' +
      'html body .friends-sidebar' +
      '{box-shadow:inset 1px 0 0 0 ' + line + ' !important}' +
      'html body .voice-panel-container{background-color:' + panel + ' !important}'
    );
  }

  /** 中间内容区：固定跟随画布（定色选项已移除） */
  function contentColor() {
    return '';
  }

  function contentCss() {
    var c = contentColor();
    if (!c) return '';
    return (
      'html body .layout-content,html body .layout-content-wrapper,' +
      'html body .cpt-im-wrapper,html body .view-room-inner-page,' +
      'html body .layout-content-outer' +
      '{background-color:' + c + ' !important}'
    );
  }

  /**
   * Telegram 观感：整窗近黑中性、强调色只出现在小面积（发送键、自己的气泡、名字），
   * 组件统一大圆角、输入框成药丸。只动颜色与圆角，不动尺寸。
   */
  /** 浅色专属样式的选择器作用域：锁定浅色→无条件；锁定深色→不输出；否则跟属性 */
  function lightScope() {
    if (settings.themeLock === 'light') return 'html body';
    if (settings.themeLock === 'dark') return null;
    return 'html body[theme=light]';
  }

  function lookCss() {
    if (settings.look !== 'telegram') return '';
    var ls = lightScope();
    var card = 'var(--md3-surface-high,var(--fill-3))';
    return (
      // 底板：整体压到中性近黑，两侧栏和内容区同色（靠分隔线区分）
      'html,body{background-color:var(--md3-surface,var(--fill-1)) !important}' +
      'html body .layout-content,html body .layout-content-wrapper,html body .cpt-im-wrapper,' +
      'html body .view-room-inner-page,html body .cpt-channel-sidebar,html body .friends-sidebar,' +
      'html body .voice-panel-container{background-color:var(--md3-surface,var(--fill-1)) !important}' +
      // 气泡：大圆角卡片
      'html body .cpt-msg-text-wrapper{border-radius:14px !important;background-color:' + card + ' !important}' +
      'html body .cpt-msg-rich-text,html body .msg-text{color:var(--text-1) !important}' +
      // 输入区：药丸
      'html body .im-rich-text-message-input,html body .im-rich-text-message-input .input-div' +
      '{border-radius:22px !important;background-color:' + card + ' !important}' +
      'html body .im-rich-text-message-input .input-div{padding-left:16px !important;padding-right:16px !important}' +
      // 发送键：圆形强调色
      'html body .submit-timing-button .cpt-chat-form-button{border-radius:50% !important;' +
      'background-color:var(--md3-primary,var(--brand-fill)) !important;color:var(--fill-1) !important}' +
      // 列表行 / 头像：圆角化
      'html body .cpt-channel-item-wrapper,html body .cpt-friend-item{border-radius:10px !important}' +
      'html body .cpt-chat-room-avatar{border-radius:50% !important}' +
      'html body .cpt-msg-text-wrapper .cpt-chat-img{border-radius:10px !important}' +
      // 浅色下卡片与底板同为浅色，需要一圈极淡描边才分得开
      (ls
        ? ls + ' .cpt-msg-text-wrapper{box-shadow:0 0 0 1px rgba(0,0,0,.05) !important}' +
          ls + ' .im-rich-text-message-input{box-shadow:inset 0 0 0 1px rgba(0,0,0,.07) !important}' +
          ls + ' .cpt-channel-sidebar,' + ls + ' .friends-sidebar' +
          '{box-shadow:inset -1px 0 0 0 rgba(0,0,0,.06) !important}'
        : '') +
      // 分隔线几乎去掉（Telegram 不用重边界）
      'html body .cpt-channel-sidebar{box-shadow:none !important}' +
      'html body .friends-sidebar{box-shadow:none !important}'
    );
  }

  /**
   * 左栏选中框：客户端用 .shortcut-block.active::before 画一圈 1.6px 的方环（radius 12px）。
   * 头像被改成圆形后，方环和圆头像不匹配，所以给几种样式可选，顺便压掉 ui-kit 那条左侧竖条。
   */
  function railSelectCss() {
    var accent = 'var(--md3-primary,var(--brand-text))';
    var block = 'html body .shortcuts .shortcut-block.active';
    var before = block + '::before';
    var av = block + ' .cpt-chat-room-avatar';
    var out = [];
    if (settings.railSelect === 'ring') {
      out.push(before + '{border-radius:50% !important;border-color:' + accent + ' !important}');
      // 环是圆的，头像也必须圆；整条左栏统一成圆，避免选中圆、未选中方的混搭
      out.push('html body .shortcuts .cpt-chat-room-avatar,html body .shortcuts .shortcut-block img' +
        '{border-radius:50% !important}');
      out.push(block + '{box-shadow:none !important}');
    } else if (settings.railSelect === 'square') {
      out.push(before + '{border-radius:12px !important;border-color:' + accent + ' !important}');
      out.push(av + '{border-radius:12px !important}');
      out.push(block + '{box-shadow:none !important}');
    } else {
      out.push(before + '{content:none !important;border:0 !important}');
      out.push(block + '{box-shadow:none !important;background-color:var(--md3-container-low,var(--fill-select)) !important}');
    }
    return out.join('');
  }

  function shellCss() {
    var out = [];
    if (settings.shellTop) {
      // 底色由 canvasCss 的 html/body 统一负责，这里只处理「非画布层」的容器
      out.push('html body .desktop{background-color:transparent !important}');
    }
    if (settings.shellRail) {
      out.push('html body .left-sidebar-layout{background-color:var(--fill-navi) !important}');
    }
    return out.join('');
  }

  /** #rrggbb + 透明度（0-1）→ #rrggbbaa */
  function withAlpha(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length !== 6) return hex;
    var v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16);
    return '#' + h + (v.length < 2 ? '0' + v : v);
  }

  function decls(obj, important) {
    return Object.keys(obj)
      .map(function (k) {
        return k + ':' + obj[k] + (important ? ' !important' : '');
      })
      .join(';');
  }


  // -------------------------------------------------------------- 取色

  /** rgb()/rgba() → {r,g,b,a}；不认识的格式返回 null */
  function parseCssColor(v) {
    var m = String(v || '').match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    var parts = m[1].split(',').map(function (x) {
      return parseFloat(x);
    });
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  /**
   * 从 linear-gradient(...) 里抠颜色标。
   * 官方「自定义房间背景」给的是渐变色，不是图片 —— 这类房间没有可采样的像素，
   * 只能从色标里挑。
   */
  function parseGradientStops(v) {
    var s = String(v || '');
    if (!/gradient\(/i.test(s)) return [];
    var out = [];
    var re = /rgba?\(([^)]+)\)|#([0-9a-f]{3,8})/gi;
    var m;
    while ((m = re.exec(s))) {
      if (m[1]) {
        var p = m[1].split(',').map(function (x) {
          return parseFloat(x);
        });
        if (p.length >= 3) out.push({ r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 });
      } else if (m[2]) {
        var c = parseHex(m[2]);
        if (c) out.push({ r: c.r, g: c.g, b: c.b, a: 1 });
      }
    }
    return out;
  }

  /**
   * 从一组颜色里挑「最够彩、亮度适中」的那个当种子。
   * minChroma：低于这个彩度就认为整段渐变是灰的（遮罩层、暗角），不配当种子 ——
   * 否则 #20201b 这种近灰色会被选走，再被 MD3 强行拉成橄榄绿。
   */
  function pickFromStops(stops, minChroma) {
    var floor = minChroma == null ? 12 : minChroma;
    var best = null;
    var bestScore = -1;
    stops.forEach(function (c) {
      if (c.a != null && c.a < 0.3) return;
      var lch = labToLch(rgbToLab(c));
      if (lch.L < 8 || lch.L > 96) return;
      if (lch.C < floor) return;
      if (lch.C > bestScore) {
        bestScore = lch.C;
        best = { hex: toHex(c), lch: lch };
      }
    });
    return best;
  }

  function cssUrlToSrc(v) {
    var m = String(v || '').match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : '';
  }

  function computed(el) {
    try {
      return window.getComputedStyle(el);
    } catch (err) {
      return null;
    }
  }

  // 语音栏两个图标的 MD3 替身（Material Symbols，Apache-2.0）
  var VOICE_ICONS = {
    denoise:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M440-878q10-1 20-1.5t20-.5q11 0 20.5.5T520-878v80q-10-2-19.5-2h-41q-9.5 0-19.5 2v-80Zm-168 56q17-11 34.5-19t36.5-15l35 72q-20 6-37.5 14.5T306-750l-34-72Zm382 72q-17-11-34.5-19.5T582-784l35-72q19 7 36.5 15t34.5 19l-34 72Zm99 101q-11-17-24-32.5T702-711l63-50q14 14 27 29.5t24 32.5l-63 50Zm-610-48q11-17 23.5-32.5T193-759l63 50q-14 14-26.5 29.5T206-647l-63-50ZM83-532q2-20 7-39.5t11-38.5l79 18q-7 19-11.5 38.5T162-514l-79-18Zm716 21q-2-20-6.5-40T781-590l78-18q6 19 11 38.5t7 39.5l-78 19Zm-18 141q7-19 11-38t6-39l79 18q-2 20-7 39.5T859-351l-78-19Zm-619-76q2 20 6.5 39.5T180-368l-79 18q-6-19-11-38.5T83-428l79-18Zm543 194q14-14 26-29.5t23-32.5l64 50q-11 17-23.5 32.5T768-202l-63-50Zm-511 52q-14-14-26.5-30T144-263l62-50q11 17 23.5 33t26.5 30l-62 50Zm389 23q20-7 37-15t34-19l35 72q-17 11-34.5 19.5T618-104l-35-73Zm-239 74q-19-7-37-15.5T272-138l35-72q17 11 34.5 19.5T379-176l-35 73Zm136 23q-10 0-20-.5T440-82v-80q13 2 40 2h20.5q9.5 0 19.5-2v80q-10 1-19.5 1.5T480-80Zm40-160q-38 0-69.5-23T406-322q-3-9-6.5-17.5T389-355l-55-55q-26-26-40-59.5T280-540q0-75 52.5-127.5T460-720q69 0 120 45.5T639-560h-81q-7-35-34.5-57.5T460-640q-42 0-71 29t-29 71q0 20 8 39.5t23 34.5l54 54q14 14 22.5 30.5T482-348q5 13 15 20.5t23 7.5q17 0 28.5-11.5T560-360h80q0 50-34.5 85T520-240Zm20-160q-25 0-42.5-17.5T480-460q0-26 17.5-43t42.5-17q26 0 43 17t17 43q0 25-17 42.5T540-400Z"/></svg>',
    mic: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm-40 280v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z"/></svg>',
  };

  /**
   * 语音栏那两个图标本身由 md3-icons 换图形（它管图标），这里只管「底」：
   *   · .ln-bg / .cl-bg —— AI 降噪图标后那条会滚动的彩虹色带
   *   · .mic-icon .gray —— 麦克风电平轨道（88% 白，方块去掉后会露出来）
   */
  function voiceIconCss() {
    // 这两块底都是客户端用「房间主题色」画的，属于换肤后必然要对齐的部分，
    // 所以不再做成开关（曾被误关过一次，导致房间色方块又冒回来）
    return (
      'html body .cpt-voice-panel .ai-icon .ln-bg,' +
      'html body .cpt-voice-panel .ai-icon .cl-bg,' +
      'html body .ln-bg,html body .cl-bg' +
      '{background:none !important;animation:none !important}' +
      // 降噪「关」时客户端用 .cl-bg 代替 .ln-bg，用 :has 区分两种状态
      'html body .cpt-voice-panel .ai-icon:has(.cl-bg)::after' +
      '{background-color:var(--text-3,var(--text-2)) !important}' +
      'html body .cpt-voice-panel .mic-icon .gray{background:transparent !important}' +
      // 电平条原来是在「房间色方块」里长高的；方块去掉后它会变成一整块大色块，
      // 改成贴在图标下缘的一条细线，说话时才轻轻起伏
      'html body .cpt-voice-panel .mic-icon .green{background:var(--md3-primary,var(--brand-text)) !important;' +
      'top:auto !important;left:4px !important;right:4px !important;bottom:-2px !important;' +
      'max-height:3px !important;border-radius:2px !important;opacity:.8 !important}' +
      // .mic-icon 原本 overflow:hidden，会把图标下方的电平条裁掉
      'html body .cpt-voice-panel .mic-icon{overflow:visible !important}'
    );
  }



  /**
   * MD3 表面层级：surface 给窗口/画布，surfaceLow 给导航栏与语音卡，surfaceHigh 给输入框。
   * 客户端这几个容器原本都用 --fill-input 一把梭，层级是平的，这里按角色分开。
   */
  function surfaceProportions() {
    return (
      'html body .voice-panel-container{background-color:var(--md3-surface-low,var(--fill-2)) !important}' +
      'html body .cpt-voice-panel .mask{background:linear-gradient(transparent 0,var(--md3-surface-low,var(--fill-2)) 100%) !important}' +
      'html body .im-rich-text-message-input,html body .im-rich-text-message-input .input-div' +
      '{background-color:' + inputSurface() + ' !important}' +
      'html body .cpt-message-list,html body .scroll-list-content{background-color:transparent !important}'
    );
  }

  // ---------------------------------------------------- 应用与存储
















  // ---------------------------------------------------- 配色冲突与接管

  // 已知会改写同一批配色变量的插件
  var RIVALS = [{ id: 'theme-skin', label: '主题皮肤' }];




  // -------------------------------------------------------------- 面板


  // ================================================== 图标部分（原 md3-icons）

  var ICONS = {
    "settings": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z\"/></svg>"
    },
    "search": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z\"/></svg>"
    },
    "notifications": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160ZM480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Z\"/></svg>"
    },
    "menu": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z\"/></svg>"
    },
    "group": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM360-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm400-160q0 66-47 113t-113 47q-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113ZM120-240h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T440-640q0-33-23.5-56.5T360-720q-33 0-56.5 23.5T280-640q0 33 23.5 56.5T360-560Zm0 320Zm0-400Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM360-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm400-160q0 66-47 113t-113 47q-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113Z\"/></svg>"
    },
    "mail": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280L160-640v400h640v-400L480-440Zm0-80 320-200H160l320 200ZM160-640v-80 480-400Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280 320-200v-80L480-520 160-720v80l320 200Z\"/></svg>"
    },
    "celebration": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m80-80 200-560 360 360L80-80Zm132-132 282-100-182-182-100 282Zm370-246-42-42 224-224q32-32 77-32t77 32l24 24-42 42-24-24q-14-14-35-14t-35 14L582-458ZM422-618l-42-42 24-24q14-14 14-34t-14-34l-26-26 42-42 26 26q32 32 32 76t-32 76l-24 24Zm80 80-42-42 144-144q14-14 14-35t-14-35l-64-64 42-42 64 64q32 32 32 77t-32 77L502-538Zm160 160-42-42 64-64q32-32 77-32t77 32l64 64-42 42-64-64q-14-14-35-14t-35 14l-64 64ZM212-212Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m80-80 200-560 360 360L80-80Zm502-378-42-42 224-224q32-32 77-32t77 32l24 24-42 42-24-24q-14-14-35-14t-35 14L582-458ZM422-618l-42-42 24-24q14-14 14-34t-14-34l-26-26 42-42 26 26q32 32 32 76t-32 76l-24 24Zm80 80-42-42 144-144q14-14 14-35t-14-35l-64-64 42-42 64 64q32 32 32 77t-32 77L502-538Zm160 160-42-42 64-64q32-32 77-32t77 32l64 64-42 42-64-64q-14-14-35-14t-35 14l-64 64Z\"/></svg>"
    },
    "chat_bubble": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Z\"/></svg>"
    },
    "apps": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M240-160q-33 0-56.5-23.5T160-240q0-33 23.5-56.5T240-320q33 0 56.5 23.5T320-240q0 33-23.5 56.5T240-160Zm240 0q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm240 0q-33 0-56.5-23.5T640-240q0-33 23.5-56.5T720-320q33 0 56.5 23.5T800-240q0 33-23.5 56.5T720-160ZM240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400ZM240-640q-33 0-56.5-23.5T160-720q0-33 23.5-56.5T240-800q33 0 56.5 23.5T320-720q0 33-23.5 56.5T240-640Zm240 0q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Zm240 0q-33 0-56.5-23.5T640-720q0-33 23.5-56.5T720-800q33 0 56.5 23.5T800-720q0 33-23.5 56.5T720-640Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M240-160q-33 0-56.5-23.5T160-240q0-33 23.5-56.5T240-320q33 0 56.5 23.5T320-240q0 33-23.5 56.5T240-160Zm240 0q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm240 0q-33 0-56.5-23.5T640-240q0-33 23.5-56.5T720-320q33 0 56.5 23.5T800-240q0 33-23.5 56.5T720-160ZM240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400ZM240-640q-33 0-56.5-23.5T160-720q0-33 23.5-56.5T240-800q33 0 56.5 23.5T320-720q0 33-23.5 56.5T240-640Zm240 0q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Zm240 0q-33 0-56.5-23.5T640-720q0-33 23.5-56.5T720-800q33 0 56.5 23.5T800-720q0 33-23.5 56.5T720-640Z\"/></svg>"
    },
    "notifications_off": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-200v-80h80v-280q0-33 8.5-65t25.5-61l60 60q-7 16-10.5 32.5T320-560v280h248L56-792l56-56 736 736-56 56-146-144H160Zm560-154-80-80v-126q0-66-47-113t-113-47q-26 0-50 8t-44 24l-58-58q20-16 43-28t49-18v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v206Zm-276-50Zm36 324q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm33-481Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-200v-80h80v-280q0-33 8.5-65t25.5-61l126 126H288L56-792l56-56 736 736-56 56-146-144H160Zm560-154L328-746q20-16 43-28t49-18v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v206ZM480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Z\"/></svg>"
    },
    "volume_up": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320Z\"/></svg>"
    },
    "noise_aware": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M440-878q10-1 20-1.5t20-.5q11 0 20.5.5T520-878v80q-10-2-19.5-2h-41q-9.5 0-19.5 2v-80Zm-168 56q17-11 34.5-19t36.5-15l35 72q-20 6-37.5 14.5T306-750l-34-72Zm382 72q-17-11-34.5-19.5T582-784l35-72q19 7 36.5 15t34.5 19l-34 72Zm99 101q-11-17-24-32.5T702-711l63-50q14 14 27 29.5t24 32.5l-63 50Zm-610-48q11-17 23.5-32.5T193-759l63 50q-14 14-26.5 29.5T206-647l-63-50ZM83-532q2-20 7-39.5t11-38.5l79 18q-7 19-11.5 38.5T162-514l-79-18Zm716 21q-2-20-6.5-40T781-590l78-18q6 19 11 38.5t7 39.5l-78 19Zm-18 141q7-19 11-38t6-39l79 18q-2 20-7 39.5T859-351l-78-19Zm-619-76q2 20 6.5 39.5T180-368l-79 18q-6-19-11-38.5T83-428l79-18Zm543 194q14-14 26-29.5t23-32.5l64 50q-11 17-23.5 32.5T768-202l-63-50Zm-511 52q-14-14-26.5-30T144-263l62-50q11 17 23.5 33t26.5 30l-62 50Zm389 23q20-7 37-15t34-19l35 72q-17 11-34.5 19.5T618-104l-35-73Zm-239 74q-19-7-37-15.5T272-138l35-72q17 11 34.5 19.5T379-176l-35 73Zm136 23q-10 0-20-.5T440-82v-80q13 2 40 2h20.5q9.5 0 19.5-2v80q-10 1-19.5 1.5T480-80Zm40-160q-38 0-69.5-23T406-322q-3-9-6.5-17.5T389-355l-55-55q-26-26-40-59.5T280-540q0-75 52.5-127.5T460-720q69 0 120 45.5T639-560h-81q-7-35-34.5-57.5T460-640q-42 0-71 29t-29 71q0 20 8 39.5t23 34.5l54 54q14 14 22.5 30.5T482-348q5 13 15 20.5t23 7.5q17 0 28.5-11.5T560-360h80q0 50-34.5 85T520-240Zm20-160q-25 0-42.5-17.5T480-460q0-26 17.5-43t42.5-17q26 0 43 17t17 43q0 25-17 42.5T540-400Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M440-878q10-1 20-1.5t20-.5q11 0 20.5.5T520-878v80q-10-2-19.5-2h-41q-9.5 0-19.5 2v-80Zm-168 56q17-11 34.5-19t36.5-15l35 72q-20 6-37.5 14.5T306-750l-34-72Zm382 72q-17-11-34.5-19.5T582-784l35-72q19 7 36.5 15t34.5 19l-34 72Zm99 101q-11-17-24-32.5T702-711l63-50q14 14 27 29.5t24 32.5l-63 50Zm-610-48q11-17 23.5-32.5T193-759l63 50q-14 14-26.5 29.5T206-647l-63-50ZM83-532q2-20 7-39.5t11-38.5l79 18q-7 19-11.5 38.5T162-514l-79-18Zm716 21q-2-20-6.5-40T781-590l78-18q6 19 11 38.5t7 39.5l-78 19Zm-18 141q7-19 11-38t6-39l79 18q-2 20-7 39.5T859-351l-78-19Zm-619-76q2 20 6.5 39.5T180-368l-79 18q-6-19-11-38.5T83-428l79-18Zm543 194q14-14 26-29.5t23-32.5l64 50q-11 17-23.5 32.5T768-202l-63-50Zm-511 52q-14-14-26.5-30T144-263l62-50q11 17 23.5 33t26.5 30l-62 50Zm389 23q20-7 37-15t34-19l35 72q-17 11-34.5 19.5T618-104l-35-73Zm-239 74q-19-7-37-15.5T272-138l35-72q17 11 34.5 19.5T379-176l-35 73Zm136 23q-10 0-20-.5T440-82v-80q13 2 40 2h20.5q9.5 0 19.5-2v80q-10 1-19.5 1.5T480-80Zm40-160q-38 0-69.5-23T406-322q-3-9-6.5-17.5T389-355l-55-55q-26-26-40-59.5T280-540q0-75 52.5-127.5T460-720q69 0 120 45.5T639-560h-81q-7-35-34.5-57.5T460-640q-42 0-71 29t-29 71q0 20 8 39.5t23 34.5l54 54q14 14 22.5 30.5T482-348q5 13 15 20.5t23 7.5q17 0 28.5-11.5T560-360h80q0 50-34.5 85T520-240Zm20-160q-25 0-42.5-17.5T480-460q0-26 17.5-43t42.5-17q26 0 43 17t17 43q0 25-17 42.5T540-400Z\"/></svg>"
    },
    "mic": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-360q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm-40 280v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z\"/></svg>"
    },
    "mic_off": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m710-362-58-58q14-23 21-48t7-52h80q0 44-13 83.5T710-362ZM480-594Zm112 112-72-72v-206q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v126l-80-80v-46q0-50 35-85t85-35q50 0 85 35t35 85v240q0 11-2.5 20t-5.5 18ZM440-120v-123q-104-14-172-93t-68-184h80q0 83 57.5 141.5T480-320q34 0 64.5-10.5T600-360l57 57q-29 23-63.5 39T520-243v123h-80Zm352 64L56-792l56-56 736 736-56 56Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"m710-362-58-58q14-23 21-48t7-52h80q0 44-13 83.5T710-362ZM592-482 360-714v-46q0-50 35-85t85-35q50 0 85 35t35 85v240q0 11-2.5 20t-5.5 18ZM440-120v-124q-104-14-172-92.5T200-520h80q0 83 58.5 141.5T480-320q34 0 64.5-10.5T600-360l57 57q-29 23-63.5 38.5T520-244v124h-80Zm352 64L56-792l56-56 736 736-56 56Z\"/></svg>"
    },
    "volume_off": {
      "outlined": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M792-56 671-177q-25 16-53 27.5T560-131v-82q14-5 27.5-10t25.5-12L480-368v208L280-360H120v-240h128L56-792l56-56 736 736-56 56Zm-8-232-58-58q17-31 25.5-65t8.5-70q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 53-14.5 102T784-288ZM650-422l-90-90v-130q47 22 73.5 66t26.5 96q0 15-2.5 29.5T650-422ZM480-592 376-696l104-104v208Zm-80 238v-94l-72-72H200v80h114l86 86Zm-36-130Z\"/></svg>",
      "filled": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M792-56 671-177q-25 16-53 27.5T560-131v-82q14-5 27.5-10t25.5-12L480-368v208L280-360H120v-240h128L56-792l56-56 736 736-56 56Zm-8-232-58-58q17-31 25.5-65t8.5-70q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 53-14.5 102T784-288ZM650-422l-90-90v-130q47 22 73.5 66t26.5 96q0 15-2.5 29.5T650-422ZM480-592 376-696l104-104v208Z\"/></svg>"
    }
  };

  var SLOTS = [
    // 块类：官方工具区图标是 <img class="tool-img">，别的插件用内联 svg，:has 天然排除
    { id: 'railInbox', label: '收件箱', icon: 'mail', kind: 'block', requireImg: true, sel: '.shortcuts .friends-msg-wrapper .tool-shortcuts' },
    { id: 'railTools', label: '工具区图标（仅官方）', icon: 'celebration', kind: 'block', requireImg: true, sel: '.shortcuts .tool-container .tool-shortcuts' },
    // 字体图标（类名来自 1.57.0 的 CSS/JS 实测）；除齿轮外都受「作用范围」控制
    { id: 'gear', label: '设置齿轮', icon: 'settings', kind: 'glyph', sel: 'i.icon-set' },
    { id: 'search', label: '搜索', icon: 'search', kind: 'glyph', scopable: true, sel: 'i.icon-search, i.icon-search-bold' },
    { id: 'notice', label: '通知铃铛', icon: 'notifications', kind: 'glyph', scopable: true, sel: 'i.icon-notice, i.icon-notice-bold' },
    { id: 'noticeOff', label: '通知（关闭态，带斜杠）', icon: 'notifications_off', kind: 'glyph', scopable: true, sel: 'i.icon-notice-off, i.icon-notice-off-bold' },
    { id: 'horn', label: '喇叭/公告', icon: 'celebration', kind: 'glyph', scopable: true, sel: 'i.icon-horn, i.icon-horn-bold' },
    { id: 'more', label: '更多（三条杠）', icon: 'menu', kind: 'glyph', scopable: true, sel: 'i.icon-more, i.icon-more-bold' },
    { id: 'friends', label: '成员/好友按钮', icon: 'group', kind: 'glyph', scopable: true, sel: 'i.icon-friends-new' },
    // 语音栏：降噪与麦克风原来的图标是「方块 + 字形」的复合 SVG 路径，
    // 只能用「藏掉 svg + 自己画」的方式换；扬声器是字体图标，走普通 glyph 槽位
    { id: 'voiceDenoise', label: '语音栏·降噪', icon: 'noise_aware', kind: 'svgchip', boxPx: 18, sel: '.cpt-voice-panel .ai-icon' },
    { id: 'voiceMic', label: '语音栏·麦克风', icon: 'mic', kind: 'svgchip', boxPx: 18, sel: '.cpt-voice-panel .mic-icon' },
    { id: 'voiceSpeaker', label: '语音栏·扬声器', icon: 'volume_up', kind: 'glyph', boxPx: 18, sel: 'i.icon-speak-on' },
    // 静音 / 闭麦 / 无声卡：客户端在这几个状态下换成字体图标
    { id: 'voiceMicOff', label: '语音栏·麦克风已静音', icon: 'mic_off', kind: 'glyph', boxPx: 18, color: 'var(--f-error-text,#f2b8b5)', sel: 'i.icon-mic-off' },
    { id: 'voiceMicLocked', label: '语音栏·麦克风被禁', icon: 'mic_off', kind: 'glyph', boxPx: 18, color: 'var(--f-error-text,#f2b8b5)', sel: 'i.icon-mic-locked' },
    { id: 'voiceSpkOff', label: '语音栏·扬声器已关', icon: 'volume_off', kind: 'glyph', boxPx: 18, color: 'var(--f-error-text,#f2b8b5)', sel: 'i.icon-speak-off, i.icon-speak-off-color' },
    // 静音态：客户端会亮出 200×200 的红色斜杠 SVG（.mute-svg），
    // 这里在它可见时整块接管，改用 MD3 的 mic_off / volume_off
    {
      id: 'voiceMicMute2',
      label: '语音栏·麦克风静音态',
      icon: 'mic_off',
      kind: 'svgchip',
      boxPx: 18,
      color: 'var(--f-error-text,#f2b8b5)',
      hideInside: 'svg.mute-svg',
      // 画在 .icon（26×26，始终有尺寸）上；画在 .icon-container 上会因内容塌陷而互相重叠
      sel: '.cpt-voice-panel .icon',
      when: ':has(.mic-icon):has(svg.mute-svg:not([style*="display: none"]))',
    },
    {
      id: 'voiceSpkMute2',
      label: '语音栏·扬声器静音态',
      icon: 'volume_off',
      kind: 'svgchip',
      boxPx: 18,
      color: 'var(--f-error-text,#f2b8b5)',
      hideInside: 'svg.mute-svg',
      sel: '.cpt-voice-panel .icon',
      when: ':has(i.icon-speak-on):has(svg.mute-svg:not([style*="display: none"]))',
    },
  ];


  function dataUrl(svg) {
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
  }

  /** 只给形状，尺寸交给外层盒子（100%），这样永远不会因为盒子尺寸未知而偏移 */
  function maskShape(svg) {
    var u = dataUrl(svg);
    return '-webkit-mask-image:' + u + ';mask-image:' + u +
      ';-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat' +
      ';-webkit-mask-position:center;mask-position:center' +
      ';-webkit-mask-size:100% 100%;mask-size:100% 100%';
  }

  /**
   * 图标颜色。优先用 MD3 自己导出的 --md3-primary：
   * 单纯用 --brand-text 的话，主题皮肤之类改写同一变量的插件会把它抢走
   * （实测过：房间已经是紫色，图标还是绿的）。
   */
  /** 按当前风格取图标：filled（实心，跟客户端原图标更接近）/ outlined（线框） */
  function svgOf(icon) {
    var pair = ICONS[icon];
    if (!pair) return '';
    var style = settings.style === 'outlined' ? 'outlined' : 'filled';
    return pair[style] || pair.outlined || pair.filled || '';
  }

  function iconColor(slot) {
    if (slot && slot.color) return slot.color;
    return iconColorBase();
  }

  function iconColorBase() {
    if (settings.colorMode === 'text') return 'var(--text-2,#d2d3d7)';
    if (settings.colorMode === 'custom' && /^#[0-9a-f]{6}$/i.test(settings.customColor)) return settings.customColor;
    return 'var(--md3-primary,var(--brand-text,#7dd95e))';
  }

  /** 字体图标的作用范围：button=限定在 .icon-btn 里，all=全站 */
  function finalSel(slot) {
    var base = slot.sel;
    if (slot.when) base = base + slot.when;
    if (slot.kind === 'svgchip') return base;
    if (slot.kind !== 'glyph' || !slot.scopable) return base;
    if (settings.scope === 'all') return base.replace(/\.icon-btn /g, '');
    return base
      .split(',')
      .map(function (one) {
        one = one.trim();
        return one.indexOf('.icon-btn ') === 0 ? one : '.icon-btn ' + one;
      })
      .join(',');
  }

  /**
   * 所有槽位统一用「居中伪元素」画图标。
   * 注意：选择器可能是逗号分隔的多支（一个槽位匹配 base / bold 两个类名），
   * 必须逐支展开 —— 写成 `A,B::after{}` 时伪元素只挂在最后一支 B 上，A 不会显示。
   */
  function eachSel(sel, fn) {
    String(sel || '')
      .split(',')
      .map(function (one) {
        return one.trim();
      })
      .filter(Boolean)
      .forEach(function (one) {
        fn(one.indexOf('html body ') === 0 ? one : 'html body ' + one);
      });
  }

  function iconRule(sel, svg, boxW, boxH, slot) {
    var out = [];
    eachSel(sel, function (one) {
      out.push(one + '{position:relative}');
      out.push(
        one + '::after{content:"";position:absolute;left:50%;top:50%;' +
          'transform:translate(-50%,-50%);width:' + boxW + ';height:' + boxH + ';' +
          'background-color:' + iconColor(slot) + ';pointer-events:none;' + maskShape(svg) + '}',
      );
    });
    return out.join('');
  }

  function cssFor(slot) {
    var svg = svgOf(slot.icon);
    if (!svg) return '';
    var sel = slot.requireImg ? slot.sel + ':has(img.tool-img)' : finalSel(slot);
    var pct = Math.max(30, Math.min(100, Math.round(settings.blockSize)));
    var box = slot.boxPx || Math.max(12, Math.min(32, Math.round(settings.glyphPx)));
    var px = box + 'px';
    var out = [iconRule(sel, svg, slot.kind === 'block' ? pct + '%' : px, slot.kind === 'block' ? pct + '%' : px, slot)];
    eachSel(sel, function (one) {
      if (slot.kind === 'svgchip') {
        // 原图标是内联 fill 的复合路径，CSS 背景类手段无效，只能整块藏掉
        if (slot.hideInside) out.push(one + ' ' + slot.hideInside + '{display:none!important}');
        else out.push(one + ' > svg{display:none!important}');
      } else if (slot.kind === 'block') {
        out.push(one + ' > *{opacity:0!important}');
        out.push(one + '{background-image:none!important}');
      } else {
        out.push(one + '{color:transparent!important}');
        out.push(one + '::before{color:transparent!important}');
      }
    });
    return out.join('');
  }

  /** 语音栏三个图标槽位：容器尺寸兜底（状态切换时内容会塌，导致伪元素互相重叠） */
  function voiceBoxCss() {
    var any = false;
    for (var i = 0; i < SLOTS.length; i++) {
      if (/^voice/.test(SLOTS[i].id) && settings.slots[SLOTS[i].id] !== false) any = true;
    }
    if (!any) return '';
    return (
      'html body .cpt-voice-panel .track-wrapper .icon-container{min-width:26px}' +
      'html body .cpt-voice-panel .track-wrapper .icon-container > .icon{min-width:26px;min-height:26px}' +
      // 只用 min-* 兜底，不写死尺寸（写死等于改了官方元素度量）
      'html body .cpt-voice-panel .track-wrapper .icon-container i.iconfont,' +
      'html body .cpt-voice-panel .track-wrapper .icon-container .mic-icon,' +
      'html body .cpt-voice-panel .track-wrapper .icon-container .ai-icon' +
      '{min-width:18px;min-height:18px}'
    );
  }

  function activeSlots() {
    return SLOTS.filter(function (s) {
      return settings.slots[s.id] !== false;
    });
  }

  // ================================================== 壁纸取色

  // 画质档位：长边 / WebP 质量 / 体积上限
  var QUALITY = {
    standard: { side: 1600, q: 0.82, cap: 1400000 },
    high: { side: 2400, q: 0.85, cap: 3000000 },
    original: { side: 3840, q: 0.9, cap: 4500000 },
  };
  var SAMPLE_SIDE = 32; // 取色采样边长

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined') {
        reject(new Error('当前环境不支持读取图片'));
        return;
      }
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('图片读取失败'));
      };
      img.src = src;
    });
  }

  function drawToCanvas(img, side) {
    var canvas = document.createElement('canvas');
    var w = img.width || side;
    var h = img.height || side;
    var scale = Math.min(1, side / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** 生成缩略图（长边 128px，约 3–8KB），存进元信息，面板不用异步读大图 */
  function makeThumb(dataUrl) {
    return loadImage(dataUrl).then(function (img) {
      return drawToCanvas(img, 128).toDataURL('image/webp', 0.55);
    }).catch(function () {
      return '';
    });
  }

  /**
   * 压图再存：长边 1600、WebP 0.82（尽量保留清晰度）；
   * 若仍超过体积上限，再降到 0.6 压一次，避免把配置撑爆。
   */
  function compressWallpaper(src, presetId) {
    var preset = QUALITY[presetId] || QUALITY.standard;
    return loadImage(src).then(function (img) {
      var side = preset.side;
      // 「原图」档：小图不放大
      if (presetId === 'original') side = Math.min(preset.side, Math.max(img.width || 0, img.height || 0) || preset.side);
      var canvas = drawToCanvas(img, side);
      var out = canvas.toDataURL('image/webp', preset.q);
      if (out.length > preset.cap) {
        canvas = drawToCanvas(img, Math.round(side * 0.75));
        out = canvas.toDataURL('image/webp', Math.max(0.55, preset.q - 0.2));
      }
      return out;
    });
  }

  /**
   * 从图里取主色：缩到 32×32 采样，跳过过暗/过亮/发灰的像素，
   * 按「出现频次 × 彩度」加权挑一格，再取该格平均色。
   */
  function extractSeedFromImage(src) {
    return loadImage(src).then(function (img) {
      var canvas = drawToCanvas(img, SAMPLE_SIDE);
      var data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      var buckets = {};
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        var hex = '#' + [data[i], data[i + 1], data[i + 2]].map(function (v) {
          return ('0' + v.toString(16)).slice(-2);
        }).join('');
        var lchv = labToLch(rgbToLab(parseHex(hex)));
        if (lchv.L < 14 || lchv.L > 92 || lchv.C < 6) continue;
        var key = Math.round(lchv.h / 10) * 10 + '|' + Math.round(lchv.L / 12);
        if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0, C: 0 };
        var b = buckets[key];
        b.n++;
        b.r += data[i];
        b.g += data[i + 1];
        b.b += data[i + 2];
        b.C += lchv.C;
      }
      var best = null;
      var bestScore = -1;
      Object.keys(buckets).forEach(function (k) {
        var b = buckets[k];
        var score = Math.pow(b.n, 0.9) * (0.5 + b.C / b.n / 40);
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      });
      if (!best) return null;
      return '#' + [best.r / best.n, best.g / best.n, best.b / best.n]
        .map(function (v) {
          return ('0' + Math.round(v).toString(16)).slice(-2);
        })
        .join('');
    });
  }

  /**
   * 房间卡片：极简模式只留头像 + 名字。
   * 横幅是绝对定位的 .channel-top-img-wrapper，列表里还有一块等高的 120px 占位，
   * 两者要一起收掉，否则会留一片空白。
   */
  function roomCardCss() {
    if (settings.roomCard !== 'compact') return '';
    var scope = 'html body .cpt-channel-sidebar ';
    return (
      scope + '.channel-top-img-wrapper{display:none !important}' +
      scope + '.cpt-channel-scroller > div.h-\\[120px\\]{display:none !important}' +
      scope + '.cpt-channel-tool-bar{display:none !important}' +
      scope + '.channel-base .subtitle-row{display:none !important}' +
      // 卡片本来靠 -42px 上边距压在横幅上，横幅没了就会跑到视口外
      scope + '.channel-base{margin-top:0 !important;min-height:58px !important;align-items:center !important}' +
      // 顶栏和卡片重复（都显示房间名），极简模式下一起收掉
      scope + '.inner-relative{display:none !important}' +
      scope + '.channel-name{font-size:15px !important;font-weight:600 !important}' +
      scope + '.channel-base .cpt-chat-room-avatar{width:40px !important;height:40px !important}'
    );
  }

  /**
   * 面板毛玻璃：把 backdrop-filter 加在面板本身。
   * 壁纸保持清晰，只有「面板背后那一块」被虚化，视觉上像磨砂玻璃。
   */
  function panelBlurCss() {
    var b = clamp(Math.round(settings.panelBlur), 0, 30);
    if (b <= 0) return '';
    var px = 'blur(' + b + 'px) !important;-webkit-backdrop-filter:blur(' + b + 'px) !important}';
    return (
      'html body .cpt-channel-sidebar,html body .friends-sidebar,html body .sidebar,' +
      'html body .voice-panel-container,html body .left-sidebar-layout,' +
      'html body .im-rich-text-message-input,html body .cpt-electron-title-bar' +
      '{backdrop-filter:' + px +
      'html body .top-bar{backdrop-filter:' + px
    );
  }

  /**
   * 壁纸铺底（作背景模式）：图 + 一层主题表面色遮罩，保证文字可读。
   * 图放在 body::before 上，这样能加 filter（亮度）；正文容器抬到 z-index 1。
   */
  function wallpaperCss() {
    if (!settings.wallpaper || settings.wallpaperMode !== 'cover' || !current.roles) return '';
    var light = settings.themeLock === 'light';
    var r = light ? current.roles.light : current.roles.dark;
    var veil = withAlpha(r.surface, clamp(settings.wallpaperOpacity, 0, 1));
    var panelA = clamp(settings.panelOpacity, 0, 100) / 100;
    var panel = withAlpha(r.surfaceContainerLow, panelA);
    var blur = clamp(Math.round(settings.wallpaperBlur), 0, 40);
    // 模糊会采样到元素边界外，边缘会发虚透明 —— 外扩一圈把边界推出去
    var inset = blur > 0 ? -(blur * 2 + 8) : 0;
    return (
      'html,body{background-color:' + r.surface + ' !important;background-image:none !important}' +
      'html body::before{content:"";position:fixed;inset:' + inset + 'px;pointer-events:none;z-index:0;' +
      'background-image:linear-gradient(' + veil + ',' + veil + '),url("' + settings.wallpaper + '") !important;' +
      'background-size:cover,cover !important;background-position:center,center !important;' +
      'background-repeat:no-repeat,no-repeat !important;' +
      (blur > 0 ? 'filter:blur(' + blur + 'px) !important;' : '') + '}' +
      // #app / .desktop 自带 top:30px，但因为 position 是 static 没生效；
      // 一旦改成 relative 就会被推下 30px（底部整块被裁），所以要把 top 钉回 auto
      'html body > #app,html body > .desktop{position:relative;z-index:1;top:auto !important}' +
      'html body .cpt-channel-sidebar,html body .friends-sidebar,html body .sidebar,' +
      'html body .voice-panel-container,html body .left-sidebar-layout' +
      '{background-color:' + panel + ' !important}' +
      // 屏幕共享外框透明；底板与顶栏的透明度在 panelCss 里按滑条控制
      'html body .cpt-screen-share-wrapper,html body .cpt-screen-share-wrapper .Byte-video' +
      '{background-color:transparent !important;background-image:none !important}' +
      // 「+」块与工具区底色也一起透出来。
      // 注意选择器要和 canvasCss 里那条完全一致，否则它特异性更高、会把透明度盖掉
      'html body .guide-wrapper,html body .add-room-wrapper,' +
      'html body .cpt-shortcut-block-wrapper.guide-wrapper' +
      '{background:' + withAlpha(r.surfaceContainerHigh, panelA) + ' !important;background-image:none !important}' +
      'html body .cpt-electron-title-bar{background-color:' + withAlpha(r.surface, Math.min(1, panelA + 0.1)) + ' !important}' +
      'html body .im-rich-text-message-input,html body .im-rich-text-message-input .input-div' +
      '{background-color:' + withAlpha(r.surfaceContainerHighest, panelA) + ' !important}'
    );
  }

  // ================================================== 壁纸库

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function newWallId() {
    return 'w' + Date.now().toString(36).slice(-8);
  }

  function wallMeta(id) {
    return (settings.wallpapers || []).filter(function (w) {
      return w.id === id;
    })[0] || null;
  }

  /** 读出某张壁纸的图数据（存 wall_<id> 键） */
  function readWallData(id) {
    var store = getKv();
    if (!store || !id) return Promise.resolve('');
    return store
      .get('wall_' + id)
      .then(function (v) {
        return typeof v === 'string' ? v : v && v.data ? v.data : '';
      })
      .catch(function () {
        return '';
      });
  }

  /**
   * 存图数据。
   * 注意：客户端这套存储只吃对象 —— 直接传字符串会被主进程的 JSON.parse 吃掉、静默丢弃
   * （实测 set('k','plain') 读回 null，set('k',{data:'…'}) 正常），所以统一包成 { data }。
   */
  function writeWallData(id, data) {
    var store = getKv();
    if (!store) return Promise.resolve();
    return store.set('wall_' + id, { data: data }).catch(function () {});
  }

  function dropWallData(id) {
    var store = getKv();
    if (!store || !store.del) return Promise.resolve();
    return store.del('wall_' + id).catch(function () {});
  }

  /** 选中某张壁纸：设成当前生效 + 用它取到的种子色 */
  function activateWallpaper(id) {
    if (!id) {
      settings.activeWallId = '';
      settings.wallpaper = '';
      return Promise.resolve(false);
    }
    return readWallData(id).then(function (data) {
      if (!data) return false;
      settings.activeWallId = id;
      settings.wallpaper = data;
      var meta = wallMeta(id);
      if (meta && meta.seed) setSeed(meta.seed, '壁纸取色');
      apply();
      return true;
    });
  }

  /** 新图入库（data 已压缩），并立即启用 */
  function addWallpaper(data, seed) {
    var id = newWallId();
    return makeThumb(data).then(function (thumb) {
      var meta = {
        id: id,
        name: '壁纸 ' + ((settings.wallpapers || []).length + 1),
        seed: seed || '',
        size: data.length,
        at: Date.now(),
        thumb: thumb || '',
      };
      settings.wallpapers = (settings.wallpapers || []).concat([meta]);
      return writeWallData(id, data);
    }).then(function () {
      return persist();
    }).then(function () {
      return activateWallpaper(id);
    });
  }

  /** 老库没有缩略图的，补一次（只做一遍，结果写回元信息） */
  function backfillThumbs() {
    var list = settings.wallpapers || [];
    var todo = list.filter(function (w) {
      return !w.thumb;
    });
    if (!todo.length) return Promise.resolve(false);
    var changed = false;
    return todo.reduce(function (chain, w) {
      return chain.then(function () {
        return readWallData(w.id).then(function (data) {
          if (!data) return;
          return makeThumb(data).then(function (thumb) {
            if (!thumb) return;
            w.thumb = thumb;
            changed = true;
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return changed ? persist() : false;
    });
  }

  function removeWallpaper(id) {
    settings.wallpapers = (settings.wallpapers || []).filter(function (w) {
      return w.id !== id;
    });
    if (settings.activeWallId === id) {
      var next = settings.wallpapers[0];
      settings.activeWallId = '';
      settings.wallpaper = '';
      if (next) activateWallpaper(next.id);
      else apply();
    }
    return dropWallData(id).then(function () {
      return persist();
    });
  }

  /** 轮换一到下一张：顺序按游标，随机避开当前 */
  function rotateWallpaper() {
    var list = settings.wallpapers || [];
    if (list.length < 2) return Promise.resolve(false);
    var cur = settings.activeWallId;
    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === cur) {
        idx = i;
        break;
      }
    }
    var nextIdx;
    if (settings.rotateOrder === 'sequence') {
      nextIdx = (idx + 1) % list.length;
    } else {
      nextIdx = idx;
      var guard = 0;
      while (nextIdx === idx && guard++ < 20) nextIdx = Math.floor(Math.random() * list.length);
    }
    settings.rotateIndex = nextIdx;
    settings.rotateAt = todayStr();
    return activateWallpaper(list[nextIdx].id).then(function () {
      return persist();
    });
  }

  /** 启动 / 跨天时判断要不要换 */
  function maybeRotate(force) {
    if (settings.wallMode !== 'rotate') return Promise.resolve(false);
    var list = settings.wallpapers || [];
    if (list.length < 2) {
      if (list.length === 1 && !settings.activeWallId) return activateWallpaper(list[0].id);
      return Promise.resolve(false);
    }
    var need = false;
    if (force) need = true;
    else if (!settings.activeWallId) need = true;
    else if (settings.rotateWhen === 'launch') need = true;
    else if (settings.rotateWhen === 'daily' && settings.rotateAt !== todayStr()) need = true;
    if (!need) return Promise.resolve(false);
    return rotateWallpaper();
  }

  // ================================================== 存储

  function normConf(src) {
    var out = cloneDefaults();
    if (!src || typeof src !== 'object') return out;

    ['enabled', 'canvas', 'ripple', 'shellTop', 'shellRail', 'killSidebarDecor', 'killIconBox'].forEach(function (k) {
      if (typeof src[k] === 'boolean') out[k] = src[k];
    });
    if (parseHex(src.seed)) out.seed = String(src.seed).toLowerCase();
    if (VARIANTS[src.variant]) out.variant = src.variant;
    if (src.look === 'md3' || src.look === 'telegram') out.look = src.look;
    if (['ring', 'square', 'tint'].indexOf(src.railSelect) >= 0) out.railSelect = src.railSelect;
    if (['off', 'dark', 'light'].indexOf(src.themeLock) >= 0) out.themeLock = src.themeLock;
    if (typeof src.iconReplace === 'boolean') out.iconReplace = src.iconReplace;
    if (src.style === 'filled' || src.style === 'outlined') out.style = src.style;
    if (src.scope === 'button' || src.scope === 'all') out.scope = src.scope;
    if (['brand', 'text', 'custom'].indexOf(src.colorMode) >= 0) out.colorMode = src.colorMode;
    if (parseHex(src.customColor)) out.customColor = String(src.customColor).toLowerCase();
    if (typeof src.wallpaper === 'string' && /^data:image\//.test(src.wallpaper)) out.wallpaper = src.wallpaper;
    if (['off', 'color', 'cover'].indexOf(src.wallpaperMode) >= 0) out.wallpaperMode = src.wallpaperMode;
    // 壁纸库：只保留元信息，图数据在 wall_<id> 键
    if (Array.isArray(src.wallpapers)) {
      out.wallpapers = src.wallpapers
        .filter(function (w) {
          return w && typeof w.id === 'string' && /^[a-z0-9]{1,16}$/.test(w.id);
        })
        .slice(0, 12)
        .map(function (w) {
          return {
            id: w.id,
            name: String(w.name || '壁纸').slice(0, 40),
            seed: parseHex(w.seed) ? String(w.seed).toLowerCase() : '',
            size: Math.max(0, Math.round(Number(w.size) || 0)),
            at: Number(w.at) || 0,
            thumb: typeof w.thumb === 'string' && /^data:image\//.test(w.thumb) && w.thumb.length < 40000 ? w.thumb : '',
          };
        });
    }
    if (typeof src.activeWallId === 'string') out.activeWallId = src.activeWallId;
    if (src.wallMode === 'fixed' || src.wallMode === 'rotate') out.wallMode = src.wallMode;
    if (src.rotateOrder === 'random' || src.rotateOrder === 'sequence') out.rotateOrder = src.rotateOrder;
    if (src.rotateWhen === 'launch' || src.rotateWhen === 'daily') out.rotateWhen = src.rotateWhen;
    if (typeof src.rotateIndex === 'number') out.rotateIndex = Math.max(0, Math.round(src.rotateIndex));
    if (typeof src.rotateAt === 'string') out.rotateAt = src.rotateAt.slice(0, 10);
    ['wallpaperOpacity', 'accentBoost', 'bgChroma', 'bgBright'].forEach(function (k) {
      if (typeof src[k] === 'number' && isFinite(src[k])) out[k] = src[k];
    });
    // 注意：这里不能按「等于上限」来纠正旧数据 —— 用户正常拉到上限也会被误判
    out.wallpaperOpacity = clamp(out.wallpaperOpacity, 0, 1);
    if (typeof src.wallpaperBlur === 'number' && isFinite(src.wallpaperBlur)) out.wallpaperBlur = src.wallpaperBlur;
    out.wallpaperBlur = clamp(Math.round(out.wallpaperBlur), 0, 40);
    if (typeof src.panelBlur === 'number' && isFinite(src.panelBlur)) out.panelBlur = src.panelBlur;
    out.panelBlur = clamp(Math.round(out.panelBlur), 0, 30);
    out.accentBoost = clamp(out.accentBoost, 0.5, 2);
    out.bgChroma = clamp(out.bgChroma, 0, 2);
    out.bgBright = clamp(out.bgBright, 0.7, 1.3);
    if (typeof src.panelOpacity === 'number' && isFinite(src.panelOpacity)) out.panelOpacity = src.panelOpacity;
    out.panelOpacity = clamp(Math.round(out.panelOpacity), 0, 100);
    if (src.roomCard === 'full' || src.roomCard === 'compact') out.roomCard = src.roomCard;
    if (QUALITY[src.wallpaperQuality]) out.wallpaperQuality = src.wallpaperQuality;
    ['headerOpacity', 'shareOpacity'].forEach(function (k) {
      if (typeof src[k] === 'number' && isFinite(src[k])) out[k] = clamp(Math.round(src[k]), 0, 100);
    });
    out.accentBoost = clamp(out.accentBoost, 0.5, 2);
    out.bgChroma = clamp(out.bgChroma, 0, 2);
    out.bgBright = clamp(out.bgBright, 0.7, 1.3);
    if (typeof src.blockSize === 'number') out.blockSize = clamp(Math.round(src.blockSize), 30, 100);
    if (typeof src.glyphPx === 'number') out.glyphPx = clamp(Math.round(src.glyphPx), 12, 32);

    if (src.comp && typeof src.comp === 'object') {
      Object.keys(out.comp).forEach(function (k) {
        if (typeof src.comp[k] === 'boolean') out.comp[k] = src.comp[k];
      });
    }
    if (src.slots && typeof src.slots === 'object') {
      SLOTS.forEach(function (slot) {
        if (typeof src.slots[slot.id] === 'boolean') out.slots[slot.id] = src.slots[slot.id];
      });
    }
    return out;
  }

  function getKv() {
    if (kv) return kv;
    if (!window.BHChat || !window.BHChat.storage || !window.BHChat.storage.ns) return null;
    kv = window.BHChat.storage.ns(PLUGIN_ID);
    return kv;
  }

  function loadConf() {
    var store = getKv();
    if (!store) return Promise.resolve(settings);
    return store
      .get(CONF_KEY)
      .then(function (saved) {
        var raw = saved && typeof saved === 'object' ? saved : {};
        settings = normConf(raw);
        // 旧版只有一张图：搬进壁纸库
        var legacy = raw.wallpaper;
        if (typeof legacy === 'string' && /^data:image\//.test(legacy) && !(settings.wallpapers || []).length) {
          var id = newWallId();
          settings.wallpapers = [{ id: id, name: '壁纸 1', seed: settings.seed, size: legacy.length, at: Date.now() }];
          settings.activeWallId = id;
          settings.wallpaper = legacy;
          return writeWallData(id, legacy).then(function () {
            return persist();
          }).then(function () {
            return settings;
          });
        }
        // 有库但还没决定用哪张：按轮换规则挑一张
        return maybeRotate(false).then(function () {
          return settings;
        });
      })
      .catch(function () {
        return settings;
      });
  }

  function persist() {
    var store = getKv();
    if (!store) return Promise.resolve();
    // 图数据单独存 wall_<id>，配置里只放元信息，避免每次写配置都拖着几 MB
    var slim = {};
    Object.keys(settings).forEach(function (k) {
      if (k !== 'wallpaper') slim[k] = settings[k];
    });
    return store.set(CONF_KEY, slim).catch(function () {});
  }

  // ================================================== 应用

  function ensureStyleEl() {
    if (styleEl && styleEl.parentNode) return styleEl;
    var existing = null;
    try {
      existing = document.getElementById(STYLE_ID);
    } catch (err) {
      existing = null;
    }
    if (existing) {
      styleEl = existing;
      return styleEl;
    }
    if (window.BHChat && typeof window.BHChat.injectCSS === 'function') styleEl = window.BHChat.injectCSS('');
    if (!styleEl) {
      styleEl = document.createElement('style');
      document.head.appendChild(styleEl);
    }
    styleEl.id = STYLE_ID;
    return styleEl;
  }

  /** 图标部分：把启用的槽位拼成 CSS */
  function iconCss() {
    if (!settings.enabled || !settings.iconReplace) return '';
    return voiceBoxCss() + activeSlots().map(cssFor).join('');
  }

  function paletteCss() {
    if (!current.roles) return '';
    var t = tokensFromRoles(current.roles);
    var ALL_SEL =
      'html,html body,html body[theme=light],' +
      'html body .theme-reset,html body .theme-reset[theme=dark],' +
      'html body .theme-reset[theme=light]';
    var darkSel, lightSel;
    if (settings.themeLock === 'dark') {
      darkSel = ALL_SEL;
      lightSel = '';
    } else if (settings.themeLock === 'light') {
      darkSel = ALL_SEL;
      lightSel = '';
      t = { dark: t.light, light: t.light };
    } else {
      darkSel = 'html,html body,html body .theme-reset,html body .theme-reset[theme=dark]';
      lightSel = 'html body[theme=light],html body .theme-reset[theme=light]';
    }
    return (
      darkSel + '{' + decls(t.dark, true) + '}' +
      (lightSel ? lightSel + '{' + decls(t.light, true) + '}' : '')
    );
  }

  function buildCSS() {
    if (!settings.enabled) return '';
    return (
      paletteCss() +
      'html body .cpt-msg-text-wrapper{background-color:var(--fill-chat-bubble)}' +
      'html body .layout-bg-wrapper{transition:background-color .5s ease}' +
      'html body #app{transition:color .5s ease}' +
      canvasCss() +
      voiceIconCss() +
      panelCss() +
      contentCss() +
      surfaceProportions() +
      lookCss() +
      railSelectCss() +
      roomCardCss() +
      componentCss(settings.comp || {}) +
      shellCss() +
      rippleCss() +
      iconCss() +
      // 壁纸必须最后输出：panelCss 会给侧栏铺不透明表面色，晚于它才能透出壁纸
      wallpaperCss() +
      panelBlurCss()
    );
  }

  function apply() {
    try {
      ensureStyleEl().textContent = buildCSS();
      if (settings.enabled && settings.ripple) attachRipple();
      else detachRipple();
    } catch (err) {
      console.warn('[BetterHeyboxChat] md3-skin 应用失败:', err);
    }
    if (panelRefresh) panelRefresh();
    return Promise.resolve(settings);
  }

  function setSeed(seedHex, source) {
    var roles = buildRoles(seedHex, settings.variant, {
      accentBoost: settings.accentBoost,
      bgChroma: settings.bgChroma,
      bgBright: settings.bgBright,
    });
    if (!roles) return false;
    current = { seed: roles.meta.seed, source: source || '手动主题色', roles: roles };
    apply();
    return true;
  }

  function refresh() {
    if (!settings.enabled) {
      apply();
      return Promise.resolve(current);
    }
    return resolveSeed().then(function (res) {
      setSeed(res.seed, res.source);
      return current;
    });
  }

  function saveConf(patch) {
    if (patch) {
      var merged = {};
      Object.keys(settings).forEach(function (k) {
        merged[k] = settings[k];
      });
      merged.comp = Object.assign({}, settings.comp);
      merged.slots = Object.assign({}, settings.slots);
      Object.keys(patch).forEach(function (k) {
        if (k === 'comp') merged.comp = Object.assign({}, settings.comp, patch.comp);
        else if (k === 'slots') merged.slots = Object.assign({}, settings.slots, patch.slots);
        else merged[k] = patch[k];
      });
      settings = normConf(merged);
    }
    persist();
    return refresh();
  }

  /** 定色来源：只用手动主题色（不再跟随房间） */
  function resolveSeed() {
    diag = [{ label: '手动主题色', ok: true, detail: settings.seed }];
    return Promise.resolve({ seed: settings.seed, source: '手动主题色' });
  }

  // ================================================== 面板

  function buildPanel() {
    return {
      name: 'BhchatMd3SkinPanel',
      data: function () {
        return {
          page: 'root', // root | color | wall | look | icon | widget
          enabled: settings.enabled,
          seed: settings.seed,
          variant: settings.variant,
          themeLock: settings.themeLock,
          canvas: settings.canvas,
          look: settings.look,
          railSelect: settings.railSelect,
          style: settings.style,
          colorMode: settings.colorMode,
          customColor: settings.customColor,
          blockSize: settings.blockSize,
          glyphPx: settings.glyphPx,
          comp: Object.assign({}, settings.comp),
          slots: Object.assign({}, settings.slots),
          ripple: settings.ripple,
          wallpaper: settings.wallpaper,
          wallpapers: (settings.wallpapers || []).slice(),
          thumbs: {},
          broken: {},
          activeWallId: settings.activeWallId,
          wallMode: settings.wallMode,
          rotateOrder: settings.rotateOrder,
          rotateWhen: settings.rotateWhen,
          wallpaperMode: settings.wallpaperMode,
          wallpaperOpacity: settings.wallpaperOpacity,
          panelOpacity: settings.panelOpacity,
          wallpaperQuality: settings.wallpaperQuality,
          roomCard: settings.roomCard,
          wallpaperBlur: settings.wallpaperBlur,
          panelBlur: settings.panelBlur,
          iconReplace: settings.iconReplace,
          headerOpacity: settings.headerOpacity,
          shareOpacity: settings.shareOpacity,
          panelOpacity: settings.panelOpacity,
          wallpaperQuality: settings.wallpaperQuality,
          accentBoost: settings.accentBoost,
          bgChroma: settings.bgChroma,
          bgBright: settings.bgBright,
          presets: PRESETS,
          variants: Object.keys(VARIANTS).map(function (k) {
            return { id: k, name: VARIANTS[k].name, chroma: VARIANTS[k].chroma };
          }),
          slotList: SLOTS.map(function (s) {
            return { id: s.id, label: s.label, kind: s.kind };
          }),
          status: '',
        };
      },
      mounted: function () {
        var self = this;
        panelRefresh = function () {
          self.sync();
        };
        this.sync();
        self.checkWallData();
        backfillThumbs().then(function () {
          if (self.sync) self.sync();
        });
      },
      beforeDestroy: function () {
        panelRefresh = null;
      },
      methods: {
        sync: function () {
          this.enabled = settings.enabled;
          this.seed = settings.seed;
          this.variant = settings.variant;
          this.themeLock = settings.themeLock;
          this.canvas = settings.canvas;
          this.look = settings.look;
          this.railSelect = settings.railSelect;
          this.style = settings.style;
          this.colorMode = settings.colorMode;
          this.customColor = settings.customColor;
          this.blockSize = settings.blockSize;
          this.glyphPx = settings.glyphPx;
          this.comp = Object.assign({}, settings.comp);
          this.slots = Object.assign({}, settings.slots);
          this.ripple = settings.ripple;
          this.wallpaper = settings.wallpaper;
          this.wallpapers = (settings.wallpapers || []).slice();
          this.activeWallId = settings.activeWallId;
          this.wallMode = settings.wallMode;
          this.rotateOrder = settings.rotateOrder;
          this.rotateWhen = settings.rotateWhen;
          this.wallpaperMode = settings.wallpaperMode;
          this.wallpaperOpacity = settings.wallpaperOpacity;
          this.panelOpacity = settings.panelOpacity;
          this.wallpaperQuality = settings.wallpaperQuality;
          this.roomCard = settings.roomCard;
          this.wallpaperBlur = settings.wallpaperBlur;
          this.panelBlur = settings.panelBlur;
          this.iconReplace = settings.iconReplace;
          this.headerOpacity = settings.headerOpacity;
          this.shareOpacity = settings.shareOpacity;
          this.accentBoost = settings.accentBoost;
          this.bgChroma = settings.bgChroma;
          this.bgBright = settings.bgBright;
        },
        go: function (p) {
          this.page = p;
        },
        back: function () {
          this.page = 'root';
          this.sync();
        },
        presetName: function () {
          var hit = PRESETS.filter(function (p) {
            return p.seed.toLowerCase() === String(settings.seed).toLowerCase();
          })[0];
          return hit ? hit.name : settings.seed;
        },
        variantName: function () {
          return VARIANTS[settings.variant] ? VARIANTS[settings.variant].name : settings.variant;
        },
        wallSummary: function () {
          var n = (settings.wallpapers || []).length;
          if (!n) return '壁纸库为空';
          if (settings.wallMode === 'rotate') {
            var when = settings.rotateWhen === 'daily' ? '每日' : '每次打开';
            var order = settings.rotateOrder === 'random' ? '随机' : '顺序';
            return n + ' 张 · ' + order + '轮换 · ' + when;
          }
          var mode = { cover: '作背景', color: '仅取色', off: '不使用' }[settings.wallpaperMode] || '';
          return n + ' 张 · 固定 · ' + mode;
        },
        lookSummary: function () {
          var card = settings.roomCard === 'compact' ? '极简卡片' : '完整卡片';
          var look = settings.look === 'telegram' ? '中性紧凑' : 'MD3 标准';
          var rail = { ring: '圆环', square: '方形环', tint: '仅底色' }[settings.railSelect] || '';
          return card + ' · ' + look + ' · ' + rail;
        },
        iconSummary: function () {
          if (!settings.iconReplace) return '已关闭';
          return (settings.style === 'filled' ? '实心' : '线框') + ' · ' + settings.glyphPx + 'px';
        },
        widgetSummary: function () {
          var n = Object.keys(settings.comp).filter(function (k) {
            return settings.comp[k];
          }).length;
          return n + ' 项已启用' + (settings.ripple ? ' · 波纹' : '');
        },
        flash: function (t) {
          var self = this;
          this.status = t;
          setTimeout(function () {
            if (self.status === t) self.status = '';
          }, 1500);
        },
        pick: function (patch, msg) {
          var self = this;
          saveConf(patch).then(function () {
            self.sync();
            if (msg) self.flash(msg);
          });
        },
        toggleEnabled: function () {
          this.pick({ enabled: !settings.enabled }, settings.enabled ? '已停用' : '已启用');
        },
        checkWallData: function () {
          var self = this;
          (settings.wallpapers || []).forEach(function (w) {
            if (self.broken[w.id] !== undefined) return;
            readWallData(w.id).then(function (data) {
              self.$set ? self.$set(self.broken, w.id, !data) : (self.broken[w.id] = !data);
            });
          });
        },
        loadThumbs: function () {
          var self = this;
          (settings.wallpapers || []).forEach(function (w) {
            if (self.thumbs[w.id]) return;
            readWallData(w.id).then(function (data) {
              if (!data) return;
              self.$set ? self.$set(self.thumbs, w.id, data) : (self.thumbs[w.id] = data);
            });
          });
        },
        onUseWall: function (id) {
          var self = this;
          activateWallpaper(id).then(function (ok) {
            self.sync();
            self.flash(ok ? '已切换壁纸' : '这张壁纸的数据丢了，删掉重新添加一次');
            if (!ok) self.checkWallData();
          });
        },
        onRemoveWall: function (id) {
          var self = this;
          removeWallpaper(id).then(function () {
            self.sync();
            self.flash('已删除');
          });
        },
        onRotateNow: function () {
          var self = this;
          rotateWallpaper().then(function (ok) {
            self.sync();
            self.flash(ok ? '已换一张' : '至少要有两张壁纸才能轮换');
          });
        },
        onWallMode: function (v) {
          this.pick({ wallMode: v }, v === 'rotate' ? '已开启轮换' : '已固定');
        },
        onRotateOrder: function (v) {
          this.pick({ rotateOrder: v }, '轮换方式：' + (v === 'random' ? '随机' : '顺序'));
        },
        onRotateWhen: function (v) {
          this.pick({ rotateWhen: v }, '轮换时机：' + (v === 'daily' ? '每日' : '每次打开'));
        },
        onWallpaperFile: function (e) {
          var self = this;
          var files = Array.prototype.slice.call((e && e.target && e.target.files) || []);
          if (!files.length) return;
          // 清空 input，同一批图能再选一次
          try {
            if (e.target.value !== undefined) e.target.value = '';
          } catch (err) {
            /* 忽略 */
          }

          var room = 12 - (settings.wallpapers || []).length;
          if (room <= 0) {
            this.flash('壁纸库已满（最多 12 张），先删掉几张');
            return;
          }
          var list = files.slice(0, room);
          var added = 0;
          var failed = 0;
          var firstId = ''; // 批量添加后默认用这一批里的第一张
          this.flash('正在处理 ' + list.length + ' 张图片…');

          // 逐张处理：压缩 → 取色 → 入库，避免一次性把多张大图塞进内存
          var chain = list.reduce(function (prev, file) {
            return prev.then(function () {
              return new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onload = function () {
                  resolve(String(reader.result || ''));
                };
                reader.onerror = function () {
                  resolve('');
                };
                reader.readAsDataURL(file);
              }).then(function (raw) {
                if (!raw) {
                  failed++;
                  return;
                }
                return compressWallpaper(raw, settings.wallpaperQuality)
                  .then(function (small) {
                    return extractSeedFromImage(small).then(function (seed) {
                      return { small: small, seed: seed };
                    });
                  })
                  .then(function (r) {
                    return addWallpaper(r.small, r.seed || '');
                  })
                  .then(function () {
                    if (!firstId) firstId = settings.activeWallId;
                    added++;
                  })
                  .catch(function () {
                    failed++;
                  });
              });
            });
          }, Promise.resolve());

          chain
            .then(function () {
              // 回到这批的第一张，剩下的让用户自己挑
              if (firstId && firstId !== settings.activeWallId) return activateWallpaper(firstId);
            })
            .then(function () {
              return saveConf({ wallpaperMode: 'cover' });
            })
            .then(function () {
              self.sync();
              self.checkWallData();
              var msg = '已添加 ' + added + ' 张，当前用这组的第一张';
              if (failed) msg += '，' + failed + ' 张失败';
              if (files.length > list.length) msg += '（超出上限 ' + (files.length - list.length) + ' 张未处理）';
              self.flash(msg);
            });
        },

        onPickFromWallpaper: function () {
          var self = this;
          if (!settings.wallpaper) {
            this.flash('先选一张图片');
            return;
          }
          extractSeedFromImage(settings.wallpaper)
            .then(function (seed) {
              if (!seed) {
                self.flash('这张图没取到合适的颜色');
                return;
              }
              return saveConf({ seed: seed }).then(function () {
                self.sync();
                self.flash('已重新取色：' + seed);
              });
            })
            .catch(function (err) {
              self.flash('取色失败：' + ((err && err.message) || err));
            });
        },
        onRemoveWallpaper: function () {
          if (settings.activeWallId) this.onRemoveWall(settings.activeWallId);
          else this.pick({ wallpaperMode: 'off' }, '已关闭壁纸');
        },
        onRoomCard: function (v) {
          this.pick({ roomCard: v }, v === 'compact' ? '房间卡片：极简' : '房间卡片：完整');
        },
        onWallpaperQuality: function (v) {
          this.pick({ wallpaperQuality: v }, '画质：' + v + '（重新选图后生效）');
        },
        onWallpaperMode: function (v) {
          this.pick({ wallpaperMode: v }, '壁纸：' + v);
        },
        onWallpaperOpacity: function (e) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          this.pick({ wallpaperOpacity: clamp(v, 0, 1) });
        },
        onPanelOpacity: function (e) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          this.pick({ panelOpacity: clamp(Math.round(v), 0, 100) });
        },
        onWallpaperBlur: function (e) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          this.pick({ wallpaperBlur: clamp(Math.round(v), 0, 40) });
        },
        onPanelBlur: function (e) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          this.pick({ panelBlur: clamp(Math.round(v), 0, 30) });
        },
        toggleIconReplace: function () {
          this.pick({ iconReplace: !settings.iconReplace }, '图标替换：' + (settings.iconReplace ? '关' : '开'));
        },
        onOpacity: function (key, e) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          var patch = {};
          patch[key] = clamp(Math.round(v), 0, 100);
          this.pick(patch);
        },
        onBoost: function (key, e, min, max) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          var patch = {};
          patch[key] = Math.round(clamp(v, min, max) * 100) / 100;
          this.pick(patch);
        },
        onPreset: function (p) {
          this.pick({ seed: p.seed }, '主题色：' + p.name);
        },
        onSeedInput: function (e) {
          var v = (e && e.target && e.target.value) || '';
          if (parseHex(v)) this.pick({ seed: String(v).toLowerCase() });
        },
        onVariant: function (id) {
          this.pick({ variant: id }, '色调：' + VARIANTS[id].name);
        },
        onThemeLock: function (v) {
          this.pick({ themeLock: v }, v === 'off' ? '跟随客户端' : ('强制' + (v === 'dark' ? '深色' : '浅色')));
        },
        onCanvas: function () {
          this.pick({ canvas: !settings.canvas }, settings.canvas ? '已恢复客户端背景' : '已接管画布');
        },
        onCanvasTone: function (v) {
          this.pick({});
        },
        onContentTone: function (v) {
          this.pick({});
        },
        onLook: function (v) {
          this.pick({ look: v }, v === 'telegram' ? '中性紧凑' : 'MD3 标准');
        },
        onRailSelect: function (v) {
          this.pick({ railSelect: v }, '左栏选中框：' + v);
        },
        onStyle: function (v) {
          this.pick({ style: v }, '图标风格：' + (v === 'filled' ? '实心' : '线框'));
        },
        onColorMode: function (v) {
          this.pick({ colorMode: v }, '图标颜色：' + v);
        },
        onCustomColor: function (e) {
          var v = (e && e.target && e.target.value) || '';
          if (parseHex(v)) this.pick({ customColor: String(v).toLowerCase(), colorMode: 'custom' });
        },
        onSize: function (key, e, min, max) {
          var v = Number(e && e.target && e.target.value);
          if (!isFinite(v)) return;
          var patch = {};
          patch[key] = clamp(Math.round(v), min, max);
          this.pick(patch);
        },
        toggleSlot: function (id) {
          var next = Object.assign({}, settings.slots);
          next[id] = !next[id];
          this.pick({ slots: next });
        },
        toggleComp: function (key) {
          if (key === '__ripple') {
            this.pick({ ripple: !settings.ripple }, '波纹：' + (settings.ripple ? '关' : '开'));
            return;
          }
          var next = Object.assign({}, settings.comp);
          next[key] = !next[key];
          this.pick({ comp: next }, '控件：' + key);
        },
        onReset: function () {
          this.pick(normConf(null), '已恢复默认设置');
        },
        rangeStyle: function (val, min, max) {
          var pct = Math.round(((val - min) / (max - min)) * 100);
          return (
            'background:linear-gradient(to right, var(--brand-text,#7dd95e) ' + pct + '%, var(--opacity-2,#ffffff14) ' + pct + '%)'
          );
        },
      },
      render: function (h) {
        var self = this;

        function row(text, sub, on, onClick) {
          return h('div', { class: 'row bhchat-row-click', on: { click: onClick } }, [
            h('div', { class: 'bhchat-row-text' }, [
              h('div', text),
              sub ? h('div', { class: 'bhchat-row-sub' }, sub) : null,
            ]),
            h('div', { class: 'bhchat-row-actions' }, [
              h(
                'span',
                {
                  class: { 'bhchat-switch': true, on: !!on },
                  on: {
                    click: function (e) {
                      if (e && e.stopPropagation) e.stopPropagation();
                      onClick();
                    },
                  },
                },
                [h('span', { class: 'bhchat-switch-core' })],
              ),
            ]),
          ]);
        }

        function choice(rows, current, onPick) {
          return h(
            'div',
            { class: 'bhchat-list' },
            rows.map(function (r) {
              var on = current === r[0];
              return h('div', { class: 'row bhchat-row-click', on: { click: function () { onPick(r[0]); } } }, [
                h('div', { class: 'bhchat-row-text' }, [
                  h('div', r[1]),
                  h('div', { class: 'bhchat-row-sub' }, r[2]),
                ]),
                h('div', { class: 'bhchat-row-actions' }, [
                  h('span', { class: 'bhchat-md3-radio' + (on ? ' on' : '') }),
                ]),
              ]);
            }),
          );
        }

        /** 二级菜单：点进去的页面标题栏 */
        function backBar(text) {
          return h('div', { class: 'bhchat-md3-nav' }, [
            h(
              'button',
              { class: 'bhchat-md3-nav-back', attrs: { type: 'button' }, on: { click: this ? this.back : self.back } },
              '‹ 返回',
            ),
            h('span', { class: 'bhchat-md3-nav-title' }, text),
          ]);
        }

        /** 一级菜单：一个入口 */
        function entry(text, sub, page) {
          return h('div', { class: 'row bhchat-row-click', on: { click: function () { self.go(page); } } }, [
            h('div', { class: 'bhchat-row-text' }, [h('div', text), h('div', { class: 'bhchat-row-sub' }, sub)]),
            h('div', { class: 'bhchat-row-actions' }, [h('span', { class: 'bhchat-md3-chev' }, '›')]),
          ]);
        }

        function slider(label, value, min, max, step, onInput) {
          return h('div', { class: 'bhchat-field' }, [
            h('span', { class: 'bhchat-field-label' }, label),
            h('input', {
              class: 'bhchat-native-range',
              style: self.rangeStyle(value, min, max),
              attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
              domProps: { value: String(value) },
              on: { input: onInput },
            }),
          ]);
        }

        var c = [];

        // ================================================== 一级：总览
        if (this.page === 'root') {
          c.push(h('div', { class: 'cell-title' }, 'MD3 皮肤'));
          c.push(
            h('p', { class: 'bhchat-hint' }, '配色、壁纸、外观、图标、控件分组设置，点进去调整。'),
          );
          c.push(
            h('div', { class: 'bhchat-list' }, [
              row('启用', this.enabled ? '已生效' : '关闭', this.enabled, function () {
                self.toggleEnabled();
              }),
            ]),
          );
          c.push(
            h('div', { class: 'bhchat-list' }, [
              entry('配色', this.presetName() + ' · ' + this.variantName(), 'color'),
              entry('壁纸', this.wallSummary(), 'wall'),
              entry('外观', this.lookSummary(), 'look'),
              entry('图标', this.iconSummary(), 'icon'),
              entry('控件与动效', this.widgetSummary(), 'widget'),
            ]),
          );
          if (this.status) c.push(h('p', { class: 'bhchat-hint' }, this.status));
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        // ================================================== 二级：配色
        if (this.page === 'color') {
          c.push(backBar('配色'));
          c.push(
            h(
              'div',
              { class: 'bhchat-md3-swatches' },
              this.presets.map(function (p) {
                var on = (self.seed || '').toLowerCase() === p.seed.toLowerCase();
                return h(
                  'div',
                  {
                    class: 'bhchat-md3-swatch' + (on ? ' on' : ''),
                    attrs: { title: p.name },
                    on: { click: function () { self.onPreset(p); } },
                  },
                  [
                    h('span', { class: 'bhchat-md3-swatch-dot', style: { background: p.seed } }),
                    h('span', { class: 'bhchat-md3-swatch-name' }, p.name),
                  ],
                );
              }),
            ),
          );
          c.push(
            h('div', { class: 'bhchat-field' }, [
              h('span', { class: 'bhchat-field-label' }, '自定义主题色'),
              h('input', {
                class: 'bhchat-native-input',
                attrs: { type: 'text', placeholder: '#6750a4', maxlength: '7' },
                domProps: { value: this.seed },
                on: { change: this.onSeedInput },
              }),
            ]),
          );
          c.push(h('div', { class: 'cell-title' }, '色调'));
          c.push(
            choice(
              this.variants.map(function (v) {
                return [v.id, v.name, '彩度目标 ' + v.chroma];
              }),
              this.variant,
              function (v) { self.onVariant(v); },
            ),
          );
          c.push(h('div', { class: 'cell-title' }, '主题锁定'));
          c.push(h('p', { class: 'bhchat-hint' }, '有些房间自带浅色皮肤会把界面顶成浅色，这里可以钉死一种。'));
          c.push(
            choice(
              [
                ['off', '跟随客户端', '房间切换主题时跟着变'],
                ['dark', '强制深色', '不管房间皮肤都用深色'],
                ['light', '强制浅色', '固定白底'],
              ],
              this.themeLock,
              function (v) { self.onThemeLock(v); },
            ),
          );
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        // ================================================== 二级：壁纸
        if (this.page === 'wall') {
          c.push(backBar('壁纸'));
          c.push(h('div', { class: 'cell-title' }, '壁纸库'));
          if ((this.wallpapers || []).length) {
            c.push(
              h(
                'div',
                { class: 'bhchat-md3-wallgrid' },
                this.wallpapers.map(function (w) {
                  var on = w.id === self.activeWallId;
                  return h(
                    'div',
                    {
                      class: 'bhchat-md3-wallitem' + (on ? ' on' : ''),
                      attrs: { title: on ? '当前使用' : '点一下设为当前' },
                      on: { click: function () { if (!on) self.onUseWall(w.id); } },
                    },
                    [
                      w.thumb
                        ? h('img', { class: 'bhchat-md3-wallitem-thumb', attrs: { src: w.thumb, alt: w.name } })
                        : h('div', {
                            class: 'bhchat-md3-wallitem-thumb bhchat-md3-wallitem-ph',
                            style: { background: w.seed || 'var(--opacity-2, rgba(255,255,255,.08))' },
                          }),
                      h('span', { class: 'bhchat-md3-wallitem-name' }, w.name),
                      self.broken && self.broken[w.id]
                        ? h('span', { class: 'bhchat-md3-wallitem-broken' }, '数据缺失')
                        : null,
                      on ? h('span', { class: 'bhchat-md3-wallitem-badge' }, '使用中') : null,
                      h('button', {
                        class: 'bhchat-md3-wallitem-del',
                        attrs: { type: 'button', title: '删除' },
                        on: {
                          click: function (e) {
                            if (e && e.stopPropagation) e.stopPropagation();
                            self.onRemoveWall(w.id);
                          },
                        },
                      }, '×'),
                    ],
                  );
                }),
              ),
            );
          } else {
            c.push(h('p', { class: 'bhchat-hint' }, '还没有壁纸，选一张图片加入库。'));
          }
          c.push(
            h('div', { class: 'bhchat-field' }, [
              h('span', { class: 'bhchat-field-label' }, '添加图片（可多选）'),
              h('input', {
                class: 'bhchat-native-input',
                attrs: { type: 'file', accept: 'image/*', multiple: 'multiple' },
                on: { change: this.onWallpaperFile },
              }),
            ]),
          );
          c.push(h('p', { class: 'bhchat-hint' }, '画质只对之后添加的图片生效；每张单独存，配置里只记元信息。'));

          // 轮换
          if ((this.wallpapers || []).length) {
            c.push(h('div', { class: 'cell-title' }, '轮换'));
            c.push(
              choice(
                [
                  ['fixed', '固定', '一直用当前这张'],
                  ['rotate', '轮换', '按下面的方式自动换'],
                ],
                this.wallMode,
                function (v) { self.onWallMode(v); },
              ),
            );
            if (this.wallMode === 'rotate') {
              c.push(h('div', { class: 'cell-title' }, '轮换方式'));
              c.push(
                choice(
                  [
                    ['random', '随机', '每次随机挑一张，避开当前'],
                    ['sequence', '顺序', '按库里的顺序一张张来'],
                  ],
                  this.rotateOrder,
                  function (v) { self.onRotateOrder(v); },
                ),
              );
              c.push(h('div', { class: 'cell-title' }, '轮换时机'));
              c.push(
                choice(
                  [
                    ['launch', '每次打开', '启动客户端就换一张'],
                    ['daily', '每日', '跨天后第一次启动或运行中跨天'],
                  ],
                  this.rotateWhen,
                  function (v) { self.onRotateWhen(v); },
                ),
              );
              c.push(
                h('div', { class: 'bhchat-actions' }, [
                  h('button', { class: 'bhchat-btn bhchat-btn-secondary', attrs: { type: 'button' }, on: { click: this.onRotateNow } }, '立即换一张'),
                ]),
              );
            }
          }

          c.push(h('div', { class: 'cell-title' }, '用途'));
          c.push(
            choice(
              [
                ['cover', '作背景', '图铺满窗口，盖一层主题色遮罩（推荐）'],
                ['color', '仅取色', '只拿图里的颜色，画布仍是纯色'],
                ['off', '不使用', '图留着但不参与任何效果'],
              ],
              this.wallpaperMode,
              function (v) { self.onWallpaperMode(v); },
            ),
          );

          if (this.wallpaper && this.wallpaperMode === 'cover') {
            c.push(h('div', { class: 'cell-title' }, '透明度与虚化'));
            c.push(
              slider('面板不透明度 ' + this.panelOpacity + '%', this.panelOpacity, 0, 100, 1, this.onOpacity.bind(this, 'panelOpacity')),
            );
            c.push(
              slider('房间名顶栏 ' + this.headerOpacity + '%', this.headerOpacity, 0, 100, 1, this.onOpacity.bind(this, 'headerOpacity')),
            );
            c.push(
              slider('屏幕共享底板 ' + this.shareOpacity + '%', this.shareOpacity, 0, 100, 1, this.onOpacity.bind(this, 'shareOpacity')),
            );
            c.push(
              slider('面板毛玻璃 ' + this.panelBlur + 'px', this.panelBlur, 0, 30, 1, this.onPanelBlur),
            );
            c.push(h('p', { class: 'bhchat-hint' }, '毛玻璃只虚化面板背后那层，壁纸本身保持清晰。'));
            c.push(
              slider('遮罩强度 ' + Math.round(this.wallpaperOpacity * 100) + '%', this.wallpaperOpacity, 0, 1, 0.01, this.onWallpaperOpacity),
            );
            c.push(
              slider('壁纸模糊 ' + this.wallpaperBlur + 'px', this.wallpaperBlur, 0, 40, 1, this.onWallpaperBlur),
            );
          }
          c.push(h('div', { class: 'cell-title' }, '取色强度'));
          c.push(
            slider('强调色饱和度 ' + this.accentBoost.toFixed(2) + '×', this.accentBoost, 0.5, 2, 0.05, function (e) { self.onBoost('accentBoost', e, 0.5, 2); }),
          );
          c.push(
            slider('背景饱和度 ' + this.bgChroma.toFixed(2) + '×', this.bgChroma, 0, 2, 0.05, function (e) { self.onBoost('bgChroma', e, 0, 2); }),
          );
          c.push(
            slider('背景明亮 ' + this.bgBright.toFixed(2) + '×', this.bgBright, 0.7, 1.3, 0.01, function (e) { self.onBoost('bgBright', e, 0.7, 1.3); }),
          );
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        // ================================================== 二级：外观
        if (this.page === 'look') {
          c.push(backBar('外观'));
          c.push(
            h('div', { class: 'bhchat-list' }, [
              row('接管画布', this.canvas ? '客户端渐变/房间背景图已隐藏' : '保留客户端背景', this.canvas, function () {
                self.onCanvas();
              }),
            ]),
          );
          c.push(h('div', { class: 'cell-title' }, '房间卡片'));
          c.push(
            choice(
              [
                ['full', '完整卡片', '横幅大图 + 头像 + 名字 + 工具条'],
                ['compact', '极简', '只留头像和名字，去掉横幅与工具条'],
              ],
              this.roomCard,
              function (v) { self.onRoomCard(v); },
            ),
          );
          c.push(h('div', { class: 'cell-title' }, '观感'));
          c.push(
            choice(
              [
                ['md3', 'MD3 标准', '分层表面色，强调色用得多'],
                ['telegram', '中性紧凑', '近黑底板 + 药丸输入 + 圆形发送键'],
              ],
              this.look,
              function (v) { self.onLook(v); },
            ),
          );
          c.push(h('div', { class: 'cell-title' }, '左栏选中框'));
          c.push(
            choice(
              [
                ['ring', '圆形环', '环和圆形头像一致'],
                ['square', '方形环', '环和头像都用圆角方形'],
                ['tint', '仅底色', '不要边框，只提亮块底色'],
              ],
              this.railSelect,
              function (v) { self.onRailSelect(v); },
            ),
          );
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        // ================================================== 二级：图标
        if (this.page === 'icon') {
          c.push(backBar('图标'));
          c.push(
            h('div', { class: 'bhchat-list' }, [
              row(
                '启用图标替换',
                this.iconReplace ? '所有槽位已接管（' + this.slotList.length + ' 处）' : '全部还原成客户端原图标',
                this.iconReplace,
                function () {
                  self.toggleIconReplace();
                },
              ),
            ]),
          );
          c.push(h('div', { class: 'cell-title' }, '风格'));
          c.push(
            choice(
              [
                ['filled', '实心', '和客户端原图标厚度一致'],
                ['outlined', '线框', '更轻，Material 官网页那套'],
              ],
              this.style,
              function (v) { self.onStyle(v); },
            ),
          );
          c.push(h('div', { class: 'cell-title' }, '颜色'));
          c.push(
            choice(
              [
                ['brand', '跟随主题色', '用 MD3 primary'],
                ['text', '跟随文字色', '和正文一致'],
                ['custom', '自定义', '用下面这个颜色'],
              ],
              this.colorMode,
              function (v) { self.onColorMode(v); },
            ),
          );
          if (this.colorMode === 'custom') {
            c.push(
              h('div', { class: 'bhchat-field' }, [
                h('span', { class: 'bhchat-field-label' }, '图标颜色'),
                h('input', {
                  class: 'bhchat-native-input',
                  attrs: { type: 'text', maxlength: '7' },
                  domProps: { value: this.customColor },
                  on: { change: this.onCustomColor },
                }),
              ]),
            );
          }
          c.push(slider('字形尺寸 ' + this.glyphPx + 'px', this.glyphPx, 12, 32, 1, function (e) { self.onSize('glyphPx', e, 12, 32); }));
          c.push(slider('块图标 ' + this.blockSize + '%', this.blockSize, 30, 100, 1, function (e) { self.onSize('blockSize', e, 30, 100); }));
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        // ================================================== 二级：控件
        if (this.page === 'widget') {
          c.push(backBar('控件与动效'));
          c.push(
            h(
              'div',
              { class: 'bhchat-list' },
              [
                ['button', '主按钮', '填充按钮 20px 圆角、状态层'],
                ['icon', '图标按钮', '圆形、悬停淡层'],
                ['list', '列表行', '圆角与悬停'],
                ['input', '输入区', '圆角与焦点环'],
                ['dialog', '弹窗', '圆角与阴影'],
                ['motion', '过渡曲线', '统一 cubic-bezier(.2,0,0,1)'],
                ['__ripple', '按下波纹', '从指尖扩散一圈'],
              ].map(function (r) {
                var key = r[0];
                var on = key === '__ripple' ? !!self.ripple : !!self.comp[key];
                return row(r[1], r[2], on, function () {
                  self.toggleComp(key);
                });
              }),
            ),
          );
          c.push(
            h('div', { class: 'bhchat-actions' }, [
              h('button', { class: 'bhchat-btn bhchat-btn-secondary', attrs: { type: 'button' }, on: { click: this.onReset } }, '恢复默认设置'),
            ]),
          );
          if (this.status) c.push(h('p', { class: 'bhchat-hint' }, this.status));
          return h('div', { class: 'betterheyboxchat-setting-block' }, c);
        }

        return h('div', { class: 'betterheyboxchat-setting-block' }, c);
      },
    };
  }

  // -------------------------------------------------------------- 启动

  function activate() {
    window.BHChat.registerPanel({ id: PLUGIN_ID, title: 'MD3 皮肤', component: buildPanel() });
    loadConf().then(function () {
      return refresh();
    }).then(function () {
      // 每次打开都轮换 / 没有生效图时兜底
      return maybeRotate(false);
    });
    // 每日轮换：每 10 分钟看一眼日期，跨天就换
    try {
      if (rotateTimer) clearInterval(rotateTimer);
      rotateTimer = setInterval(function () {
        if (settings.wallMode === 'rotate' && settings.rotateWhen === 'daily' && settings.rotateAt !== todayStr()) {
          maybeRotate(false);
        }
      }, 600000);
    } catch (err) {
      /* 忽略 */
    }
    window.BHChat.md3Skin = {
      get: function () {
        return {
          enabled: settings.enabled,
          seed: settings.seed,
          variant: settings.variant,
          themeLock: settings.themeLock,
          canvas: settings.canvas,
          look: settings.look,
          railSelect: settings.railSelect,
          style: settings.style,
          scope: settings.scope,
          colorMode: settings.colorMode,
          glyphPx: settings.glyphPx,
          blockSize: settings.blockSize,
          comp: Object.assign({}, settings.comp),
          slots: Object.assign({}, settings.slots),
          wallpaper: settings.wallpaper,
          wallpapers: (settings.wallpapers || []).map(function (w) {
            return { id: w.id, name: w.name, seed: w.seed, size: w.size, thumb: w.thumb || '' };
          }),
          activeWallId: settings.activeWallId,
          wallMode: settings.wallMode,
          rotateOrder: settings.rotateOrder,
          rotateWhen: settings.rotateWhen,
          wallpaperMode: settings.wallpaperMode,
          wallpaperOpacity: settings.wallpaperOpacity,
          wallpaperBlur: settings.wallpaperBlur,
          panelBlur: settings.panelBlur,
          iconReplace: settings.iconReplace,
          panelOpacity: settings.panelOpacity,
          wallpaperQuality: settings.wallpaperQuality,
          roomCard: settings.roomCard,
          headerOpacity: settings.headerOpacity,
          shareOpacity: settings.shareOpacity,
          accentBoost: settings.accentBoost,
          bgChroma: settings.bgChroma,
          bgBright: settings.bgBright,
        };
      },
      // apply(patch)：改配置并重算；css()：只取当前 CSS（调试/测试用）
      apply: function (patch) {
        return saveConf(patch);
      },
      render: apply,
      css: buildCSS,
      presets: function () {
        return PRESETS.slice();
      },
      variants: function () {
        return Object.keys(VARIANTS).map(function (k) {
          return { id: k, name: VARIANTS[k].name };
        });
      },
      icons: function () {
        return Object.keys(ICONS);
      },
      current: function () {
        return current;
      },
      // 壁纸库
      rotate: rotateWallpaper,
      rotateIfDue: maybeRotate,
      addWallpaper: addWallpaper,
      removeWallpaper: removeWallpaper,
      useWallpaper: activateWallpaper,
      readWallpaper: readWallData,
      extractWallpaperSeed: extractSeedFromImage,
      compressWallpaper: compressWallpaper,
    };
    console.log('[BetterHeyboxChat] md3-skin v1.14.1 已启动，主题色: ' + (current.seed || '未定'));
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  } else {
    console.warn('[BetterHeyboxChat] md3-skin: 找不到 BHChat');
  }
})();
