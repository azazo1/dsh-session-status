/**
 * dsh-session-status -- settings v0 -> v1 迁移.
 *
 * 版本号变化 (settings namespace `dsh-session-status` 的用户层结构):
 *   v0: { labels, sessions, overrides }   -- 会话状态映射留在 settings.yaml
 *   v1: { labels, overrides }             -- 映射迁到 session_status domain
 *
 * 迁移是独立步骤而不是幂等兜底: 只有 domain 全局槽记录的
 * settingsSchemaVersion 低于本模块的 SETTINGS_SCHEMA_VERSION 时才执行导入,
 * 完成后把全局槽抬到该版本. 已迁移过仍残留 `sessions` 字段 (例如用户恢复
 * 了旧 settings.yaml 备份) 时只做清理, 不重复导入, 避免覆盖 domain 里的新值.
 */
import { LABEL_KEY_PATTERN, isRecordKeySafe } from '../status-store.js'

/** 本模块负责的 settings 侧结构版本. */
export const SETTINGS_SCHEMA_VERSION = 1

/** v0 里承载会话状态映射的字段名 (v1 已移出 settings). */
export const LEGACY_SESSIONS_FIELD = 'sessions'

/** 是否是普通对象 (排除数组与 null). */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从 settings 的原始用户层里挑出可迁移的会话状态映射.
 * 非法条目 (key 不能作路径段 / 标签 key 不合规 / 值不是字符串) 直接丢弃并计数.
 * @param userSection - settings 用户层原文 (describe().user).
 * @returns { sessions, rejected } -- 合法映射与新丢弃条数.
 */
export function extractLegacySessions(userSection) {
  const raw = isPlainObject(userSection) ? userSection[LEGACY_SESSIONS_FIELD] : undefined
  if (!isPlainObject(raw)) return { sessions: {}, rejected: 0 }
  const sessions = {}
  let rejected = 0
  for (const [sessionId, labelKey] of Object.entries(raw)) {
    if (!isRecordKeySafe(sessionId) || typeof labelKey !== 'string' || !LABEL_KEY_PATTERN.test(labelKey)) {
      rejected += 1
      continue
    }
    sessions[sessionId] = labelKey
  }
  return { sessions, rejected }
}

/**
 * 去掉用户层里的 v0 遗留字段.
 * @param userSection - settings 用户层原文.
 * @returns 新的用户层; 没有该字段时返回 null (表示无需写回).
 */
export function withoutLegacyField(userSection) {
  if (!isPlainObject(userSection) || !(LEGACY_SESSIONS_FIELD in userSection)) return null
  const next = { ...userSection }
  delete next[LEGACY_SESSIONS_FIELD]
  return next
}

/** 读取本 namespace 的原始用户层 (未过 schema, 因此还能看到 v0 字段). */
function readUserSection(settings, namespace) {
  for (const descriptor of settings.describe()) {
    if (descriptor.ns === namespace) return descriptor.user
  }
  return undefined
}

/**
 * 执行迁移. 幂等性由版本号保证, 不由重复执行保证.
 * @param options - settings 服务, namespace 的 scope, 状态服务与 logger.
 * @returns { imported, rejected, cleaned } -- 导入条数 / 丢弃条数 / 是否清理了残留字段.
 */
export async function migrateSettingsSessions({ settings, scope, service, namespace, logger }) {
  const storedVersion = service.settingsSchemaVersion
  const userSection = readUserSection(settings, namespace)

  if (storedVersion >= SETTINGS_SCHEMA_VERSION) {
    const cleanedSection = withoutLegacyField(userSection)
    if (cleanedSection === null) return { imported: 0, rejected: 0, cleaned: false }
    await scope.replace(cleanedSection)
    logger.warn(`settings v${SETTINGS_SCHEMA_VERSION} 已生效, 清掉用户层残留的 ${LEGACY_SESSIONS_FIELD} 字段`)
    return { imported: 0, rejected: 0, cleaned: true }
  }

  const { sessions, rejected } = extractLegacySessions(userSection)
  let imported = 0
  for (const [sessionId, labelKey] of Object.entries(sessions)) {
    await service.set(sessionId, labelKey)
    imported += 1
  }

  const cleanedSection = withoutLegacyField(userSection)
  if (cleanedSection !== null) await scope.replace(cleanedSection)
  await service.setSettingsSchemaVersion(SETTINGS_SCHEMA_VERSION)

  logger.info(
    `settings v0 -> v1 迁移完成: 导入 ${imported} 条会话状态`
    + `${rejected > 0 ? `, 丢弃 ${rejected} 条非法记录` : ''}`
    + `${cleanedSection === null ? '' : ', 已从 settings 移除 sessions 字段'}`,
  )
  return { imported, rejected, cleaned: cleanedSection !== null }
}
