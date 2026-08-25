# One-shot npm publish for dsh-session-status (WebAuthn device flow).
# Run this from an INTERACTIVE terminal: npm prints an auth URL, open it in
# a browser, confirm with your passkey, and the CLI completes the publish.
# Agent/background processes cannot complete the device flow (TTY required).
# Keep this file pure ASCII (Windows PowerShell 5.1 parses UTF-8-no-BOM as GBK).
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$node = 'E:\Program Files\DeepSeek Harness\runtime\node\bin\node.exe'
$npmCli = 'E:\Deepseek\Default\npm-cli\node_modules\npm\bin\npm-cli.js'
$token = $env:NPM_PUBLISH_TOKEN
if (-not $token) { $token = [Environment]::GetEnvironmentVariable('NPM_PUBLISH_TOKEN', 'User') }
if (-not $token) { $token = [Environment]::GetEnvironmentVariable('NPM_TOKEN', 'User') }
if (-not $token) {
  $secrets = Join-Path $env:USERPROFILE '.dsh\secrets\npm-token.txt'
  if (Test-Path $secrets) { $token = (Get-Content $secrets -Raw).Trim() }
}
if (-not $token) { throw 'npm token missing: set NPM_PUBLISH_TOKEN or create $DSH_HOME/secrets/npm-token.txt' }

$npmrc = Join-Path $root '.npmrc'
Push-Location $root
try {
  Write-Host '== running tests =='
  & $node (Join-Path $root 'test\status-store.test.mjs')
  if ($LASTEXITCODE -ne 0) { throw "status-store test failed (exit $LASTEXITCODE)" }
  & $node (Join-Path $root 'test\client-shape.test.mjs')
  if ($LASTEXITCODE -ne 0) { throw "client-shape test failed (exit $LASTEXITCODE)" }

  Set-Content -Path $npmrc -Value ("//registry.npmjs.org/:_authToken=" + $token) -Encoding ascii
  Write-Host '== publishing (open the auth URL in your browser when printed) =='
  & $node $npmCli publish --ignore-scripts --cache (Join-Path $root '.npm-cache')
  if ($LASTEXITCODE -ne 0) { throw "npm publish failed (exit $LASTEXITCODE)" }
  Write-Host 'published - https://www.npmjs.com/package/dsh-session-status'
} finally {
  Remove-Item -Force $npmrc -ErrorAction SilentlyContinue
  Pop-Location
}
