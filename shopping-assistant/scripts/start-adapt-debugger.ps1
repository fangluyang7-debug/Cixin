param(
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$WorkerDir = Join-Path $RepoRoot "services\image-worker"
$WorkerPython = Join-Path $WorkerDir ".venv\Scripts\python.exe"
$LogDir = Join-Path $RepoRoot ".tmp\adapt-debugger"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-ListeningPort {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $listener
}

function Stop-ListeningPort {
  param([int]$Port)
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $processIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    if ($processId -and $processId -ne $PID) {
      Write-Host "Stopping process on port $Port (PID $processId)..."
      Stop-Process -Id $processId -Force
    }
  }
}

function Stop-DebuggerProcesses {
  $escapedLogDir = [regex]::Escape($LogDir)
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -match $escapedLogDir
    } |
    Sort-Object ProcessId -Descending

  foreach ($process in $processes) {
    Write-Host "Stopping debugger process PID $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if ($Restart) {
  Stop-DebuggerProcesses
  Stop-ListeningPort 7800
  Stop-ListeningPort 3000
  Stop-ListeningPort 5173
  Start-Sleep -Seconds 2
}

if (-not (Test-Path $WorkerPython)) {
  Write-Host "Creating image-worker Python environment..."
  Push-Location $WorkerDir
  try {
    python -m venv .venv
    & $WorkerPython -m pip install --upgrade pip
    & $WorkerPython -m pip install -r requirements.txt
  } finally {
    Pop-Location
  }
}

if (-not (Test-ListeningPort 7800)) {
  Write-Host "Starting image worker on http://127.0.0.1:7800 ..."
  Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "cd '$WorkerDir'; .\.venv\Scripts\python.exe -m app.main *> '$LogDir\image-worker.log'"
  )
} else {
  Write-Host "Image worker already listening on 7800."
}

Start-Sleep -Seconds 2

if (-not (Test-ListeningPort 3000)) {
  Write-Host "Starting API server on http://127.0.0.1:3000 ..."
  Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "cd '$RepoRoot'; npm run api:build *> '$LogDir\api.log'; npm --workspace services/api-server run start *>> '$LogDir\api.log'"
  )
} else {
  Write-Host "API server already listening on 3000."
}

Start-Sleep -Seconds 2

if (-not (Test-ListeningPort 5173)) {
  Write-Host "Starting web debugger on http://127.0.0.1:5173/adapt-debugger ..."
  Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "cd '$RepoRoot'; npm run web:dev *> '$LogDir\web.log'"
  )
} else {
  Write-Host "Web server already listening on 5173."
}

Write-Host ""
Write-Host "Debugger URL: http://127.0.0.1:5173/adapt-debugger"
Write-Host "API URL:      http://127.0.0.1:3000"
Write-Host "Worker URL:   http://127.0.0.1:7800"
Write-Host "Logs:         $LogDir"
Write-Host ""
Write-Host "Paste MAINTENANCE_API_TOKEN from .env into the page token field."
