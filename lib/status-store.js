/**
 * dsh-session-status — 纯逻辑层（零 DSH / Cordis 依赖，可单测）。
 *
 * 本文件是行为的事实来源；浏览器 bundle（lib/client.js）内联了同款实现
 * （bundle 必须自包含，无法跨模块 import），并在 client-shape.test.mjs 中
 * 交叉断言两者行为一致，防止漂移。
 */

/** 内置三态（key 唯一；用户不可删除；同名 key 以内置为准，用户覆盖无效）。 */
export const BUILTIN_LABELS = [
  { key: 'active', name: '进行中', color: '#22c55e', builtin: true },
  { key: 'done', name: '已结项', color: '#3b82f6', builtin: true },
  { key: 'paused', name: '搁置中', color: '#9ca3af', builtin: true },
]

/** 自定义标签可选色板（8 色，与内置三态同风格）。 */
export const PALETTE = [
  '#ef4444', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899',
  '#f97316', '#06b6d4', '#a3e635',
]

/** 颜色合法格式：8 色板任意色，或 #RRGGBB / #RGB（十六进制任意色）。 */
export const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * 把用户输入规范化为 #rrggbb；非法输入返回 null。
 * 支持 #RGB 简写展开与大小写统一（#abc → #aabbcc）。
 */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  const long = /^#([0-9a-fA-F]{6})$/.exec(v)
  if (long) return `#${long[1].toLowerCase()}`
  const short = /^#([0-9a-fA-F]{3})$/.exec(v)
  if (short) {
    const hex = short[1].toLowerCase()
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  return null
}

/** 自定义标签数量上限（内置 3 + 自定义 ≤ 10，见计划 §2.1）。 */
export const MAX_CUSTOM_LABELS = 10

/** 标签 key 格式：小写字母开头，小写字母/数字/连字符。 */
export const LABEL_KEY_PATTERN = /^[a-z][a-z0-9-]*$/

const BUILTIN_KEYS = new Set(BUILTIN_LABELS.map(label => label.key))

/** 内置 key → 默认颜色（用于「恢复默认」/「点击默认色即重置」判定）。 */
export function builtinDefaultColor(key) {
  for (const label of BUILTIN_LABELS) {
    if (label.key === key) return label.color
  }
  return undefined
}

/**
 * 把内置标签的覆盖补丁应用到基线上（当前只写 color，name 预留）。
 * 覆盖条目的字符串字段非空才生效；无覆盖时返回原引用（零拷贝）。
 */
export function applyBuiltinOverride(label, override) {
  if (override === null || typeof override !== 'object') return label
  let out = null
  for (const key of ['color', 'name']) {
    if (typeof override[key] !== 'string' || override[key] === '') continue
    out ||= { ...label }
    out[key] = override[key]
  }
  return out || label
}

/**
 * 合并内置三态与用户标签：内置 key 优先且不被覆盖，其余按序追加并去重。
 * 输入可能是完整 settings 值（{ labels, sessions, overrides }）或纯 labels 数组；
 * overrides（内置 key → { color }）会改内置标签的呈现颜色，不改变其 key 与语义。
 * @param value - settings 值或 labels 数组。
 * @returns 完整合并后的标签列表（含 builtin 标记）。
 */
export function resolveLabels(value) {
  const raw = Array.isArray(value)
    ? value
    : (value !== null && typeof value === 'object' && Array.isArray(value.labels) ? value.labels : [])
  const overrides = (!Array.isArray(value) && value !== null && typeof value === 'object'
    && value.overrides !== null && typeof value.overrides === 'object')
    ? value.overrides
    : {}
  const seen = new Set()
  const merged = []
  for (const label of BUILTIN_LABELS) {
    merged.push(applyBuiltinOverride(label, overrides[label.key]))
    seen.add(label.key)
  }
  for (const label of raw) {
    if (label === null || typeof label !== 'object') continue
    if (typeof label.key !== 'string' || seen.has(label.key)) continue
    if (typeof label.name !== 'string' || label.name === '') continue
    if (typeof label.color !== 'string' || label.color === '') continue
    seen.add(label.key)
    merged.push({
      key: label.key, name: label.name, color: label.color, builtin: false,
      icon: typeof label.icon === 'string' ? label.icon : undefined,
    })
  }
  return merged
}

/** 按 key 查找标签；未找到返回 undefined。 */
export function findLabel(labels, key) {
  if (!Array.isArray(labels)) return undefined
  return labels.find(label => label.key === key)
}

/**
 * 内置三态 key → 固定象征 icon（语义不可换）。
 * @param key - 标签 key。
 * @returns 'bolt' | 'check' | 'pause' | 'tag'。
 */
export function labelIconKey(key) {
  switch (key) {
    case 'active': return 'bolt'
    case 'done': return 'check'
    case 'paused': return 'pause'
    default: return 'tag'
  }
}

/**
 * 自定义标签可选的 icon 集合（含内置三态 icon；默认 'tag'）。
 * 设置页 icon 选择器与 schema 校验共用此清单。
 */
export const LABEL_ICONS = [
  'tag', 'flag', 'star', 'fire', 'clock', 'bookmark', 'rocket',
  'target', 'pin', 'bell', 'bolt', 'check', 'pause',
]

