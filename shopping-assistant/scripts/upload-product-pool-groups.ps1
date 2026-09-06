param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$GroupsRoot = "samples\product-pool\generated\collected_all_20260606-groups-1000x50",
  [int]$StartGroupIndex = 1,
  [int]$EndGroupIndex = 0,
  [int]$StartBatchIndex = 1,
  [int]$EndBatchIndex = 0,
  [int]$MaxConsecutiveBatchFailures = 3,
  [int]$MaxConsecutiveGroupFailures = 2,
  [int]$Concurrency = 6,
  [int]$TimeoutMs = 10000,
  [int]$WaitAttempts = 180,
  [int]$WaitIntervalMs = 5000,
  [int]$WaitTransientErrors = 30,
  [int]$ExpectEmbeddingsPerProduct = 1,
  $ContinueOnTimeout = $true,
  $WarnOnExpectationFailure = $false,
  $StandardizeImages = $true,
  [int]$ImageTargetSize = 320,
  [int]$ImageJpegQuality = 88,
  [int]$ImageStandardizeConcurrency = 4,
  [switch]$SkipImageVerify,
  [switch]$AllowImportErrors,
  [switch]$ContinueOnBatchFailure,
  [switch]$ContinueOnGroupFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$UploadGroupScript = Join-Path $ScriptDir "upload-product-pool-group.ps1"
Set-Location $RepoRoot

function ConvertTo-Bool {
  param(
    $Value,
    [bool]$Default = $true
  )

  if ($null -eq $Value) {
    return $Default
  }
  if ($Value -is [bool]) {
    return $Value
  }
  if ($Value -is [int]) {
    return $Value -ne 0
  }

  $text = [string]$Value
  if ($text -match '^(?i:true|1|yes|y)$') {
    return $true
  }
  if ($text -match '^(?i:false|0|no|n)$') {
    return $false
  }
  return $Default
}

$ContinueOnTimeout = ConvertTo-Bool $ContinueOnTimeout $true
$WarnOnExpectationFailure = ConvertTo-Bool $WarnOnExpectationFailure $false
$StandardizeImages = ConvertTo-Bool $StandardizeImages $true

$ResolvedGroupsRoot = Resolve-Path $GroupsRoot
$groupDirs = Get-ChildItem $ResolvedGroupsRoot -Directory |
  Where-Object { $_.Name -match '^group\d+$' } |
  Sort-Object Name

if ($groupDirs.Count -eq 0) {
  throw "No group directories found: $ResolvedGroupsRoot"
}

$selectedGroupDirs = @()
foreach ($groupDir in $groupDirs) {
  $match = [regex]::Match($groupDir.Name, '^group(\d+)$')
  if (-not $match.Success) {
    continue
  }

  $groupIndex = [int]$match.Groups[1].Value
  if ($groupIndex -lt $StartGroupIndex) {
    continue
  }
  if ($EndGroupIndex -gt 0 -and $groupIndex -gt $EndGroupIndex) {
    continue
  }
  $selectedGroupDirs += $groupDir
}

if ($selectedGroupDirs.Count -eq 0) {
  throw "No group directories selected from $ResolvedGroupsRoot"
}

$failureReportPath = Join-Path $ResolvedGroupsRoot "upload-group-failures.jsonl"
if (Test-Path $failureReportPath) {
  Remove-Item -LiteralPath $failureReportPath -Force
}

function Add-GroupFailure {
  param(
    [string]$GroupDir,
    [string]$Message
  )

  $failure = [ordered]@{
    failedAt = (Get-Date).ToUniversalTime().ToString("o")
    groupDir = $GroupDir
    message = $Message
  }
  $failure | ConvertTo-Json -Compress | Add-Content -Path $failureReportPath -Encoding UTF8
}

