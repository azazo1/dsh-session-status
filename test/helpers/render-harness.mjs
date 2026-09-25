import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { PRIMITIVES_MODULE, createPrimitivesStub } from './primitives-stub.mjs'

const code = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

/** 用真实 React DOM 挂载宿主形状的行和 portal, 独立加载插件的发布入口. */
export async function createHarness(initialStatuses = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const { window } = dom
  const { document } = window
  const previous = new Map()
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const { createPortal } = await import('react-dom')
  const root = createRoot(document.getElementById('root'))
  const frames = new Map()
  const intervals = new Set()
  let frameId = 0
  let bundle
  let statuses = initialStatuses
  let list = { phase: 'ready', ids: [], byId: {} }
  const scope = { status: 'ready', value: { labels: [] } }
  const scopeListeners = new Set()
  const listListeners = new Set()
  const disposers = []
  const requests = []
  const rowClicks = []
  const scopeWrites = []
  // 写入结果由 host 决定: 测试可翻转它来模拟宿主拒绝 (例如宿主还没重启).
  let writeOk = true
  const subscribe = listeners => callback => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  /** 假 host: 记录每次请求, 并按 storage domain 的语义改写状态映射. */
  function fetchStub(path, options) {
    const method = (options && options.method) || 'GET'
    const body = options && options.body ? JSON.parse(options.body) : null
    requests.push({ path, method, body })
    const respond = payload => Promise.resolve({ ok: true, status: 200, json: async () => payload })
    if (method === 'POST' && path.endsWith('/prune')) {
      const live = new Set(body.liveIds)
      let removed = 0
      for (const id of Object.keys(statuses)) {
        if (!live.has(id)) {
          delete statuses[id]
          removed += 1
        }
      }
      return respond({ statuses: { ...statuses }, removed })
    }
    if (method === 'POST' && path.endsWith('/status')) {
      if (body.labelKey === null) delete statuses[body.sessionId]
      else statuses[body.sessionId] = body.labelKey
      return respond({ statuses: { ...statuses } })
    }
    return respond({ statuses: { ...statuses } })
  }
  window.__ModuleLoader__ = { load({ factory }) { bundle = factory(name => {
    if (name === 'react') return React
    if (name === PRIMITIVES_MODULE) return createPrimitivesStub(React)
    throw new Error(`未知依赖: ${name}`)
  }) } }
  vm.runInNewContext(code, {
    window, document, console,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    setInterval(callback) { intervals.add(callback); return callback },
    clearInterval(callback) { intervals.delete(callback) },
    fetch: fetchStub,
  })
  let headerRenderer = null
  let settingsRenderer = null
  const scopeApi = {
    getSnapshot: () => scope,
    subscribe: subscribe(scopeListeners),
    set(key, value) { scopeWrites.push([key, value]); return Promise.resolve(writeOk) },
    unset(key) { scopeWrites.push([key, 'UNSET']); return Promise.resolve(writeOk) },
  }
  bundle.apply({
    configForms: {
      get: () => scopeApi,
      whileServed: (_ids, fn) => fn(),
    },
    sessions: { list: { getSnapshot: () => list, subscribe: subscribe(listListeners) } },
    slots: {
      inject(name, fn) {
        const registration = fn()
        if (name === 'conversation.session.header.utilities') headerRenderer = registration.renderer
        if (name === 'plugins.bundle.config') settingsRenderer = registration.renderer
        return () => {}
      },
      register(options, renderer) { return { options, renderer } },
    },
    effect(factory) { disposers.push(factory()) },
  })

  function HoverCard({ anchor, content, open, id, copied }) {
    return React.createElement('span', null, anchor, open && createPortal(
      React.createElement('div', { role: 'button', style: { left: 10, top: 20 }, 'data-card': id },
        copied ? React.createElement('span', null, 'copied') : content), document.body))
  }

  function SessionNodeItem({ node, hover, copied }) {
    const anchor = React.createElement('div', { role: 'treeitem', 'aria-selected': false, 'data-row': node.id,
      onClick: () => { rowClicks.push(node.id) } },
      React.createElement('span', { className: 'slot' }),
      React.createElement('span', null, node.displayTitle),
      React.createElement('span', null, '7d'))
    return React.createElement(HoverCard, { anchor, open: hover, id: node.id, copied,
      content: React.createElement('div', null,
        React.createElement('div', null, node.displayTitle),
        React.createElement('div', null, 'idle')),
    })
  }

  function SearchResultItem({ result }) {
    return React.createElement('button', { role: 'treeitem', 'aria-selected': false, 'data-row': result.id,
      onClick: () => { rowClicks.push(result.id) } },
      React.createElement('span', null,
        React.createElement('span', { className: 'slot' }),
        React.createElement('span', null, result.displayTitle)),
      React.createElement('span', null, 'workspace'))
  }

  async function flush() {
    for (let round = 0; round < 10; round++) {
      await act(async () => {
        await setImmediate()
        const pending = [...frames.values()]
        frames.clear()
        for (const callback of pending) callback()
        await setImmediate()
      })
      if (frames.size === 0) return
    }
    throw new Error('DOM 更新未收敛, 可能存在观察器自触发循环')
  }

  return {
    document, window, requests, rowClicks, scope, scopeWrites,
    /** 翻转 settings 写入的结果, 用来模拟宿主拒绝 (例如宿主还没重启). */
    setWriteOk(ok) { writeOk = ok === true },
    /** 派发一次会冒泡的真实点击, 用来验证行点击是否被插件节点阻断. */
    click(element) {
      element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    /** 同上, 但包在 act 里: 点击会触发 React state (例如开合 pill 的下拉). */
    async clickAct(element) {
      await act(async () => {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      await flush()
    },
    keydown(element, key) {
      element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    },
    /** 返回 dispatchEvent 的结果: false 表示插件压掉了浏览器右键菜单. */
    contextmenu(element) {
      return element.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    },
    /** 某条路由上最后一次请求 (没有则返回 null). */
    lastRequest(suffix) {
      for (let i = requests.length - 1; i >= 0; i -= 1) {
        if (requests[i].path.endsWith(suffix)) return requests[i]
      }
      return null
    },
    async render(nodes, { hover = false, copied = false, search = false, pill = null, settings = false, known = nodes } = {}) {
      list = { phase: 'ready', ids: known.map(node => node.id), byId: Object.fromEntries(known.map(node => [node.id, node])) }
      await act(async () => {
        root.render(React.createElement('div', null,
          React.createElement('div', { role: 'tree' }, nodes.map(node => React.createElement(
            search ? SearchResultItem : SessionNodeItem,
            search ? { key: node.id, result: node } : { key: node.id, node, hover, copied },
          ))),
          // pill 与设置卡片都走真实的槽注册函数, 与宿主里那条路径一致.
          pill === null ? null : React.createElement('div', { 'data-header-utilities': '' },
            React.createElement(headerRenderer, { sessionId: pill })),
          settings ? React.createElement('div', { 'data-plugin-config': '' },
            React.createElement(settingsRenderer, { view: 'page' })) : null))
      })
      for (const listener of listListeners) listener()
      await flush()
    },
    async statuses(next) {
      statuses = next
      for (const callback of intervals) callback()
      await flush()
    },
    async notify() {
      for (const listener of scopeListeners) listener()
      for (const listener of listListeners) listener()
      await flush()
    },
    async unready() {
      list = { ...list, phase: 'pending' }
      for (const listener of listListeners) listener()
      await flush()
    },
    flush,
    disposePlugin() {
      for (const dispose of disposers.splice(0)) dispose()
    },
    async close() {
      this.disposePlugin()
      await act(async () => root.unmount())
      window.close()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}
