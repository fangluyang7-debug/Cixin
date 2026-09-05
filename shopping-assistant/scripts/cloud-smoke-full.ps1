param(
  [string]$BaseUrl = "https://apiserver.zeabur.app",
  [string]$ImagePath = "",
  [string]$EnvFile = ".env",
  [string]$MaintenanceToken = "",
  [string]$OutFile = "",
  [switch]$RunSubjectAdjustment,
  [switch]$RunAnnDiagnose,
  [switch]$AllowZeroCandidates
)

$ErrorActionPreference = "Stop"

function Resolve-BaseUrl {
  param([string]$Value)
  if (-not $Value) {
    throw "BaseUrl is required"
  }
  return $Value.TrimEnd("/")
}

function Resolve-SmokeImagePath {
  param([string]$Value)

  if ($Value) {
    if (-not (Test-Path -LiteralPath $Value)) {
      throw "ImagePath does not exist: $Value"
    }
    return (Resolve-Path -LiteralPath $Value).Path
  }

  $local = Join-Path (Get-Location) "user_image_sample.jpg"
  if (Test-Path -LiteralPath $local) {
    return (Resolve-Path -LiteralPath $local).Path
  }

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $repoSample = Join-Path $repoRoot "user_image_sample.jpg"
  if (Test-Path -LiteralPath $repoSample) {
    return (Resolve-Path -LiteralPath $repoSample).Path
  }

  throw "ImagePath is required. Pass -ImagePath or put user_image_sample.jpg in the workspace root."
}

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }

  foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    $prefix = "$Key="
    if ($trimmed.StartsWith($prefix)) {
      return $trimmed.Substring($prefix.Length).Trim().Trim('"').Trim("'")
    }
  }

  return ""
}

function ConvertFrom-JsonOrRaw {
  param([string]$Content)

  if (-not $Content) {
    return $null
  }

  try {
    return $Content | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{
      raw = $Content
    }
  }
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null,
    [hashtable]$Headers = @{},
    [int]$TimeoutSec = 180
  )

  $uri = "$script:SmokeBaseUrl$Path"
  $requestHeaders = @{ "Accept" = "application/json" }
  foreach ($key in $Headers.Keys) {
    $requestHeaders[$key] = $Headers[$key]
  }

  $payload = $null
  if ($null -ne $Body) {
    $payload = $Body | ConvertTo-Json -Depth 30
    $requestHeaders["Content-Type"] = "application/json"
  }

  try {
    $response = Invoke-WebRequest `
      -Method $Method `
      -Uri $uri `
      -Headers $requestHeaders `
      -Body $payload `
      -UseBasicParsing `
      -TimeoutSec $TimeoutSec

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Body = ConvertFrom-JsonOrRaw -Content $response.Content
      Raw = $response.Content
    }
  } catch [System.Net.WebException] {
    $statusCode = 0
    $content = $_.ErrorDetails.Message
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      if (-not $content) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
      }
    }
    return [pscustomobject]@{
      StatusCode = $statusCode
      Body = ConvertFrom-JsonOrRaw -Content $content
      Raw = $content
    }
  }
}

function Assert-ApiSuccess {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)][string]$Step
  )

  if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 300) {
    throw "$Step failed with HTTP $($Response.StatusCode): $($Response.Raw)"
  }

  if ($Response.Body.success -ne $true) {
    $errorText = $Response.Body.error | ConvertTo-Json -Depth 10
    throw "$Step failed: response success is not true. error=$errorText"
  }
}

function Invoke-ImageUpload {
  param([string]$ResolvedImagePath)

  $args = @(
    "-sS",
    "-X", "POST",
    "$script:SmokeBaseUrl/api/v1/assets/images",
    "-H", "Accept: application/json",
    "-F", "variantType=compressed_recognition",
    "-F", "sourceType=demo",
    "-F", "isPrimaryRecognitionAsset=true",
    "-F", "clientContext={""smoke"":""cloud-full""}",
    "-F", "file=@$ResolvedImagePath;type=image/jpeg"
  )
  $content = & curl.exe @args
  if ($LASTEXITCODE -ne 0) {
    throw "image upload failed: curl exited with $LASTEXITCODE"
  }

  $body = ConvertFrom-JsonOrRaw -Content $content
  $response = [pscustomobject]@{
    StatusCode = 200
    Body = $body
    Raw = $content
  }
  Assert-ApiSuccess -Response $response -Step "image upload"
  return $response
}

function Parse-SseEvents {
  param([string]$Content)

  $events = @()
  $currentType = ""
  $lines = $Content -split "(`r`n|`n|`r)"
  foreach ($line in $lines) {
    if ($line.StartsWith("event:")) {
      $currentType = $line.Substring(6).Trim()
      continue
    }
    if ($line.StartsWith("data:")) {
      $json = $line.Substring(5).Trim()
      if (-not $json) {
        continue
      }
      $data = ConvertFrom-JsonOrRaw -Content $json
      $eventType = $currentType
      if (-not $eventType -and $data.type) {
        $eventType = [string]$data.type
      }
      $events += [pscustomobject]@{
        type = $eventType
        data = $data
      }
      $currentType = ""
    }
  }

  return $events
}

