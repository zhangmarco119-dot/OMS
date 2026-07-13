param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Development', 'Production')]
  [string]$Environment,

  [Parameter(Mandatory = $true)]
  [ValidateSet('Link', 'MigrationList', 'DryRun', 'Push', 'SeedDevelopment')]
  [string]$Action,

  [string]$ProductionConfirmation = '',
  [string]$DevelopmentSeedConfirmation = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$BundledNodeDirectory = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$BundledNode = Join-Path $BundledNodeDirectory 'node.exe'
$BundledPnpm = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'

if ($NodeCommand) {
  $Node = $NodeCommand.Source
} elseif (Test-Path -LiteralPath $BundledNode) {
  $Node = $BundledNode
  $env:Path = "$BundledNodeDirectory;$env:Path"
} else {
  throw '未找到 Node.js，请先安装 Node.js 22 LTS。'
}

$PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  if ($PnpmCommand) {
    & $PnpmCommand.Source @Arguments
  } elseif (Test-Path -LiteralPath $BundledPnpm) {
    & $Node $BundledPnpm @Arguments
  } else {
    throw '未找到 pnpm，请先执行 corepack enable。'
  }
  if ($LASTEXITCODE -ne 0) { throw "pnpm 命令执行失败，退出码 $LASTEXITCODE。" }
}

Push-Location $Root
try {
  $Branch = (& git branch --show-current).Trim()
  $RequiredBranch = if ($Environment -eq 'Development') { 'v2-development' } else { 'manage-system' }
  if ($Branch -ne $RequiredBranch) {
    throw "$Environment 数据库操作只能在 $RequiredBranch 分支执行；当前分支为 $Branch。"
  }

  $TargetRef = (& $Node scripts/verify-environment.mjs --print-project-ref).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $TargetRef) { throw '分支与 Supabase 环境校验未通过。' }

  if ($Action -eq 'Link') {
    Invoke-Pnpm dlx supabase@latest link --project-ref $TargetRef --agent no
    & $Node scripts/verify-environment.mjs --require-linked
    if ($LASTEXITCODE -ne 0) { throw 'Link 后复核失败。' }
    return
  }

  & $Node scripts/verify-environment.mjs --require-linked
  if ($LASTEXITCODE -ne 0) { throw '当前 Supabase CLI Link 与分支环境不一致。' }

  switch ($Action) {
    'MigrationList' {
      Invoke-Pnpm dlx supabase@latest migration list --linked --agent no
    }
    'DryRun' {
      Invoke-Pnpm dlx supabase@latest db push --linked --dry-run --agent no
    }
    'Push' {
      if ($Environment -eq 'Production' -and $ProductionConfirmation -ne 'APPLY-PRODUCTION-MIGRATIONS') {
        throw '正式库 Push 必须显式传入 -ProductionConfirmation APPLY-PRODUCTION-MIGRATIONS。'
      }
      Invoke-Pnpm dlx supabase@latest db push --linked --dry-run --agent no
      Invoke-Pnpm dlx supabase@latest db push --linked --agent no
    }
    'SeedDevelopment' {
      if ($Environment -ne 'Development') { throw 'SeedDevelopment 禁止用于正式环境。' }
      if ($DevelopmentSeedConfirmation -ne 'APPLY-DEVELOPMENT-SEED') {
        throw '开发 Seed 必须显式传入 -DevelopmentSeedConfirmation APPLY-DEVELOPMENT-SEED。'
      }
      Invoke-Pnpm dlx supabase@latest db query --linked --file supabase/seeds/development.sql --agent no
    }
  }
} finally {
  Pop-Location
}
