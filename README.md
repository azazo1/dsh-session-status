# dsh-session-status

给每个 DSH 对话设置**项目状态标签**：内置「进行中 / 已结项 / 搁置中」三态（颜色可调）+ 可自定义标签（名称 + 色板 + 任意 hex 颜色 + 图标）。

- **会话列表最小可见**：每行行首显示状态点（无状态不占位）。
- **会话 hover 卡**：悬停会话行时，插件状态标签与 DSH 原生「空闲/运行中」并列显示。
- **对话内头部角落**：状态 pill 单击快速循环三态（进行中 → 已结项 → 搁置中 → 无），pill 右侧箭头展开下拉选择任意标签/清除。
- **跨会话/跨浏览器持久化**：数据存于 host 端 settings 文档（`dsh-session-status` namespace），换浏览器/重启不丢。
- **设置页**：内置三态名称固定、颜色可调（8 色板，点默认色或「恢复默认」复位）；自定义标签可增删改（名称、色板或任意 `#RRGGBB` 颜色、图标）。

## 安装

```bash
dsh plugin --profile web add dsh-session-status
```

或通过 Web UI 的插件管理安装。装完重启 `dsh web` 后即可在会话头部看到状态 pill。

## 使用

1. 打开任意对话 → 头部右侧出现状态 pill（`● 未设置状态`）→ 单击 pill 快速循环「进行中 → 已结项 → 搁置中 → 无」，或点 pill 右侧箭头从下拉中选择任意标签/清除。
2. 会话列表（侧栏）每行标题前出现对应颜色的状态点；悬停会话行，hover 卡中与「空闲/运行中」并列显示插件状态标签。
3. 设置 → 「会话状态」页：调整内置三态颜色（点默认色或「恢复默认」复位）；添加/重命名/改色/换图标/删除自定义标签，颜色支持色板或任意 `#RRGGBB`（`#RGB` 简写亦可）。

## 数据模型

settings namespace `dsh-session-status`：

```jsonc
{
  "labels": [   // 自定义标签（内置三态作为 composition base，用户层不含）
    { "key": "todo", "name": "待办", "color": "#ef4444", "icon": "tag", "builtin": false }
  ],
  "sessions": { "<sessionId>": "active" },   // 会话 → 标签 key
  "overrides": { "active": { "color": "#ff00ff" } }   // 内置三态颜色覆盖（可选，不写用默认色）
}
```

## 开发

```powershell
node --check lib\index.js; node --check lib\status-store.js; node --check lib\client.js
node test\status-store.test.mjs     # 纯逻辑单测（主模块方式，沙箱下勿用 node --test）
node test\client-shape.test.mjs     # client bundle 契约：inject 是服务名 + 内联逻辑防漂移
node scripts\smoke-hover.mjs        # CDP 冒烟：hover 卡状态注入 + 设置页色板（需 DSH GUI 在 127.0.0.1:3180）
```

发布（交互终端，WebAuthn 通行密钥流程；需先配置 npm token：`NPM_PUBLISH_TOKEN` 或 `~/.dsh/secrets/npm-token.txt`）：

```powershell
pwsh -File scripts\publish-interactive.ps1
```

## 实现要点

- **双轨制**：`package.json` 的 `dsh.client.inject` 写 NPM 包名；浏览器 bundle（`lib/client.js`）的 `exports.inject` 写 Cordis 服务名（`slots` / `settingsScope` / `sessions`）——写错会导致 web boot 永久 pending。
- **列表行无官方槽**：行级状态点走 DOM 注入（`[role="treeitem"][aria-selected]` + 标题反查 session id + MutationObserver/RAF 节流），`data-owner` 标记自清理；标题重复行宁可漏不可错。
- **hover 卡无官方槽**：会话 hover 卡是 portal 到 body 的复制卡（`div[role="button"]` + 内联 left/top 定位），按标题反查唯一会话，把状态行追加进卡内容列；无状态/标题重复不注入。
- **内置态不可删**：settings 的 `mergeLayers` 对数组是整体替换，用户写入 labels 后 resolved 不再含 base 内置项——客户端 `resolveLabels` 始终把内置三态合并回来；内置颜色覆盖存于 user 层 `overrides`，点默认色即清除。
- **惰性清理**：会话归档/删除后，其 `sessions` 条目在下次写入时自动剔除；空映射 `unset` 不落盘。

## 相关插件

- [dsh-session-memo](https://github.com/LucienLL/dsh-session-memo)：对话侧边备忘录（GitHub 同步状态 / npm 发布状态 / 项目版本 / 备忘标签），与本站状态标签弱联动（面板头部显示并可切换）。

## License

MIT
