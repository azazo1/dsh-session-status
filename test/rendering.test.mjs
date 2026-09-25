import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './helpers/render-harness.mjs'

const sameTitle = '相同的分叉标题 (1)'
const sessions = [
  { id: 's1', displayTitle: sameTitle, blank: false },
  { id: 's2', displayTitle: sameTitle, blank: false },
]
const owner = '[data-owner="dsh-session-status"]'
const marker = (view, id, part = 'row') => view.document.querySelector(
  `${owner}[data-owner-part="${part}"][data-session-id="${id}"]`,
)

// 宿主没有公开的行 ID, 此用例必须经过真实 React 的 key/props 和 portal 归属.
test('同名分叉的行和悬浮卡片分别显示自己的状态, 重排与改名不串行', async t => {
  const view = await createHarness({ s1: 'active', s2: 'done' })
  t.after(() => view.close())
  await view.render(sessions, { hover: true, known: [...sessions,
    { id: 'hidden', displayTitle: sameTitle, blank: false, origin: 'subagent' },
  ] })
  for (const part of ['row', 'hover']) {
    assert.equal(marker(view, 's1', part)?.getAttribute('data-status-key'), 'active')
    assert.equal(marker(view, 's2', part)?.getAttribute('data-status-key'), 'done')
  }
  const first = marker(view, 's1')
  const hover = marker(view, 's1', 'hover')
  await view.notify()
  assert.equal(marker(view, 's1'), first)
  assert.equal(marker(view, 's1', 'hover'), hover)
  const renamed = { ...sessions[0], displayTitle: '另一个名字' }
  await view.render([sessions[1], renamed], { hover: true })
  assert.equal(marker(view, 's1'), first)
  assert.equal(marker(view, 's1').closest('[data-row]').getAttribute('data-row'), 's1')
  assert.equal(marker(view, 's2').closest('[data-row]').getAttribute('data-row'), 's2')
  assert.equal(marker(view, 's1', 'hover').closest('[data-card]').getAttribute('data-card'), 's1')
  await view.statuses({ s1: 'paused' })
  assert.equal(marker(view, 's1').getAttribute('data-status-key'), 'paused')
  assert.equal(marker(view, 's1', 'hover').getAttribute('data-status-key'), 'paused')
  assert.equal(marker(view, 's2'), null)
  assert.equal(marker(view, 's2', 'hover'), null)
  await view.render([renamed], { hover: true, copied: true })
  assert.equal(marker(view, 's1', 'hover'), null)
  await view.render([renamed], { hover: true })
  assert.equal(marker(view, 's1', 'hover').getAttribute('data-status-key'), 'paused')
  view.disposePlugin()
  await view.flush()
  assert.equal(view.document.querySelectorAll(owner).length, 0)
})

test('搜索结果通过 result.id 定位, 未知身份与空白行不注入', async t => {
  const view = await createHarness({ s1: 'active', s2: 'done' })
  t.after(() => view.close())
  await view.render(sessions, { search: true })
  assert.equal(marker(view, 's1').closest('[data-row]').getAttribute('data-row'), 's1')
  assert.equal(marker(view, 's2').closest('[data-row]').getAttribute('data-row'), 's2')
  await view.render(sessions, { known: [{ ...sessions[0], blank: true }] })
  assert.equal(view.document.querySelectorAll(owner).length, 0)
  const foreign = view.document.createElement('div')
  foreign.setAttribute('role', 'treeitem')
  foreign.setAttribute('aria-selected', 'false')
  foreign.innerHTML = `<span>${sameTitle}</span>`
  view.document.body.append(foreign)
  await view.render([sessions[0]])
  assert.equal(foreign.querySelector(owner), null)
  assert.equal(view.document.querySelectorAll(owner).length, 1)
  await view.unready()
  assert.equal(view.document.querySelectorAll(owner).length, 0)
})

