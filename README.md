# dsh-session-status

给每个 DSH 对话设置**项目状态标签**：内置「进行中 / 已结项 / 搁置中」三态 + 可自定义标签（名称 + 8 色板）。

- **会话列表最小可见**：每行标题前显示状态点（无状态不占位）。
- **对话内头部角落**：状态 pill 一键切换（点按循环三态，或下拉选择任意标签/清除）。
- **跨会话/跨浏览器持久化**：数据存于 host 端 settings 文档（`dsh-session-status` namespace），换浏览器/重启不丢。
- **设置页**：内置三态只读，自定义标签可增删改（名称、颜色）。

## 安装

```bash
dsh plugin --profile web add dsh-session-status
```

或通过 Web UI 的插件管理安装。装完刷新页面即可在会话头部看到状态 pill。

## 使用

1. 打开任意对话 → 头部右侧出现状态 pill（`● 未设置状态`）→ 点击选择「进行中 / 已结项 / 搁置中」或自定义标签，也可点 pill 快速循环切换三态。
2. 会话列表（侧栏）每行标题前出现对应颜色的状态点。
3. 设置 → 「会话状态」页：添加/重命名/改色/删除自定义标签。

## 数据模型

settings namespace `dsh-session-status`：

```jsonc
{
  "labels": [   // 自定义标签（内置三态作为 composition base，用户层不含）
    { "key": "todo", "name": "待办", "color": "#ef4444", "builtin": false }
  ],
  "sessions": { "<sessionId>": "active" }   // 会话 → 标签 key
}
```

## 开发

```powershell
node --check lib\index.js; node --check lib\status-store.js; node --check lib\client.js
node test\status-store.test.mjs     # 纯逻辑单测（主模块方式，沙箱下勿用 node --test）
node test\client-shape.test.mjs     # client bundle 契约：inject 是服务名 + 内联逻辑防漂移
```

发布（交互终端，WebAuthn 通行密钥流程）：

```powershell
pwsh -File scripts\publish-interactive.ps1
```

## 实现要点

- **双轨制**：`package.json` 的 `dsh.client.inject` 写 NPM 包名；浏览器 bundle（`lib/client.js`）的 `exports.inject` 写 Cordis 服务名（`slots` / `settingsScope` / `sessions`）——写错会导致 web boot 永久 pending。
- **列表行无官方槽**：行级状态点走 DOM 注入（`[role="treeitem"][aria-selected]` + 标题反查 session id + MutationObserver/RAF 节流），`data-owner` 标记自清理；标题重复行宁可漏不可错。
- **内置态不可删**：settings 的 `mergeLayers` 对数组是整体替换，用户写入 labels 后 resolved 不再含 base 内置项——客户端 `resolveLabels` 始终把内置三态合并回来。
- **惰性清理**：会话归档/删除后，其 `sessions` 条目在下次写入时自动剔除；空映射 `unset` 不落盘。

## 相关插件

- [dsh-session-memo](https://github.com/LucienLL/dsh-session-memo)：对话侧边备忘录（GitHub 同步状态 / npm 发布状态 / 项目版本 / 备忘标签），与本站状态标签弱联动（面板头部显示并可切换）。

## License

MIT
