/**
 * dsh-session-status -- 浏览器侧读写会话状态的 HTTP 路由.
 *
 * 会话状态存在 host 侧的 storage domain 里, 浏览器只能通过路由访问:
 *   GET  /plugins/dsh-session-status/statuses -> { statuses }
 *   POST /plugins/dsh-session-status/status   { sessionId, labelKey|null } -> { statuses }
 *   POST /plugins/dsh-session-status/prune    { liveIds: string[] }        -> { statuses, removed }
 *
 * 路由与 client bundle 里的常量一一对应, 改名要两边同时改.
 */
import { LABEL_KEY_PATTERN, isRecordKeySafe } from '../status-store.js'

/** 全部会话状态 (只读). */
export const STATUSES_PATH = '/plugins/dsh-session-status/statuses'
/** 写入/清除单个会话的状态. */
export const STATUS_PATH = '/plugins/dsh-session-status/status'
/** 惰性清理: 删除已不存在会话的记录. */
export const PRUNE_PATH = '/plugins/dsh-session-status/prune'

/** 请求体上限: 路由只收小型 JSON, 超过即拒绝. */
const MAX_BODY_BYTES = 256 * 1024

/** 单次清理请求允许的会话 id 条数上限. */
const MAX_PRUNE_IDS = 20000

/** 写一个 JSON 响应. */
function respondJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** 读取并解析请求体 JSON; 超限/非 JSON 时抛错. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

/** 只接受 POST. */
function requirePost(req, res) {
  if (req.method === 'POST') return true
  res.writeHead(405, { allow: 'POST' })
  res.end()
  return false
}

/** 只接受 GET/HEAD. */
function requireGet(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  res.writeHead(405, { allow: 'GET' })
  res.end()
  return false
}

/** GET /statuses -- 返回全部会话状态. */
function handleList(req, res, service) {
  if (!requireGet(req, res)) return
  respondJson(res, 200, { statuses: service.snapshot() })
}

/**
 * POST /status -- 写入或清除单个会话的状态.
 * body: { sessionId: string, labelKey: string|null }
 */
async function handleSet(req, res, service, logger) {
  if (!requirePost(req, res)) return
  const body = await readJsonBody(req)
  const sessionId = body?.sessionId
  const labelKey = body?.labelKey === undefined ? null : body.labelKey
  if (typeof sessionId !== 'string' || !isRecordKeySafe(sessionId)) {
    respondJson(res, 400, { error: 'sessionId must be a non-empty session id' })
    return
  }
  if (labelKey !== null && (typeof labelKey !== 'string' || !LABEL_KEY_PATTERN.test(labelKey))) {
    respondJson(res, 400, { error: 'labelKey must be null or a label key' })
    return
  }
  try {
    await service.set(sessionId, labelKey)
  } catch (error) {
    logger.warn(`写入会话状态失败 (${sessionId}): ${String(error?.message ?? error)}`)
    respondJson(res, 500, { error: 'failed to persist session status' })
    return
  }
  respondJson(res, 200, { statuses: service.snapshot() })
}

/**
 * POST /prune -- 清理不属于 liveIds 的记录.
 * body: { liveIds: string[] }
 */
async function handlePrune(req, res, service, logger) {
  if (!requirePost(req, res)) return
  const body = await readJsonBody(req)
  const liveIds = body?.liveIds
  if (!Array.isArray(liveIds) || liveIds.length > MAX_PRUNE_IDS || liveIds.some(id => typeof id !== 'string')) {
    respondJson(res, 400, { error: 'liveIds must be an array of session ids' })
    return
  }
  let removed = 0
  try {
    removed = await service.prune(new Set(liveIds))
  } catch (error) {
    logger.warn(`清理会话状态失败: ${String(error?.message ?? error)}`)
    respondJson(res, 500, { error: 'failed to prune session statuses' })
    return
  }
  respondJson(res, 200, { statuses: service.snapshot(), removed })
}

/**
 * 注册三条路由.
 * @param ctx - 已注入 webServer 的上下文.
 * @param service - 状态服务.
 * @param logger - 带插件名的 logger.
 * @returns 反注册函数.
 */
export function registerStatusRoutes(ctx, service, logger) {
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: STATUSES_PATH,
      handler: (req, res) => handleList(req, res, service),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        try {
          await handleSet(req, res, service, logger)
        } catch (error) {
          logger.warn(`处理 ${STATUS_PATH} 失败: ${String(error?.message ?? error)}`)
          if (!res.headersSent) respondJson(res, 400, { error: 'bad request' })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PRUNE_PATH,
      handler: async (req, res) => {
        try {
          await handlePrune(req, res, service, logger)
        } catch (error) {
          logger.warn(`处理 ${PRUNE_PATH} 失败: ${String(error?.message ?? error)}`)
          if (!res.headersSent) respondJson(res, 400, { error: 'bad request' })
        }
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
