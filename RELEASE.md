# Release checklist — dsh-session-status

## Before publishing

- [ ] `node --check` on lib/index.js, lib/status-store.js, lib/client.js
- [ ] `node test\status-store.test.mjs` — all green
- [ ] `node test\client-shape.test.mjs` — inject is service-name array, drift-guard green
- [ ] `node scripts\smoke-hover.mjs` — hover 卡注入 + 设置页色板回归（需 GUI 运行中）
- [ ] Package name free: GET https://registry.npmjs.org/dsh-session-status -> 404
- [ ] `pnpm pack` / `npm pack --dry-run` — contents = lib + cordis.patch.yml + README
- [ ] peerDependencies only for @deepseek-ai/*; publishConfig.access: public

## Publish

- [ ] `pwsh -File scripts\publish-interactive.ps1` (INTERACTIVE terminal; WebAuthn
      passkey flow; npm prints auth URL, confirm in browser)

## After publishing

- [ ] GitHub repo `LucienLL/dsh-session-status`; push code
- [ ] Topics: `dsh-plugin`, `deepseek-harness`, `cordis`, `session`
- [ ] Smoke in real profile: `dsh plugin --profile web add dsh-session-status`,
      restart, set status in header, verify list dot, restart again, verify persistence
- [ ] (User decision: skip awesome-dsh-plugin PR)

## Known limitations

- List-row dots are DOM-injected (no official row slot); DSH upgrades may break
  the `[role="treeitem"]` selector — degrade gracefully (no dots, no errors).
- Hover-card status line is DOM-injected into the portaled copy card
  (`div[role="button"]` + inline left/top); DSH upgrades may change the card
  markup — degrade gracefully (no line, no errors).
- Status values keyed by session id; archived sessions pruned lazily on next write.
- Builtin color overrides require the `overrides` field in the settings schema
  (lib/index.js); running an older host without the field still round-trips
  non-strict, but restart `dsh web` after upgrade for validated persistence.
