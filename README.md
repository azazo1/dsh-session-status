# dsh-session-status

给每个 DSH 对话设置**项目状态标签**：内置「进行中 / 已结项 / 搁置中」三态（颜色可调）+ 可自定义标签（名称 + 色板 + 任意 hex 颜色 + 图标）。

- **会话列表最小可见**：每行行首显示状态点（无状态不占位）；单击状态点在「进行中 → 已结项 → 搁置中」之间循环，右键清除，两者都不会打开会话。
- **会话 hover 卡**：悬停会话行时，插件状态标签与 DSH 原生「空闲/运行中」并列显示。
- **对话内头部右上角工具排最左**：状态 pill 排在「在本地打开」图标左边, 形状与它对齐 (24px 高, 8px 圆角, 发丝描边, 主按钮 + 箭头合成一体, 展开符号用同款 10px 箭头图标, 底色按标签色淡染); 单击主按钮快速循环四态 (进行中 → 已结项 → 搁置中 → 无), 右侧箭头展开宿主原生菜单 (Menu) 选择任意标签/清除, 悬浮提示走原生 Tooltip.
- **跨会话/跨浏览器持久化**：会话状态存于 host 端 storage domain (`session_status`), 落盘在 `$DSH_HOME/storages/` 下并带格式版本号; 标签定义存于 host 端 settings 文档 (`dsh-session-status` namespace), 换浏览器/重启不丢。
- **插件页配置卡片**：内置三态名称固定, 颜色可调 (8 色板, 点默认色或「恢复默认」复位); 自定义标签可增删改 (名称, 色板或任意 `#RRGGBB` 颜色, 图标). 输入框, 按钮与开关都用宿主原生原子 (Input / Button / Switch), 开关那一行与「通用设置 → 开发者工具」同款。
- **新会话默认进行中 (可选)**：卡片上的开关 (默认关闭); 打开后, 会话第一次出现在列表里时自动记一条「进行中」, 已有会话不受影响, 手动清除后也不会补回。

## 安装

Web 端装进 `web` profile:

```shell
dsh plugin --profile web add azazo1/dsh-session-status
```

装完重启 `dsh web`, 浏览器里刷新一次页面.

桌面端装进 `desktop` profile. 它由 Electron 应用独占管理, `dsh plugin` 会拒绝 `--profile desktop`, 所以要用应用内的插件管理器: 在插件页的安装入口填上面命令里对应的包名或本地目录. 装上后重启应用, 窗口刷新一次.

引擎版本线要求 `@deepseek-ai/dsh-*` 不低于 `0.1.7-rc.2`, 且仍在 `0.1.x` 上 (peerDependencies 与 devDependencies 都写作 `>=0.1.7-rc.2 <0.2.0`). 更早的引擎线装不上这个版本.

web 与 desktop 两个 profile 跑的是同一套 Web 应用, 桌面端只是多起一个 Host 子进程并给 `<html>` 打上平台标记, 所以同一份包在两边通用, 不需要分别构建.

## 使用

