# dsh-session-status

给每个 DSH 对话设置**项目状态标签**：内置「进行中 / 已结项 / 搁置中」三态（颜色可调）+ 可自定义标签（名称 + 色板 + 任意 hex 颜色 + 图标）。

- **会话列表最小可见**：每行行首显示状态点（无状态不占位）。
- **会话 hover 卡**：悬停会话行时，插件状态标签与 DSH 原生「空闲/运行中」并列显示。
- **对话内头部角落**：状态 pill 单击快速循环三态（进行中 → 已结项 → 搁置中 → 无），pill 右侧箭头展开下拉选择任意标签/清除。
- **跨会话/跨浏览器持久化**：会话状态存于 host 端 storage domain (`session_status`), 落盘在 `$DSH_HOME/storages/` 下并带格式版本号; 标签定义存于 host 端 settings 文档 (`dsh-session-status` namespace), 换浏览器/重启不丢。
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

分两处存放: 会话状态在 storage domain, 标签定义在 settings。

**storage domain `session_status`** (`lib/domain/spec.js`), `per-record` 布局, 每个有状态的会话一份记录:

```jsonc
// $DSH_HOME/storages/session_status/statuses/<sessionId>.json
{ "sessionId": "session-…", "labelKey": "active", "updatedAt": "2026-09-12T07:00:00.000Z" }
// $DSH_HOME/storages/session_status/global.json -- 记录 settings 侧结构已迁移到哪一版
{ "settingsSchemaVersion": 1 }
```

domain 版本号为 `1`; 记录结构变化时递增, 仍可读的旧版本同时列进 `compatibleVersions`。记录 key 就是 session id (per-record 布局要求它可作文件路径段)。

浏览器不直接碰这份存储, 走 host 路由读写:

| 路由 | 请求 | 响应 |
| --- | --- | --- |
| `GET /plugins/dsh-session-status/statuses` | - | `{ statuses }` |
| `POST /plugins/dsh-session-status/status` | `{ sessionId, labelKey \| null }` | `{ statuses }` |
| `POST /plugins/dsh-session-status/prune` | `{ liveIds: string[] }` | `{ statuses, removed }` |

**settings namespace `dsh-session-status`** (v1), 只剩用户可编辑的偏好:

```jsonc
{
  "labels": [   // 自定义标签（内置三态作为 composition base，用户层不含）
    { "key": "todo", "name": "待办", "color": "#ef4444", "icon": "tag", "builtin": false }
  ],
  "overrides": { "active": { "color": "#ff00ff" } }   // 内置三态颜色覆盖（可选，不写用默认色）
}
```

v0 曾把 `sessions` (会话 → 标签 key) 也放在 settings 里; 升级后由 `lib/migrations/settings-sessions.js` 一次性导入 domain 并从 settings 用户层删除该字段, 迁移进度记在 domain 全局槽的 `settingsSchemaVersion`。

## 开发

```powershell
pnpm install                        # 只需要 zod（storage domain 的记录 schema）
node --check lib\index.js; node --check lib\status-store.js; node --check lib\client.js
node test\status-store.test.mjs     # 纯逻辑单测（主模块方式，沙箱下勿用 node --test）
node test\migration.test.mjs        # settings v0 → v1 迁移（版本门控 / 导入 / 清理）
node test\domain-service.test.mjs   # 会话状态服务（假 domain handle）
node test\client-shape.test.mjs     # client bundle 契约：inject 是服务名 + 内联逻辑防漂移 + 路由接线
node scripts\smoke-hover.mjs        # CDP 冒烟：hover 卡状态注入 + 设置页色板（需 DSH GUI 在 127.0.0.1:3180）
```

发布（交互终端，WebAuthn 通行密钥流程；需先配置 npm token：`NPM_PUBLISH_TOKEN` 或 `~/.dsh/secrets/npm-token.txt`）：

```powershell
pwsh -File scripts\publish-interactive.ps1
```

## 实现要点

- **双轨制**：`package.json` 的 `dsh.client.inject` 写 NPM 包名；浏览器 bundle（`lib/client.js`）的 `exports.inject` 写 Cordis 服务名（`slots` / `settingsScope` / `sessions`）——写错会导致 web boot 永久 pending。
- **host 一半按服务可用性装配**：settings 注册在插件 `apply` 里直接做；storage domain + HTTP 路由放在 `ctx.inject(['storageDomain', 'webServer'], …)` 子 fiber 里, 缺任一服务（例如 headless 组合）时只失去状态读写, 插件仍可加载。
- **浏览器侧数据通道**：状态映射只能通过 host 路由读写, client 本地保留一份镜像做乐观更新, 写后回填服务端快照, 另有 15s 轮询与窗口聚焦/标签页可见时的立即刷新, 覆盖其它标签页或浏览器造成的变更。
- **列表行无官方槽**：行级状态点走 DOM 注入（`[role="treeitem"][aria-selected]` + 标题反查 session id + MutationObserver/RAF 节流），`data-owner` 标记自清理；标题重复行宁可漏不可错。
- **hover 卡无官方槽**：会话 hover 卡是 portal 到 body 的复制卡（`div[role="button"]` + 内联 left/top 定位），按标题反查唯一会话，把状态行追加进卡内容列；无状态/标题重复不注入。
- **内置态不可删**：settings 的 `mergeLayers` 对数组是整体替换，用户写入 labels 后 resolved 不再含 base 内置项——客户端 `resolveLabels` 始终把内置三态合并回来；内置颜色覆盖存于 user 层 `overrides`，点默认色即清除。
- **惰性清理**：会话删除后其记录由 client 写状态时带 `liveIds` 触发一次 host 端 prune 清掉 (每条记录单独成文件, 删除即逐个删文件)。
- **迁移不留兼容层**：settings 用户层的 `sessions` 只在迁移时读一次 (`ctx.settings.describe()` 的原始用户层), 迁完即删; 记录格式版本交给 storage domain 的 `version` / `compatibleVersions`。

## 相关插件

- [dsh-session-memo](https://github.com/LucienLL/dsh-session-memo)：对话侧边备忘录（GitHub 同步状态 / npm 发布状态 / 项目版本 / 备忘标签）。

> 状态映射迁到 storage domain 后, 仍按 `settingsScope` 读 `dsh-session-status.sessions` 的消费者拿不到数据 (会走各自的降级分支)。dsh-session-memo 的弱联动需要改成调用本插件的 `GET /plugins/dsh-session-status/statuses` 与 `POST /plugins/dsh-session-status/status`。

## License

MIT
