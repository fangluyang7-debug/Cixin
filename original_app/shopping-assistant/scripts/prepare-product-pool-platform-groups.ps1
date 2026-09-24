param(
  [string]$DataDir = "..\data",
  [string]$BatchSource = "",
  [int]$PerPlatformLimit = 1000,
  [int]$GroupSize = 1000,
  [int]$BatchSize = 50,
  [string]$OutRoot = "",
  [string]$Platforms = "",
  [switch]$OnlyShoes,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($BatchSource)) {
  $BatchSource = "collected_all_$(Get-Date -Format yyyyMMdd)"
}

$GeneratedRoot = Join-Path $RepoRoot "samples\product-pool\generated"
$FullJson = Join-Path $GeneratedRoot "$BatchSource-full.json"
$FirstJson = Join-Path $GeneratedRoot "$BatchSource-first80.json"
$RejectedJsonl = Join-Path $GeneratedRoot "$BatchSource-rejected.jsonl"
$ReportJson = Join-Path $GeneratedRoot "$BatchSource-normalize-report.json"

if ([string]::IsNullOrWhiteSpace($OutRoot)) {
  $OutRoot = Join-Path $GeneratedRoot "$BatchSource-by-platform-first$PerPlatformLimit-$GroupSize`x$BatchSize"
}

Write-Host "Repo root: $RepoRoot"
Write-Host "Data dir: $DataDir"
Write-Host "Batch source: $BatchSource"
Write-Host "Full JSON: $FullJson"
Write-Host "Platform groups root: $OutRoot"

$normalizeArgs = @(
  "scripts\normalize-collected-products.mjs",
  "--dir", $DataDir,
  "--batch-source", $BatchSource,
  "--out-full", $FullJson,
  "--out-first", $FirstJson,
  "--out-rejected", $RejectedJsonl,
  "--out-report", $ReportJson
)

if ($OnlyShoes) {
  $normalizeArgs += "--only-shoes"
}

Write-Host ""
Write-Host "Normalizing JSON/Excel/CSV files..."
node @normalizeArgs
if ($LASTEXITCODE -ne 0) {
  throw "Normalize failed."
}

$splitArgs = @(
  "scripts\split-product-pool-by-platform.mjs",
  "--file", $FullJson,
  "--out-root", $OutRoot,
  "--group-size", "$GroupSize",
  "--batch-size", "$BatchSize"
)

if ($PerPlatformLimit -gt 0) {
  $splitArgs += @("--per-platform-limit", "$PerPlatformLimit")
}
if (-not [string]::IsNullOrWhiteSpace($Platforms)) {
  $splitArgs += @("--platforms", $Platforms)
}
if ($Clean) {
  $splitArgs += "--clean"
}

Write-Host ""
Write-Host "Splitting by platform..."
node @splitArgs
if ($LASTEXITCODE -ne 0) {
  throw "Platform split failed."
}

Write-Host ""
Write-Host "Done."
Write-Host "Use this root with upload-product-pool-groups.ps1:"
Write-Host $OutRoot
