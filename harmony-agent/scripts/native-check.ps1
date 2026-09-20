param(
  [Parameter(Mandatory=$true)][string]$StudioHome,
  [ValidateSet('build','test','all')][string]$Task = 'all'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/harmony'))
$node = Join-Path $StudioHome 'tools/node/node.exe'
$hvigor = Join-Path $StudioHome 'tools/hvigor/bin/hvigorw.js'
$ohpm = Join-Path $StudioHome 'tools/ohpm/bin/ohpm.bat'
foreach ($tool in @($node,$hvigor,$ohpm)) {
  if (-not (Test-Path -LiteralPath $tool)) { throw "Missing DevEco tool: $tool" }
}
$previousSdk = $env:DEVECO_SDK_HOME
$previousJava = $env:JAVA_HOME
Push-Location $projectRoot
try {
  $env:DEVECO_SDK_HOME = Join-Path $StudioHome 'sdk'
  $env:JAVA_HOME = Join-Path $StudioHome 'jbr'
  & $ohpm install
  if ($LASTEXITCODE -ne 0) { throw 'ohpm install failed' }
  if ($Task -ne 'test') {
    & $node $hvigor --mode module -p module=entry@default -p product=default -p requiredDeviceType=phone assembleHap --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'HAP build failed' }
    & $node $hvigor --mode module -p module=scheduler@default -p product=default assembleHar --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'HAR build failed' }
  }
  if ($Task -ne 'build') {
    $testStarted = Get-Date
    & $node $hvigor --mode module -p module=scheduler@default -p product=default test --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Native unit tests failed' }
    $report = Join-Path $projectRoot 'scheduler/.test/default/intermediates/test/coverage_data/test_result.txt'
    if (-not (Test-Path -LiteralPath $report)) { throw 'Scheduler test report missing' }
    if ((Get-Item -LiteralPath $report).LastWriteTime -lt $testStarted) { throw 'Scheduler test report is stale' }
    $results = Get-Content -LiteralPath $report -Raw
    $summary = [regex]::Match($results, 'Tests run: (\d+), Failure: (\d+), Error: (\d+), Pass: (\d+), Ignore: (\d+)')
    if (-not $summary.Success -or [int]$summary.Groups[1].Value -lt 26 -or
        [int]$summary.Groups[2].Value -ne 0 -or [int]$summary.Groups[3].Value -ne 0 -or
        [int]$summary.Groups[4].Value -ne [int]$summary.Groups[1].Value -or [int]$summary.Groups[5].Value -ne 0) {
      throw "Scheduler cases did not all pass: $results"
    }
    Write-Output $summary.Value
  }
} finally {
  Pop-Location
  $env:DEVECO_SDK_HOME = $previousSdk
  $env:JAVA_HOME = $previousJava
}
