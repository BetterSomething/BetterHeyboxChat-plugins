# 开发调试 MCP

给 Cursor Agent 用的本机桥：黑盒渲染进程开 `127.0.0.1` HTTP，MCP 再转过去。

**只绑回环地址。** 内置 env / Vuex / storage 会打码 `pkey` / token；`heybox_eval` 是裸执行，不要用来导出登录态。

## 安装

1. 市场（或本地调试仓）安装 `heybox-dev-mcp`，重启黑盒。
2. 右下角有 BHC 角标后，桥会写 `{dataRoot}/heybox-dev-mcp.json`（默认 `%APPDATA%\BetterHeyboxChat\`）。
3. Cursor `mcp.json` 增加：

```json
"heybox-dev": {
  "command": "node",
  "args": ["G:\\DevProject\\BetterHeyboxChat-plugins\\heybox-dev-mcp\\mcp-server.mjs"]
}
```

路径按你的插件仓改。握手 token 只在那个 json 里，不要提交仓库。

可选环境变量：`HEYBOX_DEV_MCP_URL`、`HEYBOX_DEV_MCP_TOKEN`、`HEYBOX_CDP_PORT`。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `heybox_status` | 桥是否通、当前房间 |
| `heybox_eval` / `heybox_eval_file` | 渲染进程执行 JS |
| `heybox_env` | location / 版本 / `process.env`（已打码） |
| `heybox_vuex` | `mapState` 或 `store.state` 路径 |
| `heybox_webpack_require` / `_search` / `_ids` | 官方模块 |
| `heybox_dom` | `querySelectorAll` |
| `heybox_console` / `heybox_network` | 挂钩后的最近日志 |
| `heybox_plugins` / `heybox_storage` / `heybox_paths` | 运行时探查 |
| `heybox_open_devtools` | 打开原生 F12 |
| `heybox_cdp_*` | 仅当客户端带了 `remote-debugging-port` |

不改 `ELECTRON_ENV`，也不依赖远程调试端口。
