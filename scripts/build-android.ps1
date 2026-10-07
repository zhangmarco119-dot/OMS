param([ValidateSet('Debug','Release')][string]$BuildType = 'Debug')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME -or $env:JAVA_HOME -like '*jdk-11*') {
    $StudioJdk = 'C:/Program Files/Android/Android Studio/jbr'
    if (Test-Path -LiteralPath $StudioJdk) { $env:JAVA_HOME = $StudioJdk }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if ($BuildType -eq 'Release' -and -not (Test-Path -LiteralPath "$Root/android/signing.properties")) {
    throw 'Create android/signing.properties using the instructions in docs/ANDROID_APP.md before building Release.'
}
Push-Location "$Root/android"
try {
    & ./gradlew.bat "assembleDevelopment$BuildType" "assembleProduction$BuildType" "lintDevelopment$BuildType" "lintProduction$BuildType"
    if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE" }
    $Version = (Get-Content -LiteralPath "$Root/package.json" -Raw | ConvertFrom-Json).version
    $Destination = "$Root/.tmp/android-artifacts"
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $Downloads = "$Root/public/downloads"
    $Manifest = @{ version = $Version; packages = @{} }
    if ($BuildType -eq 'Release') { New-Item -ItemType Directory -Force -Path $Downloads | Out-Null }
    foreach ($Flavor in @('development','production')) {
        $LowerType = $BuildType.ToLowerInvariant()
        Copy-Item -LiteralPath "$Root/android/app/build/outputs/apk/$Flavor/$LowerType/app-$Flavor-$LowerType.apk" -Destination "$Destination/StoreHub-$Version-$Flavor-$LowerType.apk"
        if ($BuildType -eq 'Release') {
            Copy-Item -LiteralPath "$Destination/StoreHub-$Version-$Flavor-$LowerType.apk" -Destination "$Downloads/storehub-$Flavor.apk"
            $Hasher = [System.Security.Cryptography.SHA256]::Create()
            try { $Digest = [BitConverter]::ToString($Hasher.ComputeHash([System.IO.File]::ReadAllBytes("$Downloads/storehub-$Flavor.apk"))).Replace('-', '').ToLowerInvariant() } finally { $Hasher.Dispose() }
            $Manifest.packages[$Flavor] = @{ path = "/downloads/storehub-$Flavor.apk"; sha256 = $Digest }
        }
    }
    if ($BuildType -eq 'Release') { [System.IO.File]::WriteAllText("$Downloads/android.json", ($Manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false))) }
    Write-Output "Android APKs: $Destination"
} finally { Pop-Location }
