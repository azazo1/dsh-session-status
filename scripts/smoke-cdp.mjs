/**
 * 冒烟验证脚本：headless Edge + CDP 打开 DSH GUI（127.0.0.1:3180），
 * 检查 dsh-session-status 插件的渲染结果：
 *  1. 列表行注入节点 [data-owner="dsh-session-status"]（应含象征 icon SVG）
 *  2. 头部 pill（title="设置会话状态" 或标签名的 button）
 * 用法：node scripts/smoke-cdp.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const TARGET = 'http://127.0.0.1:3180'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
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

  // 等 CDP 就绪
  let version = null
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`)
      break
    } catch { await sleep(500) }
  }
  if (!version) {
    edge.kill()
    rmSync(userData, { recursive: true, force: true })
    throw new Error('CDP endpoint not available')
  }

  // 找目标页面 tab
  let page = null
  for (let i = 0; i < 20; i++) {
    const tabs = await fetchJson(`http://127.0.0.1:${PORT}/json`)
    page = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3180'))
    if (page) break
    await sleep(500)
  }
  if (!page) {
    edge.kill()
    rmSync(userData, { recursive: true, force: true })
    throw new Error('target page not found')
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

  // 等 SPA 加载 + 插件渲染（给足时间）
  await sleep(9000)

  // 点击第一个「真实」会话行（跳过 blank 的 New Session 占位行），打开会话以渲染头部 pill
  const clickExpr = `(() => {
    const rows = Array.from(document.querySelectorAll('[role="treeitem"][aria-selected]'))
    const real = rows.find(r => (r.textContent || '').trim() !== '新会话')
    if (!real) return 'no-real-row'
    real.click()
    return 'clicked:' + real.textContent.trim().slice(0, 40)
  })()`
  const clickResult = await send('Runtime.evaluate', { expression: clickExpr, returnByValue: true })
  await sleep(7000)

  const clickRaw = JSON.stringify(clickResult)
  const expr = `(() => {
    const owned = Array.from(document.querySelectorAll('[data-owner="dsh-session-status"]'))
    const pills = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.title || '').includes('设置会话状态') || (b.textContent || '').includes('未设置状态') || /^(进行中|已结项|搁置中)$/.test((b.textContent || '').trim()))
    const selected = document.querySelector('[role="treeitem"][aria-selected="true"]')
    return {
      url: location.href,
      title: document.title,
      clickRaw: ${JSON.stringify(clickRaw)},
      selectedRow: selected ? selected.textContent.trim().slice(0, 40) : null,
      ownedCount: owned.length,
      owned: owned.map(n => ({ sessionId: n.getAttribute('data-session-id'), statusKey: n.getAttribute('data-status-key'), html: n.innerHTML.slice(0, 200) })),
      pillCount: pills.length,
      pills: pills.map(p => ({ title: p.title, text: p.textContent.trim().slice(0, 40) })),
      hasBolt: document.body.innerHTML.includes('M13 2 3 14h7l-1 8 10-12h-7l1-8z'),
      hasTag: document.body.innerHTML.includes('21.41 11.58'),
    }
  })()`
  const result = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const value = result.result && result.result.result ? result.result.result.value : null
  console.log(JSON.stringify(value, null, 2))

  // 设置面板探测：打开设置，检查「会话状态」section 的 icon 选择器是否渲染
  try {
    const openExpr = `(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const trigger = btns.find(b => {
        const label = (b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.textContent || '')
        return label.includes('设置') || label.toLowerCase().includes('settings')
      })
      if (!trigger) return 'no-settings-trigger'
      trigger.click()
      return 'settings-opened'
    })()`
    const openResult = await send('Runtime.evaluate', { expression: openExpr, returnByValue: true })
    await sleep(3000)
    // 点击「会话状态」导航项，激活该 section 并渲染 icon 选择器
    const navExpr = `(() => {
      const els = Array.from(document.querySelectorAll('*'))
        .filter(el => el.children.length === 0 && el.textContent.trim() === '会话状态')
      if (els.length === 0) return 'no-nav'
      const clickable = els[0].closest('[role="button"],button,[role="tab"],li,a') || els[0]
      clickable.click()
      return 'nav-clicked'
    })()`
    const navResult = await send('Runtime.evaluate', { expression: navExpr, returnByValue: true })
    await sleep(2500)
    const settingsExpr = `(() => {
      const icons = Array.from(document.querySelectorAll('button[title]'))
        .filter(b => ['tag','flag','star','fire','clock','bookmark','rocket','target','pin','bell'].includes(b.title))
      const sectionRoot = Array.from(document.querySelectorAll('*')).find(el =>
        el.children.length === 0 && el.textContent.trim() === '会话状态标签')
      return {
        open: ${JSON.stringify(openResult.result && openResult.result.result ? openResult.result.result.value : null)},
        nav: ${JSON.stringify(navResult.result && navResult.result.result ? navResult.result.result.value : null)},
        sectionRootFound: sectionRoot !== undefined,
        iconPickerButtons: icons.length,
        iconTitles: icons.slice(0, 20).map(b => b.title),
        hasAddForm: document.body.textContent.includes('新标签名称'),
      }
    })()`
    const settingsResult = await send('Runtime.evaluate', { expression: settingsExpr, returnByValue: true })
    console.log('SETTINGS:', JSON.stringify(settingsResult.result && settingsResult.result.result ? settingsResult.result.result.value : settingsResult, null, 2))
  } catch (e) {
    console.log('SETTINGS probe skipped:', e.message)
  }

  // 截图视觉证据（可选，保存到脚本同目录）
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = shot.result && shot.result.data
    if (b64) {
      const { writeFileSync } = await import('node:fs')
      const { dirname, join } = await import('node:path')
      const { fileURLToPath } = await import('node:url')
      const out = join(dirname(fileURLToPath(import.meta.url)), 'smoke-screenshot.png')
      writeFileSync(out, Buffer.from(b64, 'base64'))
      console.log('screenshot saved:', out)
    }
  } catch (e) { console.error('screenshot skipped:', e.message) }

  ws.close()
  edge.kill()
  try { rmSync(userData, { recursive: true, force: true }) } catch { /* 沙箱清理失败不影响结果 */ }
}

main().then(() => process.exit(0), (err) => { console.error('SMOKE FAIL:', err.message); process.exit(1) })
