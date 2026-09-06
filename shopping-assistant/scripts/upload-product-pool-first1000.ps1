$ErrorActionPreference = "Stop"

$BaseUrl = "http://localhost:3000"
$SourceFile = "samples\product-pool\generated\collected_shoes_20260605-full.json"
$ChunkSize = 50
$MaxChunks = 20
$ChunkDir = "samples\product-pool\generated\collected_shoes_20260605-first1000-chunks-50"
$VerifiedDir = "samples\product-pool\generated\collected_shoes_20260605-first1000-verified-50"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "Repo root: $RepoRoot"
Write-Host "Plan: import $($ChunkSize * $MaxChunks) items, $ChunkSize items per batch"
Write-Host "Check: require at least 2 embeddings per imported product"

New-Item -ItemType Directory -Force -Path $ChunkDir | Out-Null
New-Item -ItemType Directory -Force -Path $VerifiedDir | Out-Null

npm run product-pool:split -- `
  --file $SourceFile `
  --chunk-size $ChunkSize `
  --max-chunks $MaxChunks `
  --out-dir $ChunkDir

if ($LASTEXITCODE -ne 0) {
  throw "Split payload failed: $SourceFile"
}

Get-ChildItem $ChunkDir -Filter *.json |
  Sort-Object Name |
  ForEach-Object {
    $chunkFile = $_.FullName
    $baseName = $_.BaseName
    $verifiedFile = Join-Path $VerifiedDir "$baseName-image-verified.json"
    $invalidFile = Join-Path $VerifiedDir "$baseName-image-invalid.jsonl"
    $reportFile = Join-Path $VerifiedDir "$baseName-image-verify-report.json"

    Write-Host "Verifying images: $($_.Name)"

    npm run product-pool:verify-links -- `
      --file $chunkFile `
      --out-valid $verifiedFile `
      --out-invalid $invalidFile `
      --out-report $reportFile `
      --skip-product `
      --concurrency 6 `
      --timeout-ms 10000 `
      --retries 1

    if ($LASTEXITCODE -ne 0) {
      throw "Image verification failed: $chunkFile"
    }

    Write-Host "Importing to cloud: $baseName"

    node scripts\import-product-pool.mjs `
      --file $verifiedFile `
      --base-url $BaseUrl `
      --env-file .env `
      --wait `
      --wait-attempts 90 `
      --wait-interval-ms 5000 `
      --wait-transient-errors 30 `
      --fail-on-import-errors `
      --expect-embeddings-per-product 2

    if ($LASTEXITCODE -ne 0) {
      throw "Cloud import failed: $verifiedFile"
    }

    Start-Sleep -Seconds 2
  }
