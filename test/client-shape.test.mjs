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

/**
 * 假的 host 路由: 在内存里维护状态映射, 记录每次请求, 供用例断言。
 * client 只依赖 fetch 的 { ok, status, json() } 接口。
 * @param initial - 初始 会话 -> 标签 key 映射。
 */
function createHostStub(initial = {}) {
  const state = { statuses: { ...initial }, requests: [] }
  const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  function fetchStub(path, options) {
    const method = (options && options.method) || 'GET'
    const body = options && options.body ? JSON.parse(options.body) : null
    state.requests.push({ path, method, body })
    if (method === 'POST' && path.endsWith('/prune')) {
      const live = new Set(body.liveIds)
      let removed = 0
      for (const id of Object.keys(state.statuses)) {
        if (!live.has(id)) {
          delete state.statuses[id]
          removed += 1
        }
      }
      return respond({ statuses: { ...state.statuses }, removed })
    }
    if (method === 'POST' && path.endsWith('/status')) {
      if (body.labelKey === null) delete state.statuses[body.sessionId]
      else state.statuses[body.sessionId] = body.labelKey
      return respond({ statuses: { ...state.statuses } })
    }
    return respond({ statuses: { ...state.statuses } })
  }
  return { state, fetch: fetchStub }
}

/** 等一轮宏任务, 让 apply() 触发的首次拉取与写后回填落地。 */
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** 取某条路由上最后一次请求 (没有则返回 null)。 */
function lastRequest(host, suffix) {
  for (let i = host.state.requests.length - 1; i >= 0; i -= 1) {
    if (host.state.requests[i].path.endsWith(suffix)) return host.state.requests[i]
  }
  return null
}

/** sandbox 里 window/document 都需要的事件与定时器接口。 */
function domGlobals() {
  return {
    addEventListener() {},
    removeEventListener() {},
  }
}

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
  for (const required of ['slots', 'configForms', 'sessions']) {
    assert.ok(inject.includes(required), `inject must include "${required}"`)
  }
  assert.equal(typeof apply, 'function', 'apply must be a function')
  assert.ok(__statusUtils && typeof __statusUtils === 'object', '__statusUtils must be exported')
  console.log('client-shape OK: inject =', JSON.stringify(inject))
})

test('bundle 内联纯逻辑与 status-store 行为一致（漂移护栏）', () => {
  const u = captured.__statusUtils
  // VM 上下文创建的对象原型与宿主不同，deepStrictEqual 会误报，统一 JSON 规范化比较。
  const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

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

  // assignStatus 一致（浏览器侧乐观更新）
  const sessions = { a: 'active', b: 'done' }
  assert.deepEqual(json(u.assignStatus(sessions, 'c', 'paused')), json(store.assignStatus(sessions, 'c', 'paused')))
  assert.deepEqual(json(u.assignStatus(sessions, 'a', null)), json(store.assignStatus(sessions, 'a', null)))

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

  // overrides：resolveLabels 应用内置颜色覆盖，builtinDefaultColor / setOverride / clearOverride 一致
  const overrideSamples = [
    { labels: [], overrides: { active: { color: '#ff00ff' } } },
    { labels: [], overrides: { active: { color: '' }, done: { color: '#00ff00' } } },
    { labels: [{ key: 'c', name: 'C', color: '#ef4444' }], overrides: { paused: { color: '#abcdef' } } },
    undefined, [], { labels: [] },
  ]
  for (const sample of overrideSamples) {
    assert.deepEqual(json(u.resolveLabels(sample)), json(store.resolveLabels(sample)), `resolveLabels(overrides ${JSON.stringify(sample)})`)
  }
  for (const key of ['active', 'done', 'paused', 'nope']) {
    assert.equal(u.builtinDefaultColor(key), store.builtinDefaultColor(key), `builtinDefaultColor(${key})`)
  }
  const overrideOps = [
    [undefined, 'active', { color: '#ff00ff' }],
    [{ active: { color: '#111111' } }, 'active', { color: '#ff00ff' }],
    [{ active: { color: '#ff00ff' } }, 'done', { color: '#00ff00' }],
    [{ done: { color: '#00ff00' } }, 'done', { color: '#000000' }],
  ]
  for (const [ov, key, patch] of overrideOps) {
    assert.deepEqual(json(u.setOverride(ov, key, patch)), json(store.setOverride(ov, key, patch)), `setOverride(${key})`)
  }
  const clearOps = [
    [{ active: { color: '#ff00ff' }, done: { color: '#00ff00' } }, 'active'],
    [{ done: { color: '#00ff00' } }, 'done'],
    [undefined, 'active'],
    [{ done: { color: '#00ff00' } }, 'nope'],
  ]
  for (const [ov, key] of clearOps) {
    assert.deepEqual(json(u.clearOverride(ov, key)), json(store.clearOverride(ov, key)), `clearOverride(${key}) value`)
  }

  // normalizeHex 一致（#RGB 简写展开 / 大小写 / 非法回退）
  const hexSamples = ['#ABC', '#abc', ' #A1B2C3 ', '#abcdef', '#12345', 'red', '', undefined, null]
  for (const sample of hexSamples) {
    assert.equal(u.normalizeHex(sample), store.normalizeHex(sample), `normalizeHex(${String(sample)})`)
  }

  console.log('client-shape drift-guard OK')
})

