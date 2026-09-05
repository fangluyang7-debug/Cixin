param(
  [string]$DataRoot = "E:\学习资料\data",
  [string]$BaseUrl = "https://apiserver.zeabur.app",
  [string]$BatchSource = "",
  [int]$GroupSize = 1000,
  [int]$BatchSize = 50,
  [int]$DemoCount = 1000,
  [string]$WorkRoot = "",
  [string]$GroupsRoot = "",
  [string]$DemoRoot = "",
  [string]$ExistingKeysFile = "",
  [switch]$SkipCloudKeyExport,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$nodeArgs = @(
  "scripts\prepare-product-pool-all-mixed-upload.mjs",
  "--data-root", $DataRoot,
  "--base-url", $BaseUrl,
  "--group-size", "$GroupSize",
  "--batch-size", "$BatchSize",
  "--demo-count", "$DemoCount"
)

if (-not [string]::IsNullOrWhiteSpace($BatchSource)) {
  $nodeArgs += @("--batch-source", $BatchSource)
}
if (-not [string]::IsNullOrWhiteSpace($WorkRoot)) {
  $nodeArgs += @("--work-root", $WorkRoot)
}
if (-not [string]::IsNullOrWhiteSpace($GroupsRoot)) {
  $nodeArgs += @("--groups-root", $GroupsRoot)
}
if (-not [string]::IsNullOrWhiteSpace($DemoRoot)) {
  $nodeArgs += @("--demo-root", $DemoRoot)
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
