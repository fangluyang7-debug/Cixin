param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$EnvFile = ".env",
  [int]$StartGroupIndex = 14,
  [int]$EndGroupIndex = 0,
  [int]$PageSize = 200,
  [int]$MaxPages = 20,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$envPath = Resolve-Path $EnvFile
$maintenanceToken = Get-Content $envPath |
  Where-Object { $_ -match '^MAINTENANCE_API_TOKEN=' } |
  ForEach-Object { $_.Split('=', 2)[1].Trim().Trim('"').Trim("'") } |
  Select-Object -First 1

if (-not $maintenanceToken) {
  throw "MAINTENANCE_API_TOKEN not found in $envPath"
}

$headers = @{ "x-maintenance-token" = $maintenanceToken }
$base = $BaseUrl.TrimEnd("/")
$badBatches = @()

for ($page = 0; $page -lt $MaxPages; $page += 1) {
  $offset = $page * $PageSize
  $url = "$base/api/v1/product-pool/batches?limit=$PageSize&offset=$offset&status=completed_with_errors"
  $response = Invoke-RestMethod -Uri $url -Headers $headers
  $items = @($response.data.items)
  if ($items.Count -eq 0) {
    break
  }

  foreach ($batch in $items) {
    $match = [regex]::Match($batch.batchSource, '^collected_all_20260606_group(\d{4})_batch\d{4}_verified$')
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

    if (
      [int]$batch.succeededCount -eq 0 -and
      [int]$batch.failedCount -gt 0 -and
      [int]$batch.embeddingCount -eq 0
    ) {
      $badBatches += $batch
    }
  }
}

$badBatches = $badBatches | Sort-Object batchSource

Write-Host "Mode: $(if ($Apply) { 'DELETE' } else { 'DRY RUN' })"
Write-Host "Bad batches: $($badBatches.Count)"

if ($badBatches.Count -eq 0) {
  return
}

$badBatches |
  Select-Object batchId, batchSource, totalCount, succeededCount, failedCount, productCount, embeddingCount |
  Format-Table -AutoSize

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run only. Add -Apply to delete these failed batches."
  return
}

foreach ($batch in $badBatches) {
  Write-Host "Deleting failed batch: $($batch.batchSource)"
  $body = @{ batchId = $batch.batchId; dryRun = $false } | ConvertTo-Json
  Invoke-RestMethod `
    -Uri "$base/api/v1/product-pool/batches/delete" `
    -Method Post `
    -ContentType "application/json" `
    -Headers $headers `
    -Body $body |
    ConvertTo-Json -Depth 10
}