function Invoke-SearchEvents {
  param([string]$SessionId)

  $uri = "$script:SmokeBaseUrl/api/v1/sessions/$SessionId/search-events"
  try {
    $response = Invoke-WebRequest `
      -Method GET `
      -Uri $uri `
      -Headers @{ "Accept" = "text/event-stream" } `
      -UseBasicParsing `
      -TimeoutSec 90

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Events = @(Parse-SseEvents -Content $response.Content)
      Raw = $response.Content
    }
  } catch [System.Net.WebException] {
    $content = $_.ErrorDetails.Message
    if (-not $content -and $_.Exception.Response) {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
    }
    throw "search events failed: $content"
  }
}

function Get-NumberOrNull {
  param([object]$Value)
  if ($null -eq $Value) {
    return $null
  }
  if ($Value -is [double] -or $Value -is [float] -or $Value -is [int] -or $Value -is [decimal]) {
    return [double]$Value
  }
  $parsed = 0.0
  if ([double]::TryParse([string]$Value, [ref]$parsed)) {
    return $parsed
  }
  return $null
}

function Get-ObjectProperty {
  param(
    [object]$Object,
    [string]$Name
  )
  if ($null -eq $Object) {
    return $null
  }
  if ($Object.PSObject.Properties.Name -contains $Name) {
    return $Object.$Name
  }
  return $null
}

function Build-CandidateDiagnostics {
  param([array]$Items)

  $annScores = @()
  foreach ($item in $Items) {
    $matchSummary = Get-ObjectProperty -Object $item -Name "matchSummary"
    $score = Get-NumberOrNull -Value (Get-ObjectProperty -Object $matchSummary -Name "annScore")
    if ($null -ne $score) {
      $annScores += $score
    }
  }

  $maxAnnScore = $null
  if ($annScores.Count -gt 0) {
    $maxAnnScore = ($annScores | Measure-Object -Maximum).Maximum
  }

  $top = @()
  foreach ($item in ($Items | Select-Object -First 5)) {
    $matchSummary = Get-ObjectProperty -Object $item -Name "matchSummary"
    $top += [pscustomobject]@{
      candidateItemId = $item.candidateItemId
      title = $item.title
      platformName = $item.platformName
      amount = $item.price.amount
      annScore = Get-NumberOrNull -Value (Get-ObjectProperty -Object $matchSummary -Name "annScore")
      visualMatchConfidence = Get-NumberOrNull -Value (Get-ObjectProperty -Object $matchSummary -Name "visualMatchConfidence")
      sameProduct = Get-ObjectProperty -Object $matchSummary -Name "sameProduct"
    }
  }

  return [pscustomobject]@{
    count = $Items.Count
    annScoreCount = $annScores.Count
    maxAnnScore = $maxAnnScore
    nonZeroAnnScoreCount = @($annScores | Where-Object { $_ -gt 0 }).Count
    top = $top
  }
}

$script:SmokeBaseUrl = Resolve-BaseUrl -Value $BaseUrl
$resolvedImagePath = Resolve-SmokeImagePath -Value $ImagePath
$token = $MaintenanceToken
if (-not $token) {
  $token = Get-DotEnvValue -Path $EnvFile -Key "MAINTENANCE_API_TOKEN"
}

Write-Host "Cloud smoke target: $script:SmokeBaseUrl"
Write-Host "Smoke image: $resolvedImagePath"

$health = Invoke-Api -Method "GET" -Path "/api/v1/health" -TimeoutSec 30
Assert-ApiSuccess -Response $health -Step "health"

$stats = Invoke-Api -Method "GET" -Path "/api/v1/product-pool/stats" -TimeoutSec 60
Assert-ApiSuccess -Response $stats -Step "product pool stats"

$embeddedProducts = Invoke-Api -Method "GET" -Path "/api/v1/product-pool/products?limit=5&hasEmbedding=true" -TimeoutSec 60
Assert-ApiSuccess -Response $embeddedProducts -Step "embedded product list"

$batches = $null
if ($token) {
  $batches = Invoke-Api `
    -Method "GET" `
    -Path "/api/v1/product-pool/batches?limit=5" `
    -Headers @{ "x-maintenance-token" = $token } `
    -TimeoutSec 60
  Assert-ApiSuccess -Response $batches -Step "product import batches"
}

$asset = Invoke-ImageUpload -ResolvedImagePath $resolvedImagePath
$assetId = $asset.Body.data.assetId
if (-not $assetId) {
  throw "image upload did not return assetId"
}

$sessionBody = @{
  assetId = $assetId
  entrySource = "cloud_full_smoke"
  categoryHint = "shoe"
}
$session = Invoke-Api -Method "POST" -Path "/api/v1/sessions" -Body $sessionBody -TimeoutSec 240
Assert-ApiSuccess -Response $session -Step "session creation"
$sessionId = $session.Body.data.session.sessionId
if (-not $sessionId) {
  throw "session creation did not return sessionId"
}

$sessionRead = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId" -TimeoutSec 90
Assert-ApiSuccess -Response $sessionRead -Step "session read"

$preprocess = $sessionRead.Body.data.queryImagePreprocess
if (-not $preprocess) {
  throw "session read did not return queryImagePreprocess"
}
if (-not $preprocess.preprocessSnapshotId) {
  throw "queryImagePreprocess.preprocessSnapshotId is missing"
}

$candidates = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId/candidates" -TimeoutSec 120
Assert-ApiSuccess -Response $candidates -Step "candidate read"
$candidateItems = @($candidates.Body.data.items)
if (-not $AllowZeroCandidates -and $candidateItems.Count -lt 1) {
  throw "candidate read returned zero items"
}

$events = Invoke-SearchEvents -SessionId $sessionId
if ($events.StatusCode -lt 200 -or $events.StatusCode -ge 300) {
  throw "search events failed with HTTP $($events.StatusCode)"
}

$eventTypes = @($events.Events | ForEach-Object { $_.type } | Where-Object { $_ })
$requiredEventTypes = @("subject_detected", "embedding_ready", "candidate_batch")
foreach ($eventType in $requiredEventTypes) {
  if (-not ($eventTypes -contains $eventType)) {
    throw "search events missing required event type: $eventType"
  }
}

$subjectAdjustment = $null
if ($RunSubjectAdjustment) {
  $adjustmentBody = @{
    assetId = $assetId
    box = @{
      x = 0.08
      y = 0.05
      width = 0.84
      height = 0.82
    }
    selectionSource = "user_adjusted"
  }
  $adjustment = Invoke-Api `
    -Method "POST" `
    -Path "/api/v1/sessions/$sessionId/subject-selection" `
    -Body $adjustmentBody `
    -TimeoutSec 240
  Assert-ApiSuccess -Response $adjustment -Step "subject selection adjustment"

  $subjectSelection = $adjustment.Body.data.subjectSelection
  if (-not $subjectSelection.preprocessSnapshotId) {
    throw "subject selection did not return preprocessSnapshotId"
  }
  if (-not $subjectSelection.candidateSnapshotId) {
    throw "subject selection did not return candidateSnapshotId"
  }
  $subjectAdjustment = $subjectSelection
}

$annDiagnose = $null
if ($RunAnnDiagnose) {
  if (-not $token) {
    throw "RunAnnDiagnose requires MAINTENANCE_API_TOKEN in -MaintenanceToken or $EnvFile"
  }
  $annDiagnoseResponse = Invoke-Api `
    -Method "POST" `
    -Path "/api/v1/product-pool/ann/diagnose" `
    -Headers @{ "x-maintenance-token" = $token } `
    -Body @{
      assetId = $assetId
      topK = 5
      minScore = 0.68
      textHint = "shoe product image"
    } `
    -TimeoutSec 240
  Assert-ApiSuccess -Response $annDiagnoseResponse -Step "ann diagnose"
  $annDiagnose = $annDiagnoseResponse.Body.data
}

$candidateDiagnostics = Build-CandidateDiagnostics -Items $candidateItems
$summary = [ordered]@{
  success = $true
  baseUrl = $script:SmokeBaseUrl
  assetId = $assetId
  sessionId = $sessionId
  health = @{
    status = $health.Body.data.status
    service = $health.Body.data.service
  }
  productPool = $stats.Body.data
  embeddedProductSampleCount = @($embeddedProducts.Body.data.items).Count
  importBatchSampleCount = if ($batches) { @($batches.Body.data.items).Count } else { $null }
  productProfile = $sessionRead.Body.data.productProfile
  queryImagePreprocess = @{
    preprocessSnapshotId = $preprocess.preprocessSnapshotId
    status = $preprocess.status
    selectionSource = $preprocess.selectionSource
    selectedBox = $preprocess.selectedBox
    imageSize = $preprocess.imageSize
    embedding = $preprocess.embedding
    cropImageRef = $preprocess.cropImageRef
  }
  candidates = $candidateDiagnostics
  searchEvents = @{
    count = $events.Events.Count
    types = $eventTypes
  }
  optional = @{
    subjectAdjustment = $subjectAdjustment
    annDiagnose = $annDiagnose
  }
}

$summaryJson = $summary | ConvertTo-Json -Depth 30

if ($OutFile) {
  $outDir = Split-Path -Parent $OutFile
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
  }
  $summaryJson | Set-Content -Encoding UTF8 -LiteralPath $OutFile
  Write-Host "Cloud smoke summary written: $OutFile"
}

Write-Host $summaryJson
