# BetterHeyboxChat-plugins

黑盒语音增强框架 [BetterHeyboxChat](https://github.com/BetterSomething/BetterHeyboxChat) 的插件仓库  
BHC 从本仓拉取 `registry.json`，用户点安装后再下载对应插件文件夹。

框架只内置「插件市场」。下面这些官方插件也在本仓，由用户自己决定装哪些。

| id | 名称 |
| --- | --- |
| `custom-room-bg` | 自定义房间背景 |
| `channel-tts` | 频道文字消息 TTS |
| `laughter-fav-fix` | 语音包收藏显示修复 |
| `screen-share-danmaku` | 屏幕共享增强 |
| `block-update` | 屏蔽客户端更新 |
| `official-room-deco` | 强制上传房间自定义背景 |
| `export-credentials` | 用户凭据导出 |
| `heybox-dev-mcp` | 开发调试 MCP（本机 Agent 桥，仅 127.0.0.1） |

## 投稿

1. 新建目录 `your-plugin/`（目录名必须等于插件 `id`，小写字母、数字和连字符）。
2. 放入 `manifest.json` 和入口 `index.js`（可选 `style.css`，额外文件写在 manifest 的 `files` 数组里）。
3. 在根目录 `registry.json` 的 `plugins` 数组增加一项（id / name / version / author / desc / minClientVersion）。
4. 发 Pull Request。

`desc` 最多 100 字纯文本，不要写 HTML。  
不要覆盖框架内置插件 id（仅 `marketplace`）。

## 客户端拉取地址

```
https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/registry.json
```