test('StatusPill 的 pill 单击接入循环（nextSessionStatus 接线，非死代码）', async () => {
  // react hooks mock：渲染不触发副作用，点击行为通过重新渲染读取最新快照。
  const reactMock = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(init) { return [init, () => {}] },
    useReducer(reducer, init) { return [init, () => {}] },
    useRef(init) { return { current: init } },
    useEffect() {},
  }

  const host = createHostStub({ s1: 'active' })
  let captured2 = null
  const sandbox2 = {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          captured2 = factory((name) => (name === 'react' ? reactMock : {}))
        },
      },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      readyState: 'complete',
      body: {},
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll() { return [] },
      createElement() { return { setAttribute() {}, style: {} } },
    },
    MutationObserver: function () { return { observe() {}, disconnect() {} } },
    requestAnimationFrame() { return 1 },
    cancelAnimationFrame() {},
    setInterval() { return 1 },
    clearInterval() {},
    fetch: host.fetch,
  }
  vm.createContext(sandbox2)
  vm.runInContext(code, sandbox2)

  let headerRenderer = null
  const scopeSnapshot = { status: 'ready', value: { labels: [] } }
  const scopeCalls = []
  const scopeMock = {
    bind() { return scopeMock },
    subscribe() { return () => {} },
    getSnapshot() { return scopeSnapshot },
    set(key, value) { scopeCalls.push([key, value]) },
    unset(key) { scopeCalls.push([key, 'UNSET']) },
  }
  const ctx = {
    configForms: { get() { return scopeMock } },
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
  await tick()

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

  const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

  // 首次拉取把 host 快照灌进本地镜像
  assert.equal(host.state.requests[0].path.endsWith('/statuses'), true, '首次拉取必须走 /statuses')

  // active -> done -> paused -> 无状态（labelKey null）
  clickPill()
  assert.deepEqual(json(lastRequest(host, '/status').body), json({ sessionId: 's1', labelKey: 'done' }))
  await tick()
  clickPill()
  assert.deepEqual(json(lastRequest(host, '/status').body), json({ sessionId: 's1', labelKey: 'paused' }))
  await tick()
  clickPill()
  assert.deepEqual(json(lastRequest(host, '/status').body), json({ sessionId: 's1', labelKey: null }))
  await tick()

  // 自定义标签不参与循环，直接回到 active
  host.state.statuses.s1 = 'todo'
  clickPill()
  assert.deepEqual(json(lastRequest(host, '/status').body), json({ sessionId: 's1', labelKey: 'active' }))
  await tick()

  // 写完后会带当前会话列表去 host 做惰性清理
  const prune = lastRequest(host, '/prune')
  assert.ok(prune, '写完状态后应触发一次 prune')
  assert.deepEqual(json(prune.body), json({ liveIds: ['s1'] }))

  // 下拉箭头单独负责开合菜单：其 onClick 不写 settings、也不发请求
  scopeCalls.length = 0
  const requestsBefore = host.state.requests.length
  const tree = renderPillTree()
  const caret = tree.children[1]
  assert.equal(caret.type, 'button')
  caret.props.onClick({ stopPropagation() {} })
  assert.equal(scopeCalls.length, 0, 'caret click must not write settings')
  assert.equal(host.state.requests.length, requestsBefore, 'caret click must not call the host')

  console.log('client-shape pill-cycle wiring OK')
})

