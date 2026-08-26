/**
 * 契约回归测试：
 *  1. 客户端 bundle 的 exports.inject 必须是 Cordis 服务名数组，不能是 NPM 包名
 *     （写错会导致 web boot 永久 pending，dsh-factory 血泪教训）。
 *  2. bundle 内联的纯逻辑（__statusUtils）与 lib/status-store.js 行为一致（防漂移）。
 * 主模块方式运行：node test/client-shape.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as store from '../lib/status-store.js'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ factory }) {
        captured = factory((name) => ({ name }))
      },
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)

test('bundle factory 执行并导出契约形状', () => {
  assert.ok(captured !== null, 'bundle factory did not run')
  const { inject, apply, __statusUtils } = captured
  assert.ok(Array.isArray(inject), 'inject must be an array')
  for (const s of inject) {
    assert.ok(typeof s === 'string' && s.length > 0, `inject entry must be a non-empty string: ${String(s)}`)
    if (s.startsWith('@')) {
      throw new Error(`inject "${s}" looks like a package name; must be a service name`)
    }
  }
  for (const required of ['slots', 'settingsScope', 'sessions']) {
    assert.ok(inject.includes(required), `inject must include "${required}"`)
  }
  assert.equal(typeof apply, 'function', 'apply must be a function')
  assert.ok(__statusUtils && typeof __statusUtils === 'object', '__statusUtils must be exported')
  console.log('client-shape OK: inject =', JSON.stringify(inject))
})

test('bundle 内联纯逻辑与 status-store 行为一致（漂移护栏）', () => {
  const u = captured.__statusUtils
  // VM 上下文创建的对象原型与宿主不同，deepStrictEqual 会误报，统一 JSON 规范化比较。
  const json = (value) => JSON.parse(JSON.stringify(value))

  // resolveLabels
  assert.deepEqual(json(u.resolveLabels({ labels: [] }).map(l => l.key)), json(store.resolveLabels({ labels: [] }).map(l => l.key)))
  assert.equal(u.resolveLabels(undefined).length, 3)
  const mixed = {
    labels: [
      { key: 'active', name: '覆盖', color: '#000' },
      { key: 'c1', name: '自定义', color: '#ef4444' },
      { key: 'c1', name: '重复', color: '#f59e0b' },
    ],
  }
  assert.deepEqual(json(u.resolveLabels(mixed)), json(store.resolveLabels(mixed)))

  // nextSessionStatus 循环一致
  const cycleInputs = [undefined, '', 'active', 'done', 'paused', 'weird', null]
  for (const input of cycleInputs) {
    assert.equal(u.nextSessionStatus(input), store.nextSessionStatus(input), `nextSessionStatus(${String(input)})`)
  }

  // assignStatus / clearStatus / pruneSessions 一致
  const sessions = { a: 'active', b: 'done' }
  assert.deepEqual(json(u.assignStatus(sessions, 'c', 'paused')), json(store.assignStatus(sessions, 'c', 'paused')))
  assert.deepEqual(json(u.assignStatus(sessions, 'a', null)), json(store.assignStatus(sessions, 'a', null)))
  assert.deepEqual(json(u.pruneSessions({ a: 'active', b: 'done' }, new Set(['b']))),
    json(store.pruneSessions({ a: 'active', b: 'done' }, new Set(['b']))))
  assert.equal(u.pruneSessions({ a: 'active' }, new Set(['a'])), undefined)

  // labelIconKey 一致（内置象征 icon 映射）
  for (const key of ['active', 'done', 'paused', 'todo', 'whatever', undefined, '']) {
    assert.equal(u.labelIconKey(key), store.labelIconKey(key), `labelIconKey(${String(key)})`)
  }

  // resolveLabelIcon 一致（自定义标签 icon 解析）
  const labelSamples = [
    { key: 'active' }, { key: 'done', icon: 'star' }, { key: 'paused' },
    { key: 'custom', icon: 'star' }, { key: 'custom', icon: 'rocket' },
    { key: 'custom' }, { key: 'custom', icon: 'nope' }, null, {}, undefined,
  ]
  for (const sample of labelSamples) {
    assert.equal(u.resolveLabelIcon(sample), store.resolveLabelIcon(sample), `resolveLabelIcon(${JSON.stringify(sample)})`)
  }
  // LABEL_ICONS 集合一致
  assert.deepEqual(json(u.LABEL_ICONS), json(store.LABEL_ICONS))

  // generateLabelKey / nextPaletteColor 一致
  const keys = new Set(['todo'])
  assert.equal(u.generateLabelKey('My Task', keys), store.generateLabelKey('My Task', keys))
  assert.equal(u.generateLabelKey('todo', new Set(['todo', 'todo-2'])), store.generateLabelKey('todo', new Set(['todo', 'todo-2'])))
  assert.equal(u.nextPaletteColor([{ key: 'x', name: 'X', color: store.PALETTE[0] }]),
    store.nextPaletteColor([{ key: 'x', name: 'X', color: store.PALETTE[0] }]))

  console.log('client-shape drift-guard OK')
})

test('StatusPill 的 pill 单击接入循环（nextSessionStatus 接线，非死代码）', () => {
  // react hooks mock：渲染不触发副作用，点击行为通过重新渲染读取最新 snapshot。
  const reactMock = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(init) { return [init, () => {}] },
    useReducer(reducer, init) { return [init, () => {}] },
    useRef(init) { return { current: init } },
    useEffect() {},
  }

  let captured2 = null
  const sandbox2 = {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          captured2 = factory((name) => (name === 'react' ? reactMock : {}))
        },
      },
    },
    document: {
      readyState: 'complete',
      body: {},
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll() { return [] },
      createElement() { return { setAttribute() {}, style: {} } },
    },
    MutationObserver: function () { return { observe() {}, disconnect() {} } },
    requestAnimationFrame() { return 1 },
    cancelAnimationFrame() {},
  }
  vm.createContext(sandbox2)
  vm.runInContext(code, sandbox2)

  let headerRenderer = null
  let scopeSnapshot = { status: 'ready', value: { sessions: { s1: 'active' } } }
  const scopeCalls = []
  const scopeMock = {
    bind() { return scopeMock },
    subscribe() { return () => {} },
    getSnapshot() { return scopeSnapshot },
    set(key, value) { scopeCalls.push([key, value]) },
    unset(key) { scopeCalls.push([key, 'UNSET']) },
  }
  const ctx = {
    settingsScope: { bind() { return scopeMock } },
    sessions: { list: { subscribe() { return () => {} }, getSnapshot() { return { phase: 'ready', ids: ['s1'] } } } },
    slots: {
      inject(name, fn) {
        const reg = fn()
        if (name === 'conversation.session.header.utilities') headerRenderer = reg.renderer
      },
      register(opts, renderer) { return { opts, renderer } },
    },
    effect() {},
  }
  captured2.apply(ctx)
  assert.ok(typeof headerRenderer === 'function', 'header slot renderer must be registered')

  // renderer 返回的是 <StatusPill/> 组件元素，需递归渲染成宿主元素树。
  const renderElement = (el) => {
    if (typeof el.type === 'function') return renderElement(el.type(el.props))
    return { type: el.type, props: el.props, children: (el.children || []).map(renderElement) }
  }
  const renderPillTree = () => renderElement(headerRenderer({ sessionId: 's1' }))

  const clickPill = () => {
    const tree = renderPillTree()
    const pill = tree.children[0]
    assert.equal(pill.type, 'button')
    pill.props.onClick({ stopPropagation() {} })
  }

  const json = (value) => JSON.parse(JSON.stringify(value))

  // active -> done -> paused -> (无状态，unset)
  clickPill()
  assert.deepEqual(json(scopeCalls.pop()), json(['sessions', { s1: 'done' }]))
  scopeSnapshot.value.sessions = { s1: 'done' }
  clickPill()
  assert.deepEqual(json(scopeCalls.pop()), json(['sessions', { s1: 'paused' }]))
  scopeSnapshot.value.sessions = { s1: 'paused' }
  clickPill()
  assert.deepEqual(json(scopeCalls.pop()), json(['sessions', 'UNSET']))

  // 自定义标签不参与循环，直接回到 active
  scopeSnapshot.value.sessions = { s1: 'todo' }
  clickPill()
  assert.deepEqual(json(scopeCalls.pop()), json(['sessions', { s1: 'active' }]))

  // 下拉箭头单独负责开合菜单：其 onClick 不写 settings
  scopeCalls.length = 0
  const tree = renderPillTree()
  const caret = tree.children[1]
  assert.equal(caret.type, 'button')
  caret.props.onClick({ stopPropagation() {} })
  assert.equal(scopeCalls.length, 0, 'caret click must not write settings')

  console.log('client-shape pill-cycle wiring OK')
})