Write-Host "Repo root: $RepoRoot"
Write-Host "Groups root: $ResolvedGroupsRoot"
Write-Host "Selected groups: $($selectedGroupDirs.Count) of $($groupDirs.Count)"
Write-Host "Group range: $StartGroupIndex to $(if ($EndGroupIndex -gt 0) { $EndGroupIndex } else { 'end' })"
Write-Host "Base URL: $BaseUrl"
Write-Host "Continue on timeout: $ContinueOnTimeout"
Write-Host "Warn on expectation failure: $WarnOnExpectationFailure"
Write-Host "Standardize images before import: $StandardizeImages"
Write-Host "Image target size: $ImageTargetSize"
Write-Host "Max consecutive group failures: $MaxConsecutiveGroupFailures"

$consecutiveGroupFailures = 0

foreach ($groupDir in $selectedGroupDirs) {
  Write-Host ""
  Write-Host "Uploading group: $($groupDir.Name)"

  $continueOnTimeoutValue = if ($ContinueOnTimeout) { "1" } else { "0" }
  $warnOnExpectationFailureValue = if ($WarnOnExpectationFailure) { "1" } else { "0" }
  $standardizeImagesValue = if ($StandardizeImages) { "1" } else { "0" }

  $groupArgs = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $UploadGroupScript,
    "-BaseUrl",
    $BaseUrl,
    "-GroupDir",
    $groupDir.FullName,
    "-Concurrency",
    "$Concurrency",
    "-TimeoutMs",
    "$TimeoutMs",
    "-WaitAttempts",
    "$WaitAttempts",
    "-WaitIntervalMs",
    "$WaitIntervalMs",
    "-WaitTransientErrors",
    "$WaitTransientErrors",
    "-ExpectEmbeddingsPerProduct",
    "$ExpectEmbeddingsPerProduct",
    "-ContinueOnTimeout",
    $continueOnTimeoutValue,
    "-WarnOnExpectationFailure",
    $warnOnExpectationFailureValue,
    "-StandardizeImages",
    $standardizeImagesValue,
    "-ImageTargetSize",
    "$ImageTargetSize",
    "-ImageJpegQuality",
    "$ImageJpegQuality",
    "-ImageStandardizeConcurrency",
    "$ImageStandardizeConcurrency",
    "-MaxConsecutiveBatchFailures",
    "$MaxConsecutiveBatchFailures"
  )

  if ($groupDir.Name -eq "group$($StartGroupIndex.ToString('0000'))" -and $StartBatchIndex -gt 1) {
    $groupArgs += @("-StartBatchIndex", "$StartBatchIndex")
  }
  if ($EndGroupIndex -gt 0 -and $groupDir.Name -eq "group$($EndGroupIndex.ToString('0000'))" -and $EndBatchIndex -gt 0) {
    $groupArgs += @("-EndBatchIndex", "$EndBatchIndex")
  }
  if ($SkipImageVerify) {
    $groupArgs += @("-SkipImageVerify")
  }
  if ($AllowImportErrors) {
    $groupArgs += @("-AllowImportErrors")
  }
  if ($ContinueOnBatchFailure) {
    $groupArgs += @("-ContinueOnBatchFailure")
  }

  & powershell @groupArgs

  if ($LASTEXITCODE -ne 0) {
    $message = "Group upload failed: $($groupDir.FullName)"
    if ($ContinueOnGroupFailure) {
      Write-Warning $message
      Add-GroupFailure -GroupDir $groupDir.FullName -Message $message
      $consecutiveGroupFailures += 1
      if ($MaxConsecutiveGroupFailures -gt 0 -and $consecutiveGroupFailures -ge $MaxConsecutiveGroupFailures) {
        throw "Stopped after $consecutiveGroupFailures consecutive group failure(s). Last failure: $message"
      }
      continue
    }
    throw $message
  }

  $consecutiveGroupFailures = 0
}

if (Test-Path $failureReportPath) {
  Write-Warning "Upload completed with skipped group failure(s). Report: $failureReportPath"
} else {
  Write-Host ""
  Write-Host "All selected groups uploaded."
}
