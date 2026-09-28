param(
  [string]$ProjectRoot = "",
  [string]$DevEcoHome = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Join-Path $PSScriptRoot "..\03-源代码\shopping-assistant"
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$AppsRoot = Join-Path $ProjectRoot "apps"

if (-not (Test-Path -LiteralPath $AppsRoot)) {
  throw "Cannot find HarmonyOS project: $AppsRoot"
}

if ([string]::IsNullOrWhiteSpace($DevEcoHome)) {
  $candidates = @(
    $env:DEVECO_HOME,
    "E:\DevEco\DevEco Studio",
    (Join-Path $env:ProgramFiles "Huawei\DevEco Studio"),
    (Join-Path $env:LOCALAPPDATA "Programs\DevEco Studio")
  )
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and
        (Test-Path -LiteralPath (Join-Path $candidate "tools\hvigor\bin\hvigorw.bat"))) {
      $DevEcoHome = $candidate
      break
    }
  }
}

if ([string]::IsNullOrWhiteSpace($DevEcoHome)) {
  throw "DevEco Studio was not found. Pass -DevEcoHome with its installation directory."
}

$Hvigor = Join-Path $DevEcoHome "tools\hvigor\bin\hvigorw.bat"
$Ohpm = Join-Path $DevEcoHome "tools\ohpm\bin\ohpm.bat"
$NodeHome = Join-Path $DevEcoHome "tools\node"
$SdkHome = Join-Path $DevEcoHome "sdk"

foreach ($required in @($Hvigor, $Ohpm, $NodeHome, $SdkHome)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Missing DevEco Studio component: $required"
  }
}

$env:DEVECO_SDK_HOME = $SdkHome
$env:PATH = "$NodeHome;$(Split-Path $Ohpm);$env:PATH"

$Artifacts = Join-Path $PSScriptRoot "artifacts"
New-Item -ItemType Directory -Path $Artifacts -Force | Out-Null
$TestLog = Join-Path $Artifacts "scheduler-unit-test.log"

Push-Location $AppsRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $AppsRoot "oh_modules"))) {
    & $Ohpm install --all
    if ($LASTEXITCODE -ne 0) {
      throw "OHPM dependency installation failed."
    }
  }

  & $Hvigor clean --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Hvigor clean failed."
  }

  & $Hvigor test --mode module -p module=scheduler@default -p product=default --no-daemon --stacktrace 2>&1 |
    Tee-Object -FilePath $TestLog
  if ($LASTEXITCODE -ne 0 -or
      (Select-String -LiteralPath $TestLog -Pattern "hvigor ERROR: Error in" -Quiet)) {
    throw "Scheduler unit tests failed. See $TestLog"
  }

  & $Hvigor assembleHap --mode module -p module=entry@default -p product=default --no-daemon --stacktrace
  if ($LASTEXITCODE -ne 0) {
    throw "HAP build failed."
  }

  & $Hvigor assembleHar --mode module -p module=scheduler@default -p product=default --no-daemon --stacktrace
  if ($LASTEXITCODE -ne 0) {
    throw "HAR build failed."
  }

  $Hap = Join-Path $AppsRoot "entry\build\default\outputs\default\entry-default-unsigned.hap"
  $Har = Join-Path $AppsRoot "scheduler\build\default\outputs\default\scheduler.har"
  Copy-Item -LiteralPath $Hap -Destination $Artifacts -Force
  Copy-Item -LiteralPath $Har -Destination $Artifacts -Force

  Write-Host ""
  Write-Host "Build and tests completed successfully." -ForegroundColor Green
  Write-Host "Artifacts: $Artifacts"
  Write-Host "The HAP is unsigned until a team signing configuration is supplied."
}
finally {
  Pop-Location
}
