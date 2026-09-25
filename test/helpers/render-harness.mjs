import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

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
  const subscribe = listeners => callback => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }
  window.__ModuleLoader__ = { load({ factory }) { bundle = factory(name => {
    if (name !== 'react') throw new Error(`未知依赖: ${name}`)
    return React
  }) } }
  vm.runInNewContext(code, {
    window, document, console,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    setInterval(callback) { intervals.add(callback); return callback },
    clearInterval(callback) { intervals.delete(callback) },
    fetch: async () => ({ ok: true, json: async () => ({ statuses: { ...statuses } }) }),
  })
  bundle.apply({
    configForms: {
      get: () => ({ getSnapshot: () => scope, subscribe: subscribe(scopeListeners) }),
      whileServed: (_ids, fn) => fn(),
    },
    sessions: { list: { getSnapshot: () => list, subscribe: subscribe(listListeners) } },
    slots: { inject() { return () => {} } },
    effect(factory) { disposers.push(factory()) },
  })

  function HoverCard({ anchor, content, open, id, copied }) {
    return React.createElement('span', null, anchor, open && createPortal(
      React.createElement('div', { role: 'button', style: { left: 10, top: 20 }, 'data-card': id },
        copied ? React.createElement('span', null, 'copied') : content), document.body))
  }

  function SessionNodeItem({ node, hover, copied }) {
    const anchor = React.createElement('div', { role: 'treeitem', 'aria-selected': false, 'data-row': node.id },
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
    return React.createElement('button', { role: 'treeitem', 'aria-selected': false, 'data-row': result.id },
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
    document, window,
    async render(nodes, { hover = false, copied = false, search = false, known = nodes } = {}) {
      list = { phase: 'ready', ids: known.map(node => node.id), byId: Object.fromEntries(known.map(node => [node.id, node])) }
      await act(async () => {
        root.render(React.createElement('div', { role: 'tree' }, nodes.map(node => React.createElement(
          search ? SearchResultItem : SessionNodeItem,
          search ? { key: node.id, result: node } : { key: node.id, node, hover, copied },
        ))))
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