1. 打开任意对话 → 头部右上角工具排最左 (「在本地打开」图标左边) 出现状态 pill（`● 未设置状态`）→ 单击 pill 快速循环「进行中 → 已结项 → 搁置中 → 无」, 或点 pill 右侧箭头从下拉中选择任意标签/清除 (Esc 关闭).
2. 会话列表（侧栏）每行标题前出现对应颜色的状态点；悬停会话行，hover 卡中与「空闲/运行中」并列显示插件状态标签。
3. 直接单击侧栏的状态点也能改状态: 单击在「进行中 → 已结项 → 搁置中」之间循环 (回车/空格等价), 右键清除状态, 两者都不会打开会话。清掉之后该行状态点消失, 需要重新设置时用会话头部的 pill。
4. 插件 → `dsh-session-status` 卡片上的配置区：调整内置三态颜色 (点默认色或「恢复默认」复位); 添加/重命名/改色/换图标/删除自定义标签, 颜色支持色板或任意 `#RRGGBB` (`#RGB` 简写亦可).
5. 同一个卡片上的「新会话默认进行中」开关: 打开后新建的会话会自动带上「进行中」, 不用逐个手动设置; 打开开关的那一刻已经存在的会话不动, 之后手动清除过的会话也不会被补回.

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
  "overrides": { "active": { "color": "#ff00ff" } },  // 内置三态颜色覆盖（可选，不写用默认色）
  "defaultActive": true   // 新会话默认进行中（可选，不写即关闭）
}
```

v0 曾把 `sessions` (会话 → 标签 key) 也放在 settings 里; 升级后由 `lib/migrations/settings-sessions.js` 一次性导入 domain 并从 settings 用户层删除该字段, 迁移进度记在 domain 全局槽的 `settingsSchemaVersion`。

## 开发

```shell
pnpm install
pnpm test
```

测试包括状态存储, 迁移和 HTTP 接线, 以及真实 React DOM 下的同名行, 搜索结果, portal 悬浮卡片, 重排, 改名, 状态清除, 行状态点点击循环 (含点击不打开会话), pill 的原生菜单选择与设置卡片的原生开关 (含写入被拒的报错行) 和卸载. 渲染测试独立加载 `lib/client.js`, 不加载其他插件; 宿主原生原子用 `test/helpers/primitives-stub.mjs` 替身.

改了 `lib/index.js` 里的 `Config` (增删配置字段) 之后必须重启宿主进程 (`dsh web` 或桌面应用): 浏览器刷新只换前端 bundle, 宿主注册的还是旧 schema, 此时前端对新增字段的写入会被拒绝 (配置卡片上会显示提示)。只改 `lib/client.js` 时刷新页面即可。

发布（交互终端，WebAuthn 通行密钥流程；需先配置 npm token：`NPM_PUBLISH_TOKEN` 或 `~/.dsh/secrets/npm-token.txt`）：

```powershell
pwsh -File scripts\publish-interactive.ps1
```

## 实现要点

- **双轨制**: `package.json` 的 `dsh.client.inject` 写 NPM 包名 (含 `@deepseek-ai/dsh-client-ui-primitives`, 原生原子从这里 require); 浏览器 bundle (`lib/client.js`) 的 `exports.inject` 写 Cordis 服务名 (`slots` / `configForms` / `sessions`) -- 写错会导致 web boot 永久 pending.
- **host 一半按服务可用性装配**：settings 注册在插件 `apply` 里直接做；storage domain + HTTP 路由放在 `ctx.inject(['storageDomain', 'webServer'], …)` 子 fiber 里, 缺任一服务（例如 headless 组合）时只失去状态读写, 插件仍可加载。
- **浏览器侧数据通道**：状态映射只能通过 host 路由读写, client 本地保留一份镜像做乐观更新, 写后回填服务端快照, 另有 15s 轮询与窗口聚焦/标签页可见时的立即刷新, 覆盖其它标签页或浏览器造成的变更。
- **列表行无官方槽**: 从 React 行组件的 key 与 `node.id` / `result.id` 交叉确认 session id, 再匹配会话快照, 支持同名分叉, 改名和列表重排. 普通行和搜索结果都可显示标签, 无状态或空白会话不注入. 0.1.7-rc.2 的 `sidebar.session.row.leading` 只在该行主状态为 idle 时渲染 (与行自身状态点互斥), 而插件状态点要与任何行状态同时成立, 因此仍走 DOM 注入.
- **行状态点可点击**: 标记是原生 DOM 节点, 用原生 click / keydown / contextmenu 监听改状态, 并在监听里 `stopPropagation()` 阻断会话行的 React onClick (不打开会话); 标记自身标 `draggable="false"`, 行拖拽排序仍由会话行决定. 单击与回车走三态循环 (四态循环去掉「无」), 右键清除并压掉浏览器右键菜单; 会话 id 在事件里从 `data-session-id` 现读.
- **新会话默认进行中**: 判定全在浏览器侧 (`lib/status-store.js` 的 `planAutoActive`, bundle 内联同款), host 只存 `defaultActive` 这个偏好. 页面载入或开关刚打开的那一轮只取基线 (当时列表里的非空白会话, 一个都不写), 之后只在会话第一次出现, 已经有内容, 且还没有任何状态记录时才补写 active; 状态快照还没拉到时先不判, 避免覆盖已有状态. 空白占位会话留到它有内容后再判, 手动清除过的会话不会再被补回; 页面重载即重置进度, 所以不会批量补写.
- **尽量用宿主原生原子**: 下拉菜单 (`Menu`), 悬浮提示 (`Tooltip`), 开关 (`Switch`), 输入框 (`Input`), 按钮 (`Button`) 与箭头图标 (`IconChevronDownOutlineRegular`) 全部来自 `@deepseek-ai/dsh-client-ui-primitives`, 行为 (键盘走查, 外部点击关闭, 写入中禁用) 与视觉都跟宿主一致. 宿主自己没有对应原子的部分才自绘: 色板圆点, 图标选择器, pill 的 split 外形 (宿主「在本地打开」自己也是手写 CSS, 这里逐项对齐它), 以及行状态点与 hover 卡状态行. 测试用 `test/helpers/primitives-stub.mjs` 替身这套原子 (真实包带 CSS modules, Node 里 import 不了).
- **样式集中在一份注入的 `<style>`** (`#dsh-session-status-style`): 悬停 / 聚焦 / 过渡全走 CSS 伪类, DOM 侧只写 CSS 变量 (淡染底色由标签色现算 `rgba`, 不依赖 `color-mix`), 所以点击与悬停都不会改内联样式, 自身 MutationObserver 不会被自激. 该元素不带 `data-owner`, 否则会被插件的清理逻辑删掉; 卸载时随 disposer 移除.
- **hover 卡无官方槽**: 沿 React portal 的组件归属确认会话 id, 将状态追加到卡内容列; 不受同名标题影响. 点击复制后临时显示的反馈不追加状态.
- **宿主结构依赖**: 行和 hover 卡依赖 DSH 的 React 挂载信息, 这是内部结构而非官方 API. 无法确认 key, props 与快照的一致性时不注入, 防止标错会话; 宿主更换行结构后需重新验证. 本插件独立工作, 不依赖其他状态插件.
- **DOM 更新**: 只更新变化的标记, 移除失效节点; MutationObserver/RAF 对齐在下一轮收敛, 不反复删除并重建未变化的图标.
- **内置态不可删**：settings 的 `mergeLayers` 对数组是整体替换，用户写入 labels 后 resolved 不再含 base 内置项——客户端 `resolveLabels` 始终把内置三态合并回来；内置颜色覆盖存于 user 层 `overrides`，点默认色即清除。
- **惰性清理**：会话删除后其记录由 client 写状态时带 `liveIds` 触发一次 host 端 prune 清掉 (每条记录单独成文件, 删除即逐个删文件)。
- **迁移不留兼容层**：settings 用户层的 `sessions` 只在迁移时读一次 (`ctx.settings.describe()` 的原始用户层), 迁完即删; 记录格式版本交给 storage domain 的 `version` / `compatibleVersions`。

## 相关插件

- [dsh-session-memo](https://github.com/LucienLL/dsh-session-memo)：对话侧边备忘录（GitHub 同步状态 / npm 发布状态 / 项目版本 / 备忘标签）。

> 状态映射迁到 storage domain 后, 仍按 `settingsScope` 读 `dsh-session-status.sessions` 的消费者拿不到数据 (会走各自的降级分支)。dsh-session-memo 的弱联动需要改成调用本插件的 `GET /plugins/dsh-session-status/statuses` 与 `POST /plugins/dsh-session-status/status`。

## License

MIT
