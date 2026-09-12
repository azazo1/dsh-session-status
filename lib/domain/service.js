/**
 * dsh-session-status -- 会话状态服务的唯一出口.
 *
 * 域在插件装配时打开一次, 之后所有读写都走这里: HTTP 路由, 迁移模块,
 * 以及将来的其它消费者都只依赖本类, 不直接碰 domain handle.
 */
import { isRecordKeySafe } from '../status-store.js'
import { STATUS_TABLE, statusDomainSpec } from './spec.js'

/** 会话状态读写服务. */
export class StatusService {
  /**
   * @param domain - 已打开的 domain handle.
   * @param logger - 带插件名的 logger, 用于告警和阶段日志.
   */
  constructor(domain, logger) {
    this.domain = domain
    this.table = domain.table(STATUS_TABLE)
    this.logger = logger
  }

  /**
   * 打开 domain 并返回服务实例.
   * @param ctx - 注入了 storageDomain 的上下文.
   * @param logger - 带插件名的 logger.
   * @returns 服务实例.
   */
  static async open(ctx, logger) {
    const domain = await ctx.storageDomain.open(statusDomainSpec)
    return new StatusService(domain, logger)
  }

  /** settings 侧结构已迁移到的版本 (domain 全局槽, 未写过时为 0). */
  get settingsSchemaVersion() {
    return this.domain.global.get().settingsSchemaVersion
  }

  /**
   * 记录 settings 侧结构迁移进度.
   * @param version - 已完成的迁移版本号.
   */
  async setSettingsSchemaVersion(version) {
    const current = this.domain.global.get()
    if (current.settingsSchemaVersion === version) return
    await this.domain.global.set({ ...current, settingsSchemaVersion: version })
  }

  /**
   * 当前全部 会话 -> 标签 key 的快照.
   * 以记录里的 sessionId 为准 (key 只是布局用的路径段).
   * @returns 普通对象; 无状态时为空对象.
   */
  snapshot() {
    const out = {}
    for (const [, record] of this.table.entries()) {
      out[record.sessionId] = record.labelKey
    }
    return out
  }

  /**
   * 写入一个会话的状态.
   * @param sessionId - 会话 id (必须是路径安全的 key).
   * @param labelKey - 目标标签 key; null 表示清除该会话的状态.
   * @returns 是否产生了写操作.
   */
  async set(sessionId, labelKey) {
    if (!isRecordKeySafe(sessionId)) {
      throw new Error(`session id "${String(sessionId)}" is not usable as a storage record key`)
    }
    if (labelKey === null) {
      return this.table.delete(sessionId)
    }
    await this.table.put(sessionId, {
      sessionId,
      labelKey,
      updatedAt: new Date().toISOString(),
    })
    return true
  }

  /**
   * 惰性清理: 删除不属于 liveSessionIds 的记录 (会话已删除/归档后不留在盘上).
   * @param liveSessionIds - 当前仍存在的会话 id 集合.
   * @returns 被删除的记录条数.
   */
  async prune(liveSessionIds) {
    const stale = []
    for (const [key, record] of this.table.entries()) {
      if (!liveSessionIds.has(record.sessionId)) stale.push(key)
    }
    for (const key of stale) await this.table.delete(key)
    return stale.length
  }

  /** 关闭 domain (插件卸载路径). */
  async close() {
    await this.domain.close()
  }
}
