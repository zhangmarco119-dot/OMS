param(
  [ValidateSet('Development', 'Production')]
  [string]$Environment = 'Development'
)

# 兼容旧入口：不再硬编码项目编号，由分支环境校验决定允许 Link 的项目。
& (Join-Path $PSScriptRoot 'supabase-environment.ps1') -Environment $Environment -Action Link
