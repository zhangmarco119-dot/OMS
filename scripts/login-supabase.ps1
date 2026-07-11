$NodeBin = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$Node = Join-Path $NodeBin 'node.exe'
$Pnpm = 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'

$env:Path = "$NodeBin;$env:Path"
& $Node $Pnpm dlx supabase@latest login --name manage-system --agent no

if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host 'Supabase CLI login completed. Return to Codex and reply that login is complete.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Supabase CLI login failed. Keep this window open and report the error to Codex.' -ForegroundColor Red
}

Read-Host 'Press Enter to close'
