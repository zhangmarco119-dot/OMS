$NodeBin = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$Node = Join-Path $NodeBin 'node.exe'
$Pnpm = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'

$env:Path = "$NodeBin;$env:Path"
& $Node $Pnpm dlx supabase@latest link --project-ref mxxxpyowccezplfeffms --agent no

if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host 'Supabase project link completed. Return to Codex and report completion.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Supabase project link failed. Keep this window open and report the error to Codex.' -ForegroundColor Red
}

Read-Host 'Press Enter to close'
