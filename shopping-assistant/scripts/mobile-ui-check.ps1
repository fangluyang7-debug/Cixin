param(
  [string]$DeviceId = "emulator-5554",
  [string]$AppId = "com.xieluyao.shoppingassistant.shopping_assistant_mobile.dev",
  [string]$Activity = "com.xieluyao.shoppingassistant.shopping_assistant_mobile.MainActivity",
  [string]$Flutter = "E:\Scoop\apps\flutter\current\bin\flutter.bat",
  [string]$ProjectDir = "D:\shopping-assistant\apps\mobile-flutter",
  [string]$ScreenshotDir = "D:\shopping-assistant\artifacts\mobile-ui-checks",
  [string]$ScreenshotName = "",
  [int]$LaunchDelaySeconds = 4,
  [switch]$SkipFormat,
  [switch]$SkipAnalyze,
  [switch]$SkipBuild,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-DeviceId {
  param([string]$RequestedDeviceId)

  if ($RequestedDeviceId.Trim().Length -gt 0) {
    $deviceId = $RequestedDeviceId.Trim()
    $isOnline = adb devices |
      Select-String -Pattern ("^{0}\s+device$" -f [regex]::Escape($deviceId))
    if ($null -eq $isOnline) {
      throw "Android Emulator device is not online: $deviceId. Start Pixel_API_35 first."
    }
    return $deviceId
  }

  throw "DeviceId is required. Use emulator-5554 for the default Android Emulator workflow."
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )

  Write-Host "==> $Title"
  & $Action
}

$ResolvedDeviceId = Resolve-DeviceId -RequestedDeviceId $DeviceId
$ApkPath = Join-Path $ProjectDir "build\app\outputs\flutter-apk\app-debug.apk"
$Dart = Join-Path (Split-Path $Flutter -Parent) "dart.bat"

if (-not (Test-Path $Flutter)) {
  throw "Flutter executable not found: $Flutter"
}

if (-not (Test-Path $Dart)) {
  throw "Dart executable not found: $Dart"
}

if (-not (Test-Path $ProjectDir)) {
  throw "Flutter project not found: $ProjectDir"
}

New-Item -ItemType Directory -Force -Path $ScreenshotDir | Out-Null

Push-Location $ProjectDir
try {
  if (-not $SkipFormat) {
    Invoke-Step "dart format lib\main.dart" {
      & $Dart "format" "lib\main.dart"
    }
  }

  if (-not $SkipAnalyze) {
    Invoke-Step "flutter analyze" {
      & $Flutter "analyze"
    }
  }

  if (-not $SkipBuild) {
    Invoke-Step "flutter build apk --debug" {
      & $Flutter "build" "apk" "--debug"
    }
  }

  if (-not $SkipInstall) {
    if (-not (Test-Path $ApkPath)) {
      throw "Debug APK missing: $ApkPath"
    }

    Invoke-Step "adb install -r" {
      adb -s $ResolvedDeviceId install -r $ApkPath
    }
  }

  Invoke-Step "adb start app" {
    adb -s $ResolvedDeviceId shell am start -n "$AppId/$Activity"
  }

  Start-Sleep -Seconds $LaunchDelaySeconds

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  if ($ScreenshotName.Trim().Length -eq 0) {
    $ScreenshotName = "screen-$timestamp.png"
  }
  if (-not $ScreenshotName.EndsWith(".png")) {
    $ScreenshotName = "$ScreenshotName.png"
  }

  $remotePath = "/sdcard/codex_mobile_ui_check.png"
  $localPath = Join-Path $ScreenshotDir $ScreenshotName

  Invoke-Step "adb screencap" {
    adb -s $ResolvedDeviceId shell screencap -p $remotePath
    adb -s $ResolvedDeviceId pull $remotePath $localPath
    adb -s $ResolvedDeviceId shell rm $remotePath
  }

  $result = [ordered]@{
    device = $ResolvedDeviceId
    appId = $AppId
    apk = $ApkPath
    screenshot = $localPath
  }

  Write-Host "==> UI check complete"
  $result | ConvertTo-Json -Depth 3
} finally {
  Pop-Location
}
