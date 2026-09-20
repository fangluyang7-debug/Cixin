param(
  [Parameter(Mandatory = $true)]
  [string]$DevEcoHome
)

$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/harmony'))
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../docs/testing'))
$nodePath = Join-Path $DevEcoHome 'tools/node/node.exe'
$hvigorPath = Join-Path $DevEcoHome 'tools/hvigor/bin/hvigorw.js'
$ohpmPath = Join-Path $DevEcoHome 'tools/ohpm/bin/ohpm.bat'
if (!(Test-Path -LiteralPath $nodePath) -or !(Test-Path -LiteralPath $hvigorPath) -or !(Test-Path -LiteralPath $ohpmPath)) {
  throw 'DevEcoHome must point to a DevEco Studio installation.'
}
$env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
$env:Path = (Join-Path $DevEcoHome 'jbr/bin') + ';' + $env:Path

$coupling = Get-ChildItem -LiteralPath (Join-Path $appRoot 'scheduler/src/main') -Recurse -Filter '*.ets' |
  Select-String -Pattern 'camera_lens|product_search|product_embedding|chat_intent|category_rerank|background_index|from.+entry/'
if ($coupling) { throw 'Application-specific dependency found in the scheduler core.' }

Push-Location -LiteralPath $appRoot
try {
  & $ohpmPath install
  if ($LASTEXITCODE -ne 0) { throw 'ohpm install failed.' }

  & $nodePath $hvigorPath --mode module -p module=scheduler@default -p product=default test --no-daemon 2>&1 |
    Tee-Object -FilePath (Join-Path $evidenceRoot 'semantic-unit-build.log')
  if ($LASTEXITCODE -ne 0) { throw 'Scheduler test compilation or runner failed.' }
  $resultPath = Join-Path $appRoot 'scheduler/.test/default/intermediates/test/coverage_data/test_result.txt'
  $testOutput = Get-Content -LiteralPath $resultPath -Raw
  $summary = [regex]::Match($testOutput, 'Tests run: (\d+), Failure: (\d+), Error: (\d+), Pass: (\d+), Ignore: (\d+)')
  if (!$summary.Success -or [int]$summary.Groups[1].Value -eq 0 -or
      [int]$summary.Groups[2].Value -ne 0 -or [int]$summary.Groups[3].Value -ne 0) {
    throw 'Hypium reports failed tests or no usable result, even if Hvigor reports BUILD SUCCESSFUL.'
  }
  Copy-Item -LiteralPath $resultPath -Destination (Join-Path $evidenceRoot 'semantic-test-result.txt')
  Write-Output $summary.Value
} finally {
  Pop-Location
}