// 行状态点三态循环 (清除走右键), 且点击不能打开会话.
test('单击行状态点循环三态且不打开会话, 右键清除, 键盘与搜索结果行同样生效', async t => {
  const view = await createHarness({ s1: 'active', s2: 'done' })
  t.after(() => view.close())
  await view.render(sessions)

  const dot = marker(view, 's1')
  assert.equal(dot.getAttribute('role'), 'button')
  assert.equal(dot.getAttribute('tabindex'), '0')
  assert.equal(dot.getAttribute('draggable'), 'false', '状态点自身不是拖拽源')
  assert.match(dot.getAttribute('title'), /右键清除/)
  assert.match(dot.getAttribute('aria-label'), /进行中/)

  view.click(dot)
  await view.flush()
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: 'done' })
  assert.deepEqual(view.rowClicks, [], '点击状态点不能打开会话')
  assert.equal(dot.getAttribute('data-status-key'), 'done')
  assert.equal(marker(view, 's1'), dot, '状态点节点应复用, 不重建')

  // done -> paused -> 进行中: 三态循环不会把状态点清掉.
  view.click(dot)
  await view.flush()
  assert.equal(dot.getAttribute('data-status-key'), 'paused')
  view.click(dot)
  await view.flush()
  assert.equal(dot.getAttribute('data-status-key'), 'active')
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: 'active' })

  // 回车与空格等价于单击.
  view.keydown(dot, 'Enter')
  await view.flush()
  assert.equal(dot.getAttribute('data-status-key'), 'done')

  // 右键清除, 并压掉浏览器右键菜单.
  assert.equal(view.contextmenu(dot), false, '右键必须 preventDefault')
  await view.flush()
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: null })
  assert.equal(marker(view, 's1'), null)
  assert.deepEqual(view.rowClicks, [])

  // 自定义标签不参与循环, 回落成「进行中」.
  view.scope.value = { labels: [{ key: 'todo', name: '待办', color: '#ef4444', icon: 'tag', builtin: false }] }
  await view.notify()
  await view.statuses({ s1: 'todo', s2: 'done' })
  assert.equal(marker(view, 's1').getAttribute('data-status-key'), 'todo')
  view.click(marker(view, 's1'))
  await view.flush()
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: 'active' })

  // 搜索结果行本身是 button, 状态点仍是 span, 点击同样被阻断.
  await view.render(sessions, { search: true })
  const searchDot = marker(view, 's1')
  assert.equal(searchDot.tagName, 'SPAN')
  view.click(searchDot)
  await view.flush()
  assert.deepEqual(view.rowClicks, [], '搜索结果行也不能被状态点打开')
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: 'done' })
})

test('插件样式表注入一次, 不带 data-owner, 卸载时移除', async t => {
  const view = await createHarness({ s1: 'active' })
  t.after(() => view.close())
  await view.render(sessions)
  const style = view.document.getElementById('dsh-session-status-style')
  assert.ok(style, '样式表应挂在 document.head')
  assert.equal(style.getAttribute('data-owner'), null, '带 data-owner 会被插件自身的清理删掉')
  assert.equal(view.document.querySelectorAll('#dsh-session-status-style').length, 1)
  for (const selector of ['.dss-pill-main', '.dss-row-dot', '.dss-pill-anchor']) {
    assert.ok(style.textContent.includes(selector), `样式表缺少 ${selector}`)
  }
  view.disposePlugin()
  await view.flush()
  assert.equal(view.document.getElementById('dsh-session-status-style'), null)
})

