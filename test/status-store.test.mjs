/**
 * 纯逻辑单测：lib/status-store.js（零 DSH 依赖）。
 * 主模块方式运行（沙箱下 node --test 会 spawn 子进程被 EPERM 拦截）：
 *   node test/status-store.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_LABELS, PALETTE, MAX_CUSTOM_LABELS, LABEL_KEY_PATTERN, LABEL_ICONS,
  resolveLabels, findLabel, labelIconKey, resolveLabelIcon, nextSessionStatus, assignStatus, clearStatus,
  pruneSessions, validateLabelInput, generateLabelKey, nextPaletteColor,
  builtinDefaultColor, applyBuiltinOverride, setOverride, clearOverride, normalizeHex,
} from '../lib/status-store.js'

test('BUILTIN_LABELS：三态齐全、key 合法、颜色在色板、builtin 标记', () => {
  assert.equal(BUILTIN_LABELS.length, 3)
  const keys = BUILTIN_LABELS.map(l => l.key)
  assert.deepEqual(keys, ['active', 'done', 'paused'])
  for (const label of BUILTIN_LABELS) {
    assert.match(label.key, LABEL_KEY_PATTERN)
    assert.equal(label.builtin, true)
    assert.ok(label.name.length > 0)
    assert.ok(PALETTE.includes(label.color) || label.color === '#22c55e' || label.color === '#3b82f6' || label.color === '#9ca3af')
  }
})

test('resolveLabels：空值/缺字段 → 仅内置三态', () => {
  for (const input of [undefined, null, {}, { labels: [] }, { labels: undefined }]) {
    const labels = resolveLabels(input)
    assert.equal(labels.length, 3)
    assert.deepEqual(labels.map(l => l.key), ['active', 'done', 'paused'])
  }
  assert.equal(resolveLabels([]).length, 3)
})

test('resolveLabels：内置 key 优先且不被用户覆盖（同名去重）', () => {
  const labels = resolveLabels({
    labels: [
      { key: 'active', name: '被覆盖', color: '#000000' },
      { key: 'custom', name: '自定义', color: '#ef4444' },
      { key: 'active', name: '重复内置', color: '#111111' },
    ],
  })
  assert.equal(labels.length, 4)
  assert.deepEqual(labels.map(l => l.key), ['active', 'done', 'paused', 'custom'])
  assert.equal(labels[0].name, '进行中')          // 内置赢
  assert.equal(labels[3].builtin, false)
  assert.equal(labels[3].color, '#ef4444')
})

test('resolveLabels：overrides 改内置呈现颜色，不改变 key/语义', () => {
  const labels = resolveLabels({
    labels: [{ key: 'custom', name: '自定义', color: '#ef4444' }],
    overrides: { active: { color: '#ff00ff' } },
  })
  assert.equal(labels.length, 4)
  assert.equal(labels[0].key, 'active')
  assert.equal(labels[0].builtin, true)
  assert.equal(labels[0].color, '#ff00ff')         // 覆盖生效
  assert.equal(labels[1].color, '#3b82f6')         // 未覆盖的保持默认
  assert.equal(labels[3].color, '#ef4444')         // 自定义不受影响
  // 空字符串/缺字段的覆盖不生效；纯 labels 数组输入无 overrides
  const noop = resolveLabels({ labels: [], overrides: { active: { color: '' }, done: {} } })
  assert.equal(noop[0].color, '#22c55e')
  assert.equal(noop[1].color, '#3b82f6')
  assert.equal(resolveLabels([])[0].color, '#22c55e')
})

test('builtinDefaultColor / applyBuiltinOverride：默认色与覆盖合并', () => {
  assert.equal(builtinDefaultColor('active'), '#22c55e')
  assert.equal(builtinDefaultColor('done'), '#3b82f6')
  assert.equal(builtinDefaultColor('paused'), '#9ca3af')
  assert.equal(builtinDefaultColor('nope'), undefined)
  const base = { key: 'active', name: '进行中', color: '#22c55e', builtin: true }
  assert.equal(applyBuiltinOverride(base, null), base)          // 无覆盖 → 原引用
  assert.equal(applyBuiltinOverride(base, { color: '' }), base) // 空串不生效
  const overridden = applyBuiltinOverride(base, { color: '#ff00ff' })
  assert.deepEqual(overridden, { key: 'active', name: '进行中', color: '#ff00ff', builtin: true })
  assert.equal(base.color, '#22c55e')                           // 原对象不变
})

test('setOverride / clearOverride：不可变、覆盖合并、清空返回 undefined（不写）', () => {
  assert.deepEqual(setOverride(undefined, 'active', { color: '#ff00ff' }), { active: { color: '#ff00ff' } })
  assert.deepEqual(setOverride({ active: { color: '#111111' } }, 'active', { color: '#ff00ff' }),
    { active: { color: '#ff00ff' } })
  const two = setOverride({ active: { color: '#ff00ff' } }, 'done', { color: '#00ff00' })
  assert.deepEqual(two, { active: { color: '#ff00ff' }, done: { color: '#00ff00' } })
  assert.deepEqual(clearOverride(two, 'active'), { done: { color: '#00ff00' } })
  assert.equal(clearOverride({ done: { color: '#00ff00' } }, 'done'), undefined)  // 清空 → 不写
  assert.equal(clearOverride(undefined, 'active'), undefined)
  assert.deepEqual(clearOverride({ done: { color: '#00ff00' } }, 'active'), { done: { color: '#00ff00' } })
})

test('resolveLabels：非法条目（缺字段/空名）被跳过', () => {
  const labels = resolveLabels({
    labels: [
      null,
      { key: 'a', name: '', color: '#ef4444' },
      { key: 'b', name: '好', color: '' },
      { name: '无key', color: '#ef4444' },
      { key: 'c', name: '合法', color: '#ef4444' },
    ],
  })
  assert.equal(labels.length, 4)
  assert.equal(labels[3].key, 'c')
})

test('findLabel：命中返回、未命中 undefined', () => {
  const labels = resolveLabels({ labels: [{ key: 'custom', name: '自定义', color: '#ef4444' }] })
  assert.equal(findLabel(labels, 'custom').name, '自定义')
  assert.equal(findLabel(labels, 'nope'), undefined)
  assert.equal(findLabel(undefined, 'x'), undefined)
})

test('labelIconKey：内置三态象征 icon，自定义统一标签形', () => {
  assert.equal(labelIconKey('active'), 'bolt')
  assert.equal(labelIconKey('done'), 'check')
  assert.equal(labelIconKey('paused'), 'pause')
  assert.equal(labelIconKey('todo'), 'tag')
  assert.equal(labelIconKey('whatever'), 'tag')
  assert.equal(labelIconKey(undefined), 'tag')
  assert.equal(labelIconKey(''), 'tag')
})

test('resolveLabelIcon：内置固定语义，自定义按 icon 字段，无效/缺省回退 tag', () => {
  assert.equal(resolveLabelIcon({ key: 'active' }), 'bolt')
  assert.equal(resolveLabelIcon({ key: 'done', icon: 'star' }), 'check')   // 内置不受 icon 字段影响
  assert.equal(resolveLabelIcon({ key: 'paused' }), 'pause')
  assert.equal(resolveLabelIcon({ key: 'custom', icon: 'star' }), 'star')
  assert.equal(resolveLabelIcon({ key: 'custom', icon: 'rocket' }), 'rocket')
  assert.equal(resolveLabelIcon({ key: 'custom' }), 'tag')                 // 旧数据无 icon 字段
  assert.equal(resolveLabelIcon({ key: 'custom', icon: 'nope' }), 'tag')   // 无效 icon 回退
  assert.equal(resolveLabelIcon(null), 'tag')
  assert.equal(resolveLabelIcon({}), 'tag')
  assert.equal(resolveLabelIcon(undefined), 'tag')
})

test('LABEL_ICONS：含默认 tag 与内置三态映射值，无重复', () => {
  assert.ok(LABEL_ICONS.includes('tag'))
  for (const icon of ['bolt', 'check', 'pause']) assert.ok(LABEL_ICONS.includes(icon))
  assert.equal(new Set(LABEL_ICONS).size, LABEL_ICONS.length)
  assert.ok(LABEL_ICONS.length >= 10)  // 自定义有足够可选集
})

test('nextSessionStatus：无状态→active→done→paused→无状态(null)，未知 key 回退 active', () => {
  assert.equal(nextSessionStatus(undefined), 'active')
  assert.equal(nextSessionStatus(''), 'active')
  assert.equal(nextSessionStatus('active'), 'done')
  assert.equal(nextSessionStatus('done'), 'paused')
  assert.equal(nextSessionStatus('paused'), null)
  assert.equal(nextSessionStatus('weird'), 'active')
})

test('assignStatus / clearStatus：不可变、设置与清除', () => {
  const sessions = { a: 'active' }
  const next = assignStatus(sessions, 'b', 'done')
  assert.deepEqual(next, { a: 'active', b: 'done' })
  assert.deepEqual(sessions, { a: 'active' })          // 原对象不变
  assert.deepEqual(assignStatus(next, 'a', null), { b: 'done' })
  assert.deepEqual(assignStatus(next, 'b', ''), { a: 'active' })
  assert.deepEqual(clearStatus({ a: 'active' }, 'a'), {})
  assert.deepEqual(assignStatus(undefined, 'x', 'paused'), { x: 'paused' })
})

test('pruneSessions：清理失效会话；无失效返回 undefined（不写）', () => {
  const sessions = { a: 'active', b: 'done', c: 'paused' }
  const live = new Set(['a', 'c'])
  const pruned = pruneSessions(sessions, live)
  assert.deepEqual(pruned, { a: 'active', c: 'paused' })
  assert.equal(pruneSessions(sessions, new Set(['a', 'b', 'c'])), undefined)
  assert.equal(pruneSessions(undefined, live), undefined)
  assert.equal(pruneSessions(null, live), undefined)
})

test('validateLabelInput：名称/key/重复/颜色/上限校验', () => {
  const base = resolveLabels({})
  assert.equal(validateLabelInput({ key: 'todo', name: '待办', color: '#ef4444' }, base), null)
  assert.ok(validateLabelInput({ key: 'todo', name: '', color: '#ef4444' }, base))
  assert.ok(validateLabelInput({ key: 'Bad_Key', name: 'x', color: '#ef4444' }, base))
  assert.ok(validateLabelInput({ key: '1abc', name: 'x', color: '#ef4444' }, base))
  assert.ok(validateLabelInput({ key: 'active', name: 'x', color: '#ef4444' }, base))   // 内置 key
  assert.ok(validateLabelInput({ key: 'dup', name: 'x', color: '#ef4444' }, resolveLabels({ labels: [{ key: 'dup', name: 'y', color: '#f59e0b' }] })))
  assert.equal(validateLabelInput({ key: 'todo', name: 'x', color: '#123456' }, base), null)   // 任意 hex 合法
  assert.equal(validateLabelInput({ key: 'todo', name: 'x', color: '#AbC' }, base), null)      // #RGB 简写合法
  assert.ok(validateLabelInput({ key: 'todo', name: 'x', color: '#12345' }, base))             // 位数不足非法
  assert.ok(validateLabelInput({ key: 'todo', name: 'x', color: 'red' }, base))                // 非 hex 非法
  assert.ok(validateLabelInput({ key: 'todo', name: 'x', color: '' }, base))
  const many = resolveLabels({ labels: Array.from({ length: MAX_CUSTOM_LABELS }, (_, i) => ({ key: `c${i}`, name: `C${i}`, color: PALETTE[i % PALETTE.length] })) })
  assert.ok(validateLabelInput({ key: 'overflow', name: 'x', color: '#ef4444' }, many))
})

test('normalizeHex：#RRGGBB 规范化、#RGB 简写展开、非法返回 null', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc')
  assert.equal(normalizeHex(' #A1B2C3 '), '#a1b2c3')
  assert.equal(normalizeHex('#abcdef'), '#abcdef')
  assert.equal(normalizeHex('#12345'), null)
  assert.equal(normalizeHex('red'), null)
  assert.equal(normalizeHex(''), null)
  assert.equal(normalizeHex(undefined), null)
  assert.equal(normalizeHex(null), null)
})

test('generateLabelKey：规范化、唯一性、非法首字符加前缀', () => {
  const keys = new Set(['todo'])
  assert.equal(generateLabelKey('待办事项', keys), 'label-custom')
  assert.match(generateLabelKey('待办事项', keys), /^label-/)
  assert.equal(generateLabelKey('My Task', keys), 'my-task')
  assert.equal(generateLabelKey('todo', keys), 'todo-2')
  assert.equal(generateLabelKey('todo', new Set(['todo', 'todo-2'])), 'todo-3')
  assert.equal(generateLabelKey('', keys), 'label-custom')
})

test('nextPaletteColor：优先未用色，用尽回退第一个', () => {
  assert.equal(nextPaletteColor([]), PALETTE[0])
  const usedOne = resolveLabels({ labels: [{ key: 'a', name: 'A', color: PALETTE[0] }] })
  assert.equal(nextPaletteColor(usedOne), PALETTE[1])
  const allUsed = PALETTE.map((color, i) => ({ key: `k${i}`, name: `K${i}`, color }))
  assert.equal(nextPaletteColor(allUsed), PALETTE[0])
})

console.log('status-store OK: all', Object.keys({
  resolveLabels, findLabel, labelIconKey, resolveLabelIcon, nextSessionStatus, assignStatus, clearStatus,
  pruneSessions, validateLabelInput, generateLabelKey, nextPaletteColor,
}).length, 'cases passed')
