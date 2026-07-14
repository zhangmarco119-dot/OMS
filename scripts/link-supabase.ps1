param(
  [ValidateSet('Development', 'Production')]
  [string]$Environment = 'Development'
)

# Compatibility entry point: the environment guard selects the only allowed project.
& (Join-Path $PSScriptRoot 'supabase-environment.ps1') -Environment $Environment -Action Link
