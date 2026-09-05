param(
  [string]$DataRoot = "",
  [string]$BaseUrl = "https://apiserver.zeabur.app",
  [string]$BatchSource = "",
  [int]$PerPlatformLimit = 1000,
  [int]$GroupSize = 1000,
  [int]$BatchSize = 50,
  [int]$NormalizeMaxItemsPerPlatform = 0,
  [string]$OutRoot = "",
  [string]$ExistingKeysFile = "",
  [switch]$SkipCloudKeyExport,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$nodeArgs = @(
  "scripts\prepare-product-pool-balanced-upload.mjs",
  "--base-url", $BaseUrl,
  "--per-platform-limit", "$PerPlatformLimit",
  "--group-size", "$GroupSize",
  "--batch-size", "$BatchSize",
  "--normalize-max-items-per-platform", "$NormalizeMaxItemsPerPlatform"
)

if (-not [string]::IsNullOrWhiteSpace($DataRoot)) {
  $nodeArgs += @("--data-root", $DataRoot)
}
if (-not [string]::IsNullOrWhiteSpace($BatchSource)) {
  $nodeArgs += @("--batch-source", $BatchSource)
}
if (-not [string]::IsNullOrWhiteSpace($OutRoot)) {
  $nodeArgs += @("--out-root", $OutRoot)
}
if (-not [string]::IsNullOrWhiteSpace($ExistingKeysFile)) {
  $nodeArgs += @("--existing-keys-file", $ExistingKeysFile)
}
if ($SkipCloudKeyExport) {
  $nodeArgs += "--skip-cloud-key-export"
}
if ($Clean) {
  $nodeArgs += "--clean"
}

node @nodeArgs
exit $LASTEXITCODE
