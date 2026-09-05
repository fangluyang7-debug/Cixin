param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null
  )

  $uri = "$BaseUrl$Path"
  $headers = @{ "Accept" = "application/json" }
  $payload = $null

  if ($null -ne $Body) {
    $payload = $Body | ConvertTo-Json -Depth 10
    $headers["Content-Type"] = "application/json"
  }

  try {
    $response = Invoke-WebRequest -Method $Method -Uri $uri -Headers $headers -Body $payload -UseBasicParsing
    $content = $response.Content
    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Body = $content | ConvertFrom-Json
    }
  } catch [System.Net.WebException] {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $content = $_.ErrorDetails.Message
    if (-not $content) {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
    }
    return [pscustomobject]@{
      StatusCode = $statusCode
      Body = $content | ConvertFrom-Json
    }
  }
}

function Assert-Ok {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)][string]$Step
  )

  if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 300) {
    throw "$Step failed with HTTP $($Response.StatusCode)"
  }

  if ($Response.Body.success -ne $true) {
    throw "$Step failed: success is not true"
  }
}

function Assert-Error {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)][string]$ExpectedCode,
    [Parameter(Mandatory = $true)][string]$Step
  )

  if ($Response.StatusCode -lt 400) {
    throw "$Step failed: expected an error response"
  }

  if ($Response.Body.success -ne $false) {
    throw "$Step failed: success is not false"
  }

  if ($Response.Body.error.code -ne $ExpectedCode) {
    throw "$Step failed: expected $ExpectedCode, got $($Response.Body.error.code)"
  }
}

$health = Invoke-Api -Method "GET" -Path "/api/v1/health"
Assert-Ok -Response $health -Step "health"

$assetBody = @{
  variantType = "compressed_recognition"
  sourceType = "demo"
  clientContext = @{ smoke = "day1-p0" }
}
$asset = Invoke-Api -Method "POST" -Path "/api/v1/assets/images" -Body $assetBody
Assert-Ok -Response $asset -Step "image asset registration"

$tempImagePath = Join-Path $env:TEMP "shopping-assistant-smoke-image.jpg"
[System.IO.File]::WriteAllBytes($tempImagePath, [byte[]](0xff, 0xd8, 0xff, 0xd9))
$multipartContent = & curl.exe -s -X POST "$BaseUrl/api/v1/assets/images" `
  -F "variantType=demo_asset" `
  -F "sourceType=demo" `
  -F "file=@$tempImagePath;type=image/jpeg"
$multipartAsset = $multipartContent | ConvertFrom-Json
if ($multipartAsset.success -ne $true) {
  throw "multipart image upload failed"
}

$assetId = $asset.Body.data.assetId
if (-not $assetId) {
  throw "image asset registration failed: assetId is empty"
}

$sessionBody = @{
  assetId = $assetId
  entrySource = "judge_demo"
  categoryHint = "shoe"
}
$session = Invoke-Api -Method "POST" -Path "/api/v1/sessions" -Body $sessionBody
Assert-Ok -Response $session -Step "session creation"

$sessionId = $session.Body.data.session.sessionId
if (-not $sessionId) {
  throw "session creation failed: sessionId is empty"
}

$sessionRead = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId"
Assert-Ok -Response $sessionRead -Step "session read"

$candidates = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId/candidates"
Assert-Ok -Response $candidates -Step "candidate read"

$candidateItems = @($candidates.Body.data.items)
if ($candidateItems.Count -lt 1) {
  throw "candidate read failed: expected at least one candidate item"
}

$candidateItemId = $candidateItems[0].candidateItemId
if (-not $candidateItemId) {
  throw "candidate read failed: candidateItemId is empty"
}

$detail = Invoke-Api -Method "GET" -Path "/api/v1/candidates/$candidateItemId"
Assert-Ok -Response $detail -Step "candidate detail"

if (-not ($detail.Body.data.PSObject.Properties.Name -contains "decisionSupport")) {
  throw "candidate detail failed: decisionSupport is empty"
}

$suggestions = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId/suggestions"
Assert-Ok -Response $suggestions -Step "suggestions"

$suggestionCards = @($suggestions.Body.data.cards)
if ($suggestionCards.Count -lt 1) {
  throw "suggestions failed: expected at least one suggestion card"
}

$turnBody = @{
  message = "budget 500"
}
$turn = Invoke-Api -Method "POST" -Path "/api/v1/sessions/$sessionId/turns" -Body $turnBody
Assert-Ok -Response $turn -Step "turn refinement"

if (-not ($turn.Body.data.PSObject.Properties.Name -contains "candidates")) {
  throw "turn refinement failed: candidates are missing"
}

if (-not ($turn.Body.data.PSObject.Properties.Name -contains "suggestions")) {
  throw "turn refinement failed: suggestions are missing"
}

$refinedCandidates = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId/candidates"
Assert-Ok -Response $refinedCandidates -Step "refined candidate read"

$refinedCandidateItems = @($refinedCandidates.Body.data.items)
if ($refinedCandidateItems.Count -lt 1) {
  throw "refined candidate read failed: expected at least one candidate item"
}

$strictTurnBody = @{
  message = "budget 100"
}
$strictTurn = Invoke-Api -Method "POST" -Path "/api/v1/sessions/$sessionId/turns" -Body $strictTurnBody
Assert-Ok -Response $strictTurn -Step "fallback turn refinement"

$fallbackCandidates = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$sessionId/candidates"
Assert-Ok -Response $fallbackCandidates -Step "fallback candidate read"

if ($fallbackCandidates.Body.data.degraded -ne $true) {
  throw "fallback candidate read failed: expected degraded=true"
}

$fallbackCandidateItems = @($fallbackCandidates.Body.data.items)
if ($fallbackCandidateItems.Count -lt 1) {
  throw "fallback candidate read failed: expected fallback candidate items"
}

$missingAssetId = "asset_missing_$([guid]::NewGuid().ToString('N'))"
$missingAssetBody = @{
  assetId = $missingAssetId
}
$missingAsset = Invoke-Api -Method "POST" -Path "/api/v1/sessions" -Body $missingAssetBody
Assert-Error -Response $missingAsset -ExpectedCode "IMAGE_ASSET_NOT_FOUND" -Step "missing asset contract"

$missingSessionId = "sess_missing_$([guid]::NewGuid().ToString('N'))"
$missingSession = Invoke-Api -Method "GET" -Path "/api/v1/sessions/$missingSessionId"
Assert-Error -Response $missingSession -ExpectedCode "SESSION_NOT_FOUND" -Step "missing session contract"

Write-Host "Day 1/2/3 API smoke passed. sessionId=$sessionId initialCandidateCount=$($candidateItems.Count) fallbackCandidateCount=$($fallbackCandidateItems.Count)"
