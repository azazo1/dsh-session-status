/**
 * dsh-session-status -- 会话状态的持久化 domain 声明.
 *
 * 会话 -> 标签 key 的映射放在 storage 子系统的 domain KV 里 (磁盘落点
 * `$DSH_HOME/storages/session_status/`, 由部署的 storage backend 决定介质),
 * 不再写进 settings.yaml: settings 只留标签定义与内置态颜色覆盖这类
 * 用户可编辑的偏好.
 *
 * 版本约定: 记录结构变化时递增 STATUS_DOMAIN_VERSION; 旧记录仍能被当前
 * 记录 schema 读出的版本要同时列进 compatibleVersions, 否则 backend 会把
 * 未接受的记录当作不存在丢弃 (per-record 布局逐记录判版本).
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** domain 名, 同时是 backend 的 unit 名, 必须匹配 ^[a-z][a-z0-9_]*$. */
export const STATUS_DOMAIN_NAME = 'session_status'

/** 记录结构版本. */
export const STATUS_DOMAIN_VERSION = 1

/** 记录表名, 同样受 unit 名规则约束. */
export const STATUS_TABLE = 'statuses'

/** 一条会话状态记录: 会话 id + 当前标签 key + 最后一次变更时间. */
export const statusRecord = z.object({
  sessionId: z.string().min(1),
  labelKey: z.string().min(1),
  updatedAt: z.string().min(1),
})

/**
 * domain 全局槽: 记录 settings 侧结构已经迁移到哪一版.
 * 0 = sessions 仍可能留在 settings 用户层 (待迁移), 1 = 已迁入本 domain.
 */
export const statusDomainState = z.object({
  settingsSchemaVersion: z.number().int().min(0),
})

/** domain 声明: 每个会话一条记录 (稀疏, 可单独丢弃), 因此用 per-record 布局. */
export const statusDomainSpec = defineDomain({
  name: STATUS_DOMAIN_NAME,
  version: STATUS_DOMAIN_VERSION,
  layout: 'per-record',
  global: { schema: statusDomainState, initial: { settingsSchemaVersion: 0 } },
  tables: { statuses: domainTable(statusRecord) },
})
