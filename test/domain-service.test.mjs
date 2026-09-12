/**
 * 会话状态服务单测：lib/domain/service.js。
 * 用假 domain handle (形状与 storage domain 的 KvTable / DomainGlobal 一致)
 * 验证快照、写入、清除、清理与 key 守卫, 不依赖真实 storage backend。
 *   node test/domain-service.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StatusService } from '../lib/domain/service.js'

/** 假 domain handle：内存记录表 + 全局槽。 */
function fakeDomain(initialGlobal) {
  const records = new Map()
  let global = { ...(initialGlobal ?? { settingsSchemaVersion: 0 }) }
  let closed = false
  const table = {
    get: key => records.get(key),
    entries: () => records.entries(),
    keys: () => records.keys(),
    get size() { return records.size },
    put(key, value) { records.set(key, value); return Promise.resolve() },
    delete(key) { const had = records.delete(key); return Promise.resolve(had) },
    update(key, fn) {
      if (!records.has(key)) return Promise.reject(new Error('missing-key'))
      const next = fn(records.get(key))
      records.set(key, next)
      return Promise.resolve(next)
    },
  }
  return {
    name: 'session_status',
    records,
    get closed() { return closed },
    global: {
      get: () => ({ ...global }),
      set: value => { global = { ...value }; return Promise.resolve() },
    },
    table: () => table,
    close: () => { closed = true; return Promise.resolve() },
  }
}

const SESSION_A = 'session-11111111-2222-3333-4444-555555555555'
const SESSION_B = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('set / snapshot：写入、覆盖、清除', async () => {
  const domain = fakeDomain()
  const service = new StatusService(domain, { warn() {} })

  await service.set(SESSION_A, 'active')
  assert.deepEqual(service.snapshot(), { [SESSION_A]: 'active' })
  assert.equal(domain.records.get(SESSION_A).labelKey, 'active')
  assert.ok(typeof domain.records.get(SESSION_A).updatedAt === 'string')

  await service.set(SESSION_A, 'todo')          // 同会话改状态 = 覆盖
  assert.deepEqual(service.snapshot(), { [SESSION_A]: 'todo' })

  await service.set(SESSION_B, 'done')
  assert.deepEqual(service.snapshot(), { [SESSION_A]: 'todo', [SESSION_B]: 'done' })

  await service.set(SESSION_A, null)            // null = 清除
  assert.deepEqual(service.snapshot(), { [SESSION_B]: 'done' })
  assert.equal(await service.set(SESSION_B, null), true)
  assert.deepEqual(service.snapshot(), {})
})

test('set：拒绝不能作记录 key 的 session id', async () => {
  const service = new StatusService(fakeDomain(), { warn() {} })
  for (const bad of ['', 'has space', 'a/b', 'a.b', null, undefined]) {
    await assert.rejects(() => service.set(bad, 'active'), /not usable as a storage record key/)
  }
  assert.deepEqual(service.snapshot(), {})
})

test('prune：删除不属于 live 集合的记录, 返回条数', async () => {
  const service = new StatusService(fakeDomain(), { warn() {} })
  await service.set(SESSION_A, 'active')
  await service.set(SESSION_B, 'done')

  assert.equal(await service.prune(new Set([SESSION_A, SESSION_B])), 0)
  assert.equal(await service.prune(new Set([SESSION_A])), 1)
  assert.deepEqual(service.snapshot(), { [SESSION_A]: 'active' })
  assert.equal(await service.prune(new Set()), 1)
  assert.deepEqual(service.snapshot(), {})
})

test('settingsSchemaVersion：默认 0, 写入后读回, 相同值不重复写', async () => {
  const domain = fakeDomain()
  const service = new StatusService(domain, { warn() {} })
  assert.equal(service.settingsSchemaVersion, 0)
  await service.setSettingsSchemaVersion(1)
  assert.equal(service.settingsSchemaVersion, 1)
  const writesAfterFirst = domain.global.get()
  await service.setSettingsSchemaVersion(1)
  assert.deepEqual(domain.global.get(), writesAfterFirst)
})

test('close：转交 domain.close', async () => {
  const domain = fakeDomain()
  const service = new StatusService(domain, { warn() {} })
  await service.close()
  assert.equal(domain.closed, true)
})

console.log('domain service OK: all 5 cases passed')
