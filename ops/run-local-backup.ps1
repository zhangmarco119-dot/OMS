param([switch]$Force, [int]$RetryDelaySeconds = 300, [int]$MaxAttempts = 12)
$ErrorActionPreference = 'Stop'
$backupRoot = Split-Path -Parent $PSScriptRoot
$configurationPath = Join-Path $backupRoot 'config\backup.json'
$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
$bootId = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
$logDirectory = Join-Path $backupRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$arguments = @((Join-Path $PSScriptRoot 'local-backup.py'), '--config', $configurationPath, '--boot-id', $bootId)
if ($Force) { $arguments += '--force' }
# Startup networking may still be unavailable. Completed image blobs are reused
# after interruption, and a completed snapshot is never replaced by a partial one.
for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $configuration.pythonExecutable
    $startInfo.Arguments = ($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $startInfo
    try {
        $null = $child.Start()
        $outputTask = $child.StandardOutput.ReadToEndAsync()
        $errorTask = $child.StandardError.ReadToEndAsync()
        $child.WaitForExit()
        [IO.File]::AppendAllText($logFile, $outputTask.Result + $errorTask.Result, [Text.Encoding]::UTF8)
        $backupExitCode = $child.ExitCode
    } catch {
        [IO.File]::AppendAllText($logFile, $_.Exception.Message + [Environment]::NewLine, [Text.Encoding]::UTF8)
        $backupExitCode = 1
    } finally {
        $child.Dispose()
    }
    if ($backupExitCode -eq 0) { exit 0 }
    if ($attempt -lt ($MaxAttempts - 1)) { Start-Sleep -Seconds $RetryDelaySeconds }
}
exit 1
