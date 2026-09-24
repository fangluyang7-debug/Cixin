param(
  [string]$BaseUrl = "https://apiserver.zeabur.app",
  [string]$GroupDir = "samples\product-pool\generated\collected_all_20260606-groups-1000x50\group0001",
  [int]$Concurrency = 6,
  [int]$TimeoutMs = 10000,
  [int]$WaitAttempts = 90,
  [int]$WaitIntervalMs = 5000,
  [int]$WaitTransientErrors = 30,
  [int]$ExpectEmbeddingsPerProduct = 1,
  [int]$StartBatchIndex = 1,
  [int]$EndBatchIndex = 0,
  [int]$MaxConsecutiveBatchFailures = 3,
  $ContinueOnTimeout = $true,
  $WarnOnExpectationFailure = $false,
  $StandardizeImages = $true,
  [int]$ImageTargetSize = 320,
  [int]$ImageJpegQuality = 88,
  [int]$ImageStandardizeConcurrency = 4,
  [switch]$SkipImageVerify,
  [switch]$AllowImportErrors,
  [switch]$ContinueOnBatchFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
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

$ResolvedGroupDir = Resolve-Path $GroupDir
$BatchDir = Join-Path $ResolvedGroupDir "batches"
$VerifiedDir = Join-Path $ResolvedGroupDir "verified"

if (-not (Test-Path $BatchDir)) {
  throw "Batch directory not found: $BatchDir"
}

New-Item -ItemType Directory -Force -Path $VerifiedDir | Out-Null

$allBatchFiles = Get-ChildItem $BatchDir -Filter *.json | Sort-Object Name
$batchFiles = @()
for ($index = 0; $index -lt $allBatchFiles.Count; $index += 1) {
  $batchIndex = $index + 1
  if ($batchIndex -lt $StartBatchIndex) {
    continue
  }
  if ($EndBatchIndex -gt 0 -and $batchIndex -gt $EndBatchIndex) {
    continue
  }
  $batchFiles += $allBatchFiles[$index]
}
if ($batchFiles.Count -eq 0) {
  throw "No batch JSON files found: $BatchDir"
}

Write-Host "Repo root: $RepoRoot"
Write-Host "Group dir: $ResolvedGroupDir"
Write-Host "Batch files: $($batchFiles.Count) of $($allBatchFiles.Count)"
Write-Host "Batch range: $StartBatchIndex to $(if ($EndBatchIndex -gt 0) { $EndBatchIndex } else { 'end' })"
Write-Host "Base URL: $BaseUrl"
Write-Host "Continue on batch failure: $ContinueOnBatchFailure"
Write-Host "Continue on timeout: $ContinueOnTimeout"
Write-Host "Warn on expectation failure: $WarnOnExpectationFailure"
Write-Host "Standardize images before import: $StandardizeImages"
Write-Host "Image target size: $ImageTargetSize"
Write-Host "Max consecutive batch failures: $MaxConsecutiveBatchFailures"

$failureReportPath = Join-Path $VerifiedDir "upload-failures.jsonl"
if (Test-Path $failureReportPath) {
  Remove-Item -LiteralPath $failureReportPath -Force
}

function Add-UploadFailure {
  param(
    [string]$Stage,
    [string]$BatchFile,
    [string]$ImportFile,
    [string]$Message
  )

  $failure = [ordered]@{
    failedAt = (Get-Date).ToUniversalTime().ToString("o")
    stage = $Stage
    batchFile = $BatchFile
    importFile = $ImportFile
    message = $Message
  }
  $failure | ConvertTo-Json -Compress | Add-Content -Path $failureReportPath -Encoding UTF8
}

$consecutiveBatchFailures = 0

foreach ($file in $batchFiles) {
  $batchFile = $file.FullName
  $baseName = $file.BaseName
  $verifiedFile = Join-Path $VerifiedDir "$baseName-image-verified.json"
  $invalidFile = Join-Path $VerifiedDir "$baseName-image-invalid.jsonl"
  $reportFile = Join-Path $VerifiedDir "$baseName-image-verify-report.json"

  if ($SkipImageVerify) {
    $importFile = $batchFile
  } else {
    Write-Host "Verifying images: $($file.Name)"

    npm run product-pool:verify-links -- `
      --file $batchFile `
      --out-valid $verifiedFile `
      --out-invalid $invalidFile `
      --out-report $reportFile `
      --skip-product `
      --concurrency $Concurrency `
      --timeout-ms $TimeoutMs `
      --retries 1

    if ($LASTEXITCODE -ne 0) {
      $message = "Image verification failed: $batchFile"
      if ($ContinueOnBatchFailure) {
        Write-Warning $message
        Add-UploadFailure -Stage "verify_images" -BatchFile $batchFile -ImportFile "" -Message $message
        $consecutiveBatchFailures += 1
        if ($MaxConsecutiveBatchFailures -gt 0 -and $consecutiveBatchFailures -ge $MaxConsecutiveBatchFailures) {
          throw "Stopped after $consecutiveBatchFailures consecutive batch failure(s). Last failure: $message"
        }
        continue
      }
      throw $message
    }

    $importFile = $verifiedFile
  }

  Write-Host "Importing to cloud: $baseName"

  $importArgs = @(
    "scripts\import-product-pool.mjs",
    "--file", $importFile,
    "--base-url", $BaseUrl,
    "--env-file", ".env",
    "--wait",
    "--wait-attempts", "$WaitAttempts",
    "--wait-interval-ms", "$WaitIntervalMs",
    "--wait-transient-errors", "$WaitTransientErrors"
  )

  if (-not $AllowImportErrors) {
    $importArgs += @("--fail-on-import-errors")
  }

  if ($ExpectEmbeddingsPerProduct -gt 0) {
    $importArgs += @("--expect-embeddings-per-product", "$ExpectEmbeddingsPerProduct")
  }
  if ($ContinueOnTimeout) {
    $importArgs += @("--continue-on-wait-timeout")
  }
  if ($WarnOnExpectationFailure) {
    $importArgs += @("--warn-on-expectation-failure")
  }
  if ($StandardizeImages) {
    $importArgs += @(
      "--standardize-images",
      "--image-target-size", "$ImageTargetSize",
      "--image-jpeg-quality", "$ImageJpegQuality",
      "--image-standardize-concurrency", "$ImageStandardizeConcurrency"
    )
  }

  node @importArgs

  if ($LASTEXITCODE -ne 0) {
    $message = "Cloud import failed: $importFile"
    if ($ContinueOnBatchFailure) {
      Write-Warning $message
      Add-UploadFailure -Stage "cloud_import" -BatchFile $batchFile -ImportFile $importFile -Message $message
      $consecutiveBatchFailures += 1
      if ($MaxConsecutiveBatchFailures -gt 0 -and $consecutiveBatchFailures -ge $MaxConsecutiveBatchFailures) {
        throw "Stopped after $consecutiveBatchFailures consecutive batch failure(s). Last failure: $message"
      }
      continue
    }
    throw $message
  }

  $consecutiveBatchFailures = 0
  Start-Sleep -Seconds 2
}

if (Test-Path $failureReportPath) {
  Write-Warning "Upload completed with skipped batch failure(s). Report: $failureReportPath"
}
