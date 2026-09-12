/**
 * dsh-session-status -- 宿主侧。
 *
 * 装配两件事:
 *  1. settings namespace `dsh-session-status`: 只留标签定义 (labels) 与内置三态
 *     颜色覆盖 (overrides) 这类用户可编辑的偏好; 内置三态作为 composition
 *     `base` 层, 用户层删不掉.
 *  2. storage domain `session_status` (见 lib/domain/): 会话 -> 标签 key 的映射,
 *     落在 $DSH_HOME/storages/ 下, 由 HTTP 路由 (lib/http/) 供浏览器读写.
 *
 * settings 侧的 v0 -> v1 迁移 (sessions 字段搬进 domain) 是独立步骤, 见
 * lib/migrations/settings-sessions.js.
 *
 * 解析顺序（settings provider）：schema 默认值 → base → 用户层。
 * 注意：mergeLayers 对数组是「整体替换」语义，所以一旦用户写入 labels，
 * resolved.labels 不再含 base 内置项 —— 浏览器端 resolveLabels（lib/status-store.js
 * 与 lib/client.js 内联同款）始终把内置三态合并回来，这才是「内置态不可删」的真正保证。
 */
import z from '@deepseek-ai/schemastery'
import { BUILTIN_LABELS, LABEL_ICONS } from './status-store.js'
import { StatusService } from './domain/service.js'
import { migrateSettingsSessions } from './migrations/settings-sessions.js'
import { registerStatusRoutes } from './http/routes.js'

const SETTINGS_NAMESPACE = 'dsh-session-status'
const LOGGER_NAME = 'dsh-session-status'

export const name = 'dsh-session-status'
export const inject = ['settings']

const LabelSchema = z.object({
  key: z.string(),
  name: z.string(),
  color: z.string(),
  builtin: z.boolean().default(false),
  // 自定义标签的 icon（LABEL_ICONS 之一）；旧数据无此字段 → 默认 'tag'，零迁移。
  icon: z.union([...LABEL_ICONS]).default('tag'),
})

/**
 * settings namespace 的 v1 结构: 自定义标签列表 + 内置标签颜色覆盖。
 * v0 曾把 `sessions`（会话 -> 标签 key）也放这里, 现已迁入 storage domain;
 * schemastery 非严格模式会把未声明字段透传, 因此旧文档不会因该字段而校验失败,
 * 残留值由 lib/migrations/settings-sessions.js 清理。
 */
export const STATUS_SCHEMA = z.object({
  labels: z.array(LabelSchema).default([]),
  // 内置三态的颜色覆盖（key → { color }），用户层写入；不写则用内置默认色。
  overrides: z.dict(z.object({ color: z.string() })).default({}),
})

/** composition base 层：内置三态始终存在，用户层删不掉。 */
const DEFAULT_BASE = { labels: BUILTIN_LABELS }

/** @param ctx - 宿主上下文（inject: ['settings'] 保证 ctx.settings 可用）。 */
export function apply(ctx) {
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, STATUS_SCHEMA, { base: DEFAULT_BASE })

  // domain 与 HTTP 路由是 web 侧才有的服务; 缺失时这一半不装配, settings 注册不受影响。
  ctx.inject(['storageDomain', 'webServer'], async (statusCtx) => {
    const logger = statusCtx.logger(LOGGER_NAME)
    const service = await StatusService.open(statusCtx, logger)
    statusCtx.effect(() => () => { void service.close() }, 'dsh-session-status: status domain')

    try {
      await migrateSettingsSessions({
        settings: statusCtx.settings,
        scope,
        service,
        namespace: SETTINGS_NAMESPACE,
        logger,
      })
    } catch (error) {
      // 迁移失败不拦服务启动: 既有 domain 数据照常可读, 下次启动再试。
      logger.error(`settings 迁移失败, 保留既有数据: ${String(error?.message ?? error)}`)
    }

    statusCtx.effect(
      () => registerStatusRoutes(statusCtx, service, logger),
      'dsh-session-status: http routes',
    )
    logger.info(`会话状态存储就绪 (domain=${service.domain.name})`)
  })
}