/**
 * 解析一个标签实际渲染的 icon 名称：
 * 内置三态按 key 固定映射；自定义标签用其 `icon` 字段（必须在 LABEL_ICONS
 * 内，否则回退 'tag'——兼容旧数据无 icon 字段的情况）。
 * @param label - 标签对象（{ key, icon? }）。
 * @returns icon 名称。
 */
export function resolveLabelIcon(label) {
  if (label === null || typeof label !== 'object' || typeof label.key !== 'string') return 'tag'
  if (label.key === 'active' || label.key === 'done' || label.key === 'paused') {
    return labelIconKey(label.key)
  }
  return LABEL_ICONS.includes(label.icon) ? label.icon : 'tag'
}

/** 快速点按的循环切换：无状态 → active → done → paused → 无状态（返回 null 表示清除）。 */
export function nextSessionStatus(currentKey) {
  const ORDER = ['active', 'done', 'paused']
  if (typeof currentKey !== 'string' || currentKey === '') return 'active'
  const index = ORDER.indexOf(currentKey)
  if (index === -1) return 'active'
  return index + 1 < ORDER.length ? ORDER[index + 1] : null
}

/**
 * 不可变更新：把 sessionId 的状态设为 key（null/undefined/'' 表示清除）。
 * @param sessions - 原映射（可为 undefined）。
 * @param sessionId - 会话 id。
 * @param key - 目标标签 key；空值清除该会话的条目。
 * @returns 新映射对象（永不原地修改）。
 */
export function assignStatus(sessions, sessionId, key) {
  const next = { ...(sessions || {}) }
  if (key === null || key === undefined || key === '') {
    delete next[sessionId]
  } else {
    next[sessionId] = key
  }
  return next
}

/** 不可变清除：删除 sessionId 的条目。 */
export function clearStatus(sessions, sessionId) {
  return assignStatus(sessions, sessionId, null)
}

/**
 * 不可变更新：把内置标签 key 的覆盖补丁写入 overrides 映射。
 * @param overrides - 原映射（可为 undefined）。
 * @param key - 内置标签 key（active/done/paused）。
 * @param patch - 覆盖字段（{ color }）。
 * @returns 新映射对象（永不原地修改）。
 */
export function setOverride(overrides, key, patch) {
  const next = { ...(overrides || {}) }
  next[key] = { ...(next[key] || {}), ...patch }
  return next
}

/**
 * 不可变清除：删除内置标签 key 的覆盖；清空后返回 undefined（表示「无需写」）。
 * @returns 新映射；若清除后为空返回 undefined。
 */
export function clearOverride(overrides, key) {
  if (overrides === null || overrides === undefined) return undefined
  const next = { ...overrides }
  delete next[key]
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * 惰性清理：只保留存在于 liveSessionIds（当前会话列表）中的条目。
 * @param sessions - 原映射。
 * @param liveSessionIds - 当前存在的会话 id 集合。
 * @returns 清理后的新映射；若没有需要清理的条目返回 undefined（表示「不变，无需写」）。
 */
export function pruneSessions(sessions, liveSessionIds) {
  if (sessions === null || sessions === undefined) return undefined
  const next = {}
  let changed = false
  for (const [id, key] of Object.entries(sessions)) {
    if (liveSessionIds.has(id)) next[id] = key
    else changed = true
  }
  return changed ? next : undefined
}

/**
 * 校验一个自定义标签输入。
 * @param input - { key, name, color }。
 * @param existingLabels - 已合并标签列表（含内置）。
 * @returns 错误消息；合法返回 null。
 */
export function validateLabelInput(input, existingLabels) {
  if (input === null || typeof input !== 'object') return '输入无效'
  if (typeof input.name !== 'string' || input.name.trim() === '') return '名称不能为空'
  if (typeof input.key !== 'string' || !LABEL_KEY_PATTERN.test(input.key)) return 'key 需匹配 ^[a-z][a-z0-9-]*$'
  if (BUILTIN_KEYS.has(input.key)) return '该 key 为内置标签，不可重复'
  if (Array.isArray(existingLabels) && existingLabels.some(label => label.key === input.key)) return 'key 已存在'
  if (typeof input.color !== 'string' || normalizeHex(input.color) === null) return '颜色需为内置色板或 #RRGGBB'
  const customs = Array.isArray(existingLabels)
    ? existingLabels.filter(label => !label.builtin).length
    : 0
  if (customs >= MAX_CUSTOM_LABELS) return `自定义标签已达上限（${MAX_CUSTOM_LABELS} 个）`
  return null
}

/**
 * 由名称生成唯一 key（在 existingKeys 中不冲突）。
 * @param name - 中文/任意名称。
 * @param existingKeys - 已占用 key 集合。
 * @returns 合法的唯一 key。
 */
export function generateLabelKey(name, existingKeys) {
  const base = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const safe = /^[a-z]/.test(base) ? base : `label-${base || 'custom'}`
  let key = safe
  let index = 2
  while (existingKeys.has(key)) {
    key = `${safe}-${index}`
    index += 1
  }
  return key
}

/** 选择色板中第一个未被使用的颜色（全用尽则取色板第一个）。 */
export function nextPaletteColor(labels) {
  const used = new Set((labels || []).map(label => label.color))
  return PALETTE.find(color => !used.has(color)) || PALETTE[0]
}