// 「新会话默认进行中」: 只认客户端第一次看到的会话, 取基线那轮与手动清除都不写。
test('打开新会话默认进行中后只为首次出现的会话补写状态', async t => {
  const view = await createHarness({})
  t.after(() => view.close())
  await view.render(sessions)
  assert.equal(view.lastRequest('/status'), null, '开关未打开时不应写状态')

  view.scope.value = { labels: [], defaultActive: true }
  await view.notify()
  await view.flush()
  assert.equal(view.lastRequest('/status'), null, '打开开关的第一轮只取基线, 不写状态')

  const added = { id: 's3', displayTitle: '新会话', blank: false }
  await view.render([...sessions, added])
  await view.flush()
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's3', labelKey: 'active' })
  assert.equal(marker(view, 's3').getAttribute('data-status-key'), 'active')
  assert.equal(marker(view, 's1'), null, '已有会话不能被补写')

  // 手动清除后不会被自动补回。
  assert.equal(view.contextmenu(marker(view, 's3')), false)
  await view.flush()
  assert.equal(marker(view, 's3'), null)
  await view.render([...sessions, added])
  await view.flush()
  const writes = view.requests
    .filter(request => request.path.endsWith('/status'))
    .map(request => request.body)
  assert.deepEqual(writes, [
    { sessionId: 's3', labelKey: 'active' },
    { sessionId: 's3', labelKey: null },
  ])
})

// pill 的下拉交给原生 Menu: 点箭头开合, 点某一项即写入, 当前项带勾选标记.
test('pill 用原生 Menu 选标签与清除, 选完自动收起', async t => {
  const view = await createHarness({ s1: 'active' })
  t.after(() => view.close())
  await view.render(sessions, { pill: 's1' })

  const caret = view.document.querySelector('.dss-pill-caret')
  assert.ok(caret, 'pill 要有箭头半边')
  assert.equal(view.document.querySelector('[data-menu-open]').getAttribute('data-menu-open'), 'false')

  await view.clickAct(caret)
  assert.equal(view.document.querySelector('[data-menu-open]').getAttribute('data-menu-open'), 'true')
  const items = view.document.querySelectorAll('[data-menu-item]')
  assert.equal(items.length, 4, '内置三态 + 清除')
  assert.equal(view.document.querySelector('[data-menu-item="active"]').getAttribute('aria-checked'), 'true')

  await view.clickAct(view.document.querySelector('[data-menu-item="paused"]'))
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: 'paused' })
  assert.equal(view.document.querySelector('[data-menu-open]').getAttribute('data-menu-open'), 'false', '选完要收起')

  await view.clickAct(caret)
  await view.clickAct(view.document.querySelector('[data-menu-item="__clear"]'))
  assert.deepEqual(view.lastRequest('/status').body, { sessionId: 's1', labelKey: null })
})

// 设置卡片的开关照宿主设置行写: 写入中禁用, 宿主拒绝时显示原生 role="alert".
test('设置卡片用原生 Switch 写 settings, 被拒时显示原生 alert 行', async t => {
  const view = await createHarness({})
  t.after(() => view.close())
  await view.render(sessions, { settings: true })

  const toggle = view.document.querySelector('[role="switch"]')
  assert.ok(toggle, '设置卡片要有原生 Switch')
  assert.equal(toggle.getAttribute('aria-checked'), 'false')
  assert.equal(toggle.getAttribute('aria-label'), '新会话默认进行中')
  assert.equal(view.document.querySelector('[role="alert"]'), null)

  // 宿主接受: 写入 true
  await view.clickAct(toggle)
  assert.deepEqual(view.scopeWrites.at(-1), ['defaultActive', true])

  // 宿主拒绝 (最常见: 宿主还没重启, 新字段不在 schema 里): 开关弹回, 并出现 alert 行
  view.setWriteOk(false)
  await view.clickAct(toggle)
  const alert = view.document.querySelector('[role="alert"]')
  assert.ok(alert, '写入被拒时要出现 role="alert"')
  assert.match(alert.textContent, /重启 dsh web/)
  assert.equal(view.document.querySelector('[role="switch"]').getAttribute('aria-checked'), 'false')

  // 开关状态跟 settings 回读走; 下一次写入时清掉提示 (与原生设置行一致)
  view.setWriteOk(true)
  view.scope.value = { labels: [], overrides: {}, defaultActive: true }
  await view.notify()
  assert.equal(view.document.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true')
  await view.clickAct(view.document.querySelector('[role="switch"]'))
  assert.equal(view.document.querySelector('[role="alert"]'), null, '下次写入要清掉提示')
  assert.deepEqual(view.scopeWrites.at(-1), ['defaultActive', 'UNSET'])
})
