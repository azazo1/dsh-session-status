/**
 * 冒烟回归脚本（CDP，headless Edge）：验证新增的两块 DOM 注入/设置 UI。
 * 1. hover 会话行 → hover 卡出现插件状态行 [data-owner-part="hover"]
 *    （与 DSH 原生「空闲/运行中」并列），data-session-id 与行点一致；
 *    无状态会话 hover 不注入。
 * 2. 设置 → 会话状态：内置三态行各带 8 色 swatch（可改色），
 *    自定义行带任意 hex 颜色输入。
 * 用法：node scripts/smoke-hover.mjs
 * 退出码：0 全部通过；1 任一失败（含 CDP/页面不可用）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9232
const TARGET = process.env.DSH_WEB_URL || 'http://127.0.0.1:3180'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}

/** 轻量断言：失败即抛错并退出码 1。 */
function check(cond, message) {
  if (!cond) throw new Error(`SMOKE FAIL: ${message}`)
  console.log(`  ✓ ${message}`)
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-smoke-hover-'))
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    TARGET,
  ], { stdio: 'ignore' })

  try {
    let version = null
    for (let i = 0; i < 40; i++) {
      try { version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sleep(500) }
    }
    check(version !== null, 'CDP endpoint ready')

    let page = null
    for (let i = 0; i < 20; i++) {
      const tabs = await fetchJson(`http://127.0.0.1:${PORT}/json`)
      page = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3180'))
      if (page) break
      await sleep(500)
    }
    check(page !== undefined, 'target page loaded')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let seq = 0
    const pending = new Map()
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      return r.result && r.result.result ? r.result.result.value : undefined
    }

    await sleep(10000)

    // ---------- 1. hover 卡状态注入 ----------
    const rows = await evalJs(`(() => {
      const dots = Array.from(document.querySelectorAll('[data-owner="dsh-session-status"][data-status-key]'))
      const byId = new Map(dots.map(d => [d.getAttribute('data-session-id'), d]))
      const list = Array.from(document.querySelectorAll('[role="treeitem"][aria-selected]')).map(r => {
        const rect = r.getBoundingClientRect()
        return {
          text: (r.textContent || '').trim().slice(0, 40),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          hasDot: Array.from(r.querySelectorAll('[data-owner="dsh-session-status"]')).length > 0,
          dotId: (r.querySelector('[data-owner="dsh-session-status"]') || { getAttribute: () => null }).getAttribute('data-session-id'),
        }
      })
      return { dots: dots.length, rows: list }
    })()`)
    check(rows.dots > 0, `列表行状态点存在（${rows.dots} 个，插件已生效）`)
    const withStatus = (rows.rows || []).find(r => r.hasDot)
    const withoutStatus = (rows.rows || []).find(r => !r.hasDot)
    check(withStatus !== undefined, '存在带插件状态的真实会话行')

    // 悬停有状态行 → 断言 hover 卡内出现注入行
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: withStatus.x, y: withStatus.y })
    await sleep(1400)
    const hover = await evalJs(`(() => {
      const lines = Array.from(document.querySelectorAll('[data-owner-part="hover"]'))
      return {
        count: lines.length,
        sessionIds: lines.map(l => l.getAttribute('data-session-id')),
        insideCard: lines.every(l => {
          const card = l.closest('div[role="button"]')
          return card !== null && /left:\\s*\\d+px/.test(card.getAttribute('style') || '') && /top:\\s*\\d+px/.test(card.getAttribute('style') || '')
        }),
        text: lines.map(l => l.textContent),
      }
    })()`)
    check(hover.count >= 1, `hover 卡注入插件状态行（${hover.count} 条）`)
    check(hover.sessionIds.includes(withStatus.dotId), `注入行 data-session-id 与行点一致（${withStatus.dotId}）`)
    check(hover.insideCard, '注入行位于 portal hover 卡内（与空闲/运行中并列）')
    check(hover.text.every(t => t && t.length > 0), '注入行含标签名称文本')

    // 悬停无状态行 → 不注入
    if (withoutStatus) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: withoutStatus.x, y: withoutStatus.y })
      await sleep(1400)
      const after = await evalJs(`(() => Array.from(document.querySelectorAll('[data-owner-part="hover"]')).length)()`)
      check(after === 0, '无状态会话 hover 不注入状态行')
    } else {
      console.log('  - 无状态行不存在，跳过负例')
    }

    // ---------- 2. 设置页内置色板 + hex 输入 ----------
    await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => ((b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.textContent || '')).includes('设置'))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(3000)
    await evalJs(`(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(el => el.children.length === 0 && el.textContent.trim() === '会话状态')
      if (els.length) { const c = els[0].closest('[role="button"],button,[role="tab"],li,a') || els[0]; c.click() }
    })()`)
    await sleep(2500)
    const settings = await evalJs(`(() => {
      const swatches = Array.from(document.querySelectorAll('button')).filter(b => /^#[0-9a-fA-F]{6}$/.test((b.title || '').trim()))
      const hexInputs = Array.from(document.querySelectorAll('input[aria-label="自定义颜色值"]'))
      return { swatchCount: swatches.length, hexInputCount: hexInputs.length }
    })()`)
    check(settings.swatchCount >= 24, `设置页内置三态各带 8 色 swatch（共 ${settings.swatchCount} 个）`)
    check(settings.hexInputCount >= 1, `自定义行/新增表单含 hex 颜色输入（${settings.hexInputCount} 个）`)

    // 截图留证
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result && shot.result.data) {
      const out = join(dirname(fileURLToPath(import.meta.url)), 'smoke-hover-screenshot.png')
      writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
      console.log('screenshot:', out)
    }

    console.log('smoke-hover OK')
    ws.close()
  } finally {
    edge.kill()
    try { rmSync(userData, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  }
}

main().then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1) })
