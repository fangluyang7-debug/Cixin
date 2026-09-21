param(
  [Parameter(Mandatory = $true)]
  [string]$DevEcoHome
)

$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/harmony'))
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../docs/testing'))
$coupling = Get-ChildItem -LiteralPath (Join-Path $appRoot 'scheduler/src/main') -Recurse -Filter '*.ets' |
  Select-String -Pattern 'camera_lens|product_search|product_embedding|chat_intent|category_rerank|background_index|from.+entry/'
if ($coupling) { throw 'Application-specific dependency found in the scheduler core.' }

# The shared gate checks report freshness, all declared cases, and no failures or ignored cases.
& (Join-Path $PSScriptRoot 'native-check.ps1') -StudioHome $DevEcoHome -Task test |
  Tee-Object -FilePath (Join-Path $evidenceRoot 'semantic-unit-build.log')
$resultPath = Join-Path $appRoot 'scheduler/.test/default/intermediates/test/coverage_data/test_result.txt'
Copy-Item -LiteralPath $resultPath -Destination (Join-Path $evidenceRoot 'semantic-test-result.txt')
$entryResultPath = Join-Path $appRoot 'entry/.test/default/intermediates/test/coverage_data/test_result.txt'
Copy-Item -LiteralPath $entryResultPath -Destination (Join-Path $evidenceRoot 'entry-test-result.txt')