test('设置页内置标签改色接线（swatch 写 overrides、恢复默认清除）', () => {
  const reactMock = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(init) { return [init, () => {}] },
    useReducer(reducer, init) { return [init, () => {}] },
    useRef(init) { return { current: init } },
    useEffect() {},
  }

  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ factory }) { captured = factory((name) => (name === 'react' ? reactMock : {})) },
      },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      readyState: 'complete',
      body: {},
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll() { return [] },
      createElement() { return { setAttribute() {}, style: {} } },
    },
    MutationObserver: function () { return { observe() {}, disconnect() {} } },
    requestAnimationFrame() { return 1 },
    cancelAnimationFrame() {},
    setInterval() { return 1 },
    clearInterval() {},
    fetch: createHostStub().fetch,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)

  let settingsRenderer = null
  const scopeCalls = []
  const scopeSnapshot = { status: 'ready', value: { labels: [] } }
  const scopeMock = {
    bind() { return scopeMock },
    subscribe() { return () => {} },
    getSnapshot() { return scopeSnapshot },
    set(key, value) { scopeCalls.push([key, value]) },
    unset(key) { scopeCalls.push([key, 'UNSET']) },
  }
  const ctx = {
    configForms: {
      get() { return scopeMock },
      whileServed(_ids, fn) { return fn() },
    },
    sessions: { list: { subscribe() { return () => {} }, getSnapshot() { return { phase: 'ready', ids: [], byId: {} } } } },
    slots: {
      inject(name, fn) {
        const reg = fn()
        if (name === 'plugins.bundle.config') {
          assert.equal(reg.opts.key, 'dsh-session-status', 'config card key must be the package name')
          settingsRenderer = reg.renderer
        }
      },
      register(opts, renderer) { return { opts, renderer } },
    },
    effect(cb) { return cb ? cb() : undefined },
  }
  captured.apply(ctx)
  assert.ok(typeof settingsRenderer === 'function', 'plugins.bundle.config renderer must be registered')

  const renderElement = (el) => {
    if (el === null || el === undefined || typeof el !== 'object') return el
    if (Array.isArray(el)) return el.map(renderElement)
    if (typeof el.type === 'function') return renderElement(el.type(el.props))
    return { type: el.type, props: el.props, children: (el.children || []).map(renderElement) }
  }
  const tree = renderElement(settingsRenderer({}))
  const walk = (node, pred, out = []) => {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) {
      for (const item of node) walk(item, pred, out)
      return out
    }
    if (typeof node !== 'object') return out
    if (pred(node)) out.push(node)
    for (const child of (Array.isArray(node.children) ? node.children : [])) walk(child, pred, out)
    return out
  }
  const buttons = walk(tree, n => n.type === 'button')

  // 内置行应有 8 色 swatch（第一个 #ef4444 属于「进行中」内置行）
  const firstSwatch = buttons.find(b => b.props.title === '#ef4444')
  assert.ok(firstSwatch, '内置行应有色板 swatch')
  firstSwatch.props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(scopeCalls.pop())), ['overrides', { active: { color: '#ef4444' } }])

  // 覆盖后出现「恢复默认」；点击后清空覆盖（unset）
  scopeSnapshot.value.overrides = { active: { color: '#ef4444' } }
  const tree2 = renderElement(settingsRenderer({}))
  const buttons2 = walk(tree2, n => n.type === 'button')
  const reset = buttons2.find(b => b.children === '恢复默认' || (Array.isArray(b.children) && b.children[0] === '恢复默认'))
  assert.ok(reset, '覆盖后应出现「恢复默认」')
  reset.props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(scopeCalls.pop())), ['overrides', 'UNSET'])

  // 自定义行应有任意 hex 颜色输入（value 为标签当前色）
  scopeSnapshot.value = {
    labels: [{ key: 'c1', name: '自定义', color: '#123456', icon: 'tag', builtin: false }],
    overrides: {},
  }
  const tree3 = renderElement(settingsRenderer({}))
  const inputs = walk(tree3, n => n.type === 'input')
  const hexInputs = inputs.filter(i => i.props.title === '任意颜色 #RRGGBB（或 #RGB 简写）')
  assert.ok(hexInputs.length >= 1, '自定义行应有 hex 颜色输入')
  assert.equal(hexInputs[0].props.value, '#123456')
  // 新增表单也应有 hex 输入
  assert.ok(hexInputs.length >= 2, '新增表单与自定义行都应有 hex 输入')

  console.log('client-shape builtin-override wiring OK')
})
