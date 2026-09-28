param(
  [Parameter(Mandatory = $true)]
  [string]$BuildDir,

  [Parameter(Mandatory = $true)]
  [string]$MindSporeLiteRoot
)

$ErrorActionPreference = 'Stop'
$resolvedBuildDir = (Resolve-Path -LiteralPath $BuildDir).Path
$resolvedLiteRoot = (Resolve-Path -LiteralPath $MindSporeLiteRoot).Path

function Convert-ToWslPath {
  param([string]$WindowsPath)
  $converted = wsl.exe wslpath -a $WindowsPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to translate path for WSL: $WindowsPath"
  }
  return $converted.Trim()
}

$build = Convert-ToWslPath $resolvedBuildDir
$root = Convert-ToWslPath $resolvedLiteRoot
$converter = "$root/tools/converter/converter/converter_lite"
$benchmark = "$root/tools/benchmark/benchmark"
$converterLibraryPath = "$root/tools/converter/lib"
$runtimeLibraryPath = "$root/runtime/lib:$root/runtime/third_party/glog"
$onnx = "$build/soleai_neural_embedding_v1.onnx"
$mindirPrefix = "$build/soleai_neural_embedding_v1"
$model = "$mindirPrefix.ms"
$input = "$build/neural_embedding_input.bin"
$golden = "$build/neural_embedding_output.out"

wsl.exe env "LD_LIBRARY_PATH=$converterLibraryPath" $converter `
  --fmk=ONNX `
  "--modelFile=$onnx" `
  "--outputFile=$mindirPrefix" `
  --optimize=general `
  --infer=true
if ($LASTEXITCODE -ne 0) {
  throw 'MindSpore Lite conversion failed.'
}

wsl.exe env "LD_LIBRARY_PATH=$runtimeLibraryPath" $benchmark `
  "--modelFile=$model" `
  --modelType=MindIR_Lite `
  "--inDataFile=$input" `
  "--benchmarkDataFile=$golden" `
  --benchmarkDataType=FLOAT `
  --accuracyThreshold=0.5 `
  --cosineDistanceThreshold=0.999 `
  --device=CPU `
  --numThreads=2 `
  --warmUpLoopCount=3 `
  --loopCount=10 `
  --cpuBindMode=0
if ($LASTEXITCODE -ne 0) {
  throw 'MindSpore Lite benchmark validation failed.'
}

Write-Host "Validated MindSpore Lite model: $resolvedBuildDir\soleai_neural_embedding_v1.ms"
