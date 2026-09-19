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
