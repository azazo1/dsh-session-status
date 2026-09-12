/**
 * settings v0 -> v1 迁移单测：lib/migrations/settings-sessions.js。
 * 用假 settings / scope / service, 只验证版本门控、导入与清理行为。
 *   node test/migration.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_SCHEMA_VERSION, LEGACY_SESSIONS_FIELD,
  extractLegacySessions, withoutLegacyField, migrateSettingsSessions,
} from '../lib/migrations/settings-sessions.js'

const NAMESPACE = 'dsh-session-status'

/** 假的 settings 服务：describe() 返回一条本 namespace 的原始用户层。 */
function fakeSettings(userSection) {
  return { describe: () => [{ ns: NAMESPACE, user: userSection }] }
}

/** 假的 settings scope：记录每次 replace 的用户层。 */
function fakeScope() {
  const replacements = []
  return {
    replacements,
    replace(section) {
      replacements.push(section)
      return Promise.resolve()
    },
  }
}

/** 假的状态服务：只记住写入的会话状态与 settingsSchemaVersion。 */
function fakeService(version) {
  const state = { version, records: new Map(), versionWrites: [] }
  return {
    state,
    get settingsSchemaVersion() { return state.version },
    setSettingsSchemaVersion(next) {
      state.versionWrites.push(next)
      state.version = next
      return Promise.resolve()
    },
    set(sessionId, labelKey) {
      state.records.set(sessionId, labelKey)
      return Promise.resolve(true)
    },
  }
}

/** 收集日志的假 logger。 */
function fakeLogger() {
  const lines = []
  return {
    lines,
    info: message => lines.push(['info', message]),
    warn: message => lines.push(['warn', message]),
    error: message => lines.push(['error', message]),
  }
}

const SESSION_A = 'session-11111111-2222-3333-4444-555555555555'
const SESSION_B = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('extractLegacySessions：只保留合法条目并计数丢弃', () => {
  const { sessions, rejected } = extractLegacySessions({
    [LEGACY_SESSIONS_FIELD]: {
      [SESSION_A]: 'active',
      [SESSION_B]: 'todo',
      'has space': 'active',        // key 不能作路径段
      [SESSION_A + 'x']: 'Bad_Key', // 标签 key 不合规
      'session-null': null,         // 值不是字符串
    },
  })
  assert.deepEqual(sessions, { [SESSION_A]: 'active', [SESSION_B]: 'todo' })
  assert.equal(rejected, 3)
})

test('extractLegacySessions：字段缺失/非对象 → 空结果', () => {
  for (const input of [undefined, null, {}, { [LEGACY_SESSIONS_FIELD]: null }, { [LEGACY_SESSIONS_FIELD]: [] }, 'nope']) {
    assert.deepEqual(extractLegacySessions(input), { sessions: {}, rejected: 0 })
  }
})

test('withoutLegacyField：去掉 v0 字段且不改原对象；没有该字段返回 null', () => {
  const user = { labels: [{ key: 'c', name: 'C', color: '#ef4444' }], [LEGACY_SESSIONS_FIELD]: { a: 'active' } }
  const next = withoutLegacyField(user)
  assert.equal(LEGACY_SESSIONS_FIELD in next, false)
  assert.deepEqual(next.labels, user.labels)
  assert.equal(LEGACY_SESSIONS_FIELD in user, true)   // 原对象不动
  assert.equal(withoutLegacyField({ labels: [] }), null)
  assert.equal(withoutLegacyField(undefined), null)
  assert.equal(withoutLegacyField('nope'), null)
})

test('migrateSettingsSessions：v0 -> v1 导入 + 清理 + 抬版本号', async () => {
  const service = fakeService(0)
  const scope = fakeScope()
  const logger = fakeLogger()
  const result = await migrateSettingsSessions({
    settings: fakeSettings({
      labels: [],
      [LEGACY_SESSIONS_FIELD]: { [SESSION_A]: 'active', [SESSION_B]: 'todo' },
      overrides: { active: { color: '#ff00ff' } },
    }),
    scope,
    service,
    namespace: NAMESPACE,
    logger,
  })

  assert.deepEqual(result, { imported: 2, rejected: 0, cleaned: true })
  assert.deepEqual([...service.state.records.entries()], [[SESSION_A, 'active'], [SESSION_B, 'todo']])
  assert.deepEqual(service.state.versionWrites, [SETTINGS_SCHEMA_VERSION])
  // 清理后的用户层保留 labels/overrides, 只去掉 sessions
  assert.equal(scope.replacements.length, 1)
  assert.deepEqual(scope.replacements[0], { labels: [], overrides: { active: { color: '#ff00ff' } } })
  assert.equal(logger.lines[0][0], 'info')
})

test('migrateSettingsSessions：v0 但 settings 里没有 sessions → 只抬版本号', async () => {
  const service = fakeService(0)
  const scope = fakeScope()
  const result = await migrateSettingsSessions({
    settings: fakeSettings({ labels: [] }),
    scope,
    service,
    namespace: NAMESPACE,
    logger: fakeLogger(),
  })
  assert.deepEqual(result, { imported: 0, rejected: 0, cleaned: false })
  assert.deepEqual(service.state.versionWrites, [SETTINGS_SCHEMA_VERSION])
  assert.equal(scope.replacements.length, 0)
})

test('migrateSettingsSessions：已迁移过但残留 sessions 字段 → 只清理不重复导入', async () => {
  const service = fakeService(SETTINGS_SCHEMA_VERSION)
  const scope = fakeScope()
  const logger = fakeLogger()
  const result = await migrateSettingsSessions({
    settings: fakeSettings({ [LEGACY_SESSIONS_FIELD]: { [SESSION_A]: 'active' } }),
    scope,
    service,
    namespace: NAMESPACE,
    logger,
  })
  assert.deepEqual(result, { imported: 0, rejected: 0, cleaned: true })
  assert.equal(service.state.records.size, 0)          // 不覆盖 domain 里的既有值
  assert.deepEqual(service.state.versionWrites, [])
  assert.deepEqual(scope.replacements, [{}])
  assert.equal(logger.lines[0][0], 'warn')
})

test('migrateSettingsSessions：已迁移过且无残留 → 完全不动', async () => {
  const service = fakeService(SETTINGS_SCHEMA_VERSION)
  const scope = fakeScope()
  const result = await migrateSettingsSessions({
    settings: fakeSettings({ labels: [] }),
    scope,
    service,
    namespace: NAMESPACE,
    logger: fakeLogger(),
  })
  assert.deepEqual(result, { imported: 0, rejected: 0, cleaned: false })
  assert.equal(scope.replacements.length, 0)
  assert.deepEqual(service.state.versionWrites, [])
})

test('migrateSettingsSessions：namespace 未注册时按无用户层处理', async () => {
  const service = fakeService(0)
  const result = await migrateSettingsSessions({
    settings: { describe: () => [] },
    scope: fakeScope(),
    service,
    namespace: NAMESPACE,
    logger: fakeLogger(),
  })
  assert.deepEqual(result, { imported: 0, rejected: 0, cleaned: false })
  assert.deepEqual(service.state.versionWrites, [SETTINGS_SCHEMA_VERSION])
})

console.log('settings migration OK: all 7 cases passed')
