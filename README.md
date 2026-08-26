# BetterHeyboxChat-plugins

黑盒语音增强框架 [BetterHeyboxChat](https://github.com/BetterSomething/BetterHeyboxChat) 的插件仓库  
BHC 从本仓拉取 `registry.json`，用户点安装后再下载对应插件文件夹。  

## 投稿

1. 新建目录 `your-plugin/`（目录名必须等于插件 `id`，小写字母、数字和连字符）。
2. 放入 `manifest.json` 和入口 `index.js`（可选 `style.css`，额外文件写在 manifest 的 `files` 数组里）。
3. 在根目录 `registry.json` 的 `plugins` 数组增加一项（id / name / version / author / desc / minClientVersion）。
4. 发 Pull Request。

`desc` 最多 100 字纯文本，不要写 HTML
不要覆盖框架内置插件 id（如 `marketplace`、`channel-tts`）。

## 客户端拉取地址

```
https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/registry.json
```
