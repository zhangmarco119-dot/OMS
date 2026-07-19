param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Development', 'Production')]
  [string]$Environment,

  [Parameter(Mandatory = $true)]
  [ValidateSet('Link', 'MigrationList', 'DryRun', 'Push', 'SeedDevelopment', 'DeployFunctions', 'PushAuthConfig')]
  [string]$Action,

  [string]$ProductionConfirmation = '',
  [string]$ProductionFunctionConfirmation = '',
  [string]$ProductionAuthConfirmation = '',
  [string]$AuthSiteUrl = '',
  [string]$AuthRedirectUrl = '',
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
  throw 'Node.js was not found. Install Node.js 22 LTS first.'
}

$PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  if ($PnpmCommand) {
    & $PnpmCommand.Source @Arguments
  } elseif (Test-Path -LiteralPath $BundledPnpm) {
    & $Node $BundledPnpm @Arguments
  } else {
    throw 'pnpm was not found. Run corepack enable first.'
  }
  if ($LASTEXITCODE -ne 0) { throw "pnpm failed with exit code $LASTEXITCODE." }
}

Push-Location $Root
try {
  $Branch = (& git branch --show-current).Trim()
  $RequiredBranch = if ($Environment -eq 'Development') { 'v2-development' } else { 'manage-system' }
  if ($Branch -ne $RequiredBranch) {
    throw "$Environment database actions require branch $RequiredBranch; current branch is $Branch."
  }

  $TargetRef = (& $Node scripts/verify-environment.mjs --print-project-ref).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $TargetRef) { throw 'Branch and Supabase environment validation failed.' }

  if ($Action -eq 'Link') {
    Invoke-Pnpm dlx supabase@latest link --project-ref $TargetRef --agent no
    & $Node scripts/verify-environment.mjs --require-linked
    if ($LASTEXITCODE -ne 0) { throw 'Post-link environment validation failed.' }
    return
  }

  & $Node scripts/verify-environment.mjs --require-linked
  if ($LASTEXITCODE -ne 0) { throw 'The linked Supabase project does not match the current branch.' }

  switch ($Action) {
    'MigrationList' {
      Invoke-Pnpm dlx supabase@latest migration list --linked --agent no
    }
    'DryRun' {
      Invoke-Pnpm dlx supabase@latest db push --linked --dry-run --agent no
    }
    'Push' {
      if ($Environment -eq 'Production' -and $ProductionConfirmation -ne 'APPLY-PRODUCTION-MIGRATIONS') {
        throw 'Production Push requires -ProductionConfirmation APPLY-PRODUCTION-MIGRATIONS.'
      }
      Invoke-Pnpm dlx supabase@latest db push --linked --dry-run --agent no
      Invoke-Pnpm dlx supabase@latest db push --linked --agent no
    }
    'SeedDevelopment' {
      if ($Environment -ne 'Development') { throw 'SeedDevelopment is forbidden in production.' }
      if ($DevelopmentSeedConfirmation -ne 'APPLY-DEVELOPMENT-SEED') {
        throw 'Development Seed requires -DevelopmentSeedConfirmation APPLY-DEVELOPMENT-SEED.'
      }
      Invoke-Pnpm dlx supabase@latest db query --linked --file supabase/seeds/development.sql --agent no
    }
    'DeployFunctions' {
      if ($Environment -eq 'Production' -and $ProductionFunctionConfirmation -ne 'DEPLOY-PRODUCTION-FUNCTIONS') {
        throw 'Production function deployment requires -ProductionFunctionConfirmation DEPLOY-PRODUCTION-FUNCTIONS.'
      }
      Invoke-Pnpm dlx supabase@latest functions deploy account-login --project-ref $TargetRef --no-verify-jwt --agent no
      Invoke-Pnpm dlx supabase@latest functions deploy admin-users --project-ref $TargetRef --agent no
      Invoke-Pnpm dlx supabase@latest functions deploy task-template-images --project-ref $TargetRef --agent no
      Invoke-Pnpm dlx supabase@latest functions deploy dingtalk-attendance --project-ref $TargetRef --no-verify-jwt --agent no
      Invoke-Pnpm dlx supabase@latest functions deploy pospal-sales --project-ref $TargetRef --no-verify-jwt --agent no
    }
    'PushAuthConfig' {
      if ($AuthSiteUrl -notmatch '^https://[^/]+/?$' -or $AuthRedirectUrl -notmatch '^https://[^/]+/?$') {
        throw 'AuthSiteUrl and AuthRedirectUrl must be HTTPS origins without a path.'
      }
      if ($Environment -eq 'Production' -and $ProductionAuthConfirmation -ne 'APPLY-PRODUCTION-AUTH-CONFIG') {
        throw 'Production Auth config requires -ProductionAuthConfirmation APPLY-PRODUCTION-AUTH-CONFIG.'
      }
      $PreviousSiteUrl = $env:STOREHUB_AUTH_SITE_URL
      $PreviousRedirectUrl = $env:STOREHUB_AUTH_REDIRECT_URL
      try {
        $env:STOREHUB_AUTH_SITE_URL = $AuthSiteUrl.TrimEnd('/')
        $env:STOREHUB_AUTH_REDIRECT_URL = $AuthRedirectUrl.TrimEnd('/')
        Invoke-Pnpm dlx supabase@latest config push --project-ref $TargetRef --yes --agent no
      } finally {
        $env:STOREHUB_AUTH_SITE_URL = $PreviousSiteUrl
        $env:STOREHUB_AUTH_REDIRECT_URL = $PreviousRedirectUrl
      }
    }
  }
} finally {
  Pop-Location
}
