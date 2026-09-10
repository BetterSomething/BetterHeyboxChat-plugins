# BetterHeyboxChat-plugins

黑盒语音增强框架 [BetterHeyboxChat](https://github.com/BetterSomething/BetterHeyboxChat) 的插件仓库  
BHC 从本仓拉取 `registry.json`，用户点安装后再下载对应插件文件夹。

框架只内置插件市场。下面这些官方插件也在本仓，由用户自己决定装哪些

| id | 名称 |
| --- | --- |
| `custom-room-bg` | 自定义房间背景 |
| `channel-tts` | 频道文字消息 TTS |
| `misc-fix` | 杂项修复（语音包收藏刷新、设备列表溢出） |
| `screen-share-danmaku` | 屏幕共享增强 |
| `block-update` | 屏蔽客户端更新 |
| `official-room-deco` | 强制上传房间自定义背景 |
| `export-credentials` | 用户凭据导出 |
| `heybox-dev-mcp` | 开发调试 MCP |
| `heybox-bbs` | 客户端社区功能补全 |

## 投稿

1. 新建目录 `your-plugin/`（目录名必须等于插件 `id`，小写字母、数字和连字符）。
2. 放入 `manifest.json` 和入口 `index.js`（可选 `style.css`，额外文件写在 manifest 的 `files` 数组里）。
3. 在根目录 `registry.json` 的 `plugins` 数组增加一项（id / name / version / author / desc / minClientVersion）。
4. 发 Pull Request。

`desc` 最多 100 字纯文本，不要写 HTML。  
不要覆盖框架内置插件 id（仅 `marketplace`）。

同一份插件必须同时兼容黑盒语音 **1.56.0 和 1.57.0**（与框架 `SUPPORTED_CLIENT_VERSIONS` 对齐）。`minClientVersion` 是下限，不是只支持这一版。新 API 先探测是否存在再调用；不要写死 webpack 数字 ID，也不要在说明里写仅某某版本。细则见框架仓 [docs/09-plugin-dev.md](https://github.com/BetterSomething/BetterHeyboxChat/blob/main/docs/09-plugin-dev.md)的 版本兼容 部分

## 客户端拉取地址

```
https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/registry.json
```
