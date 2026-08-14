param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$buildStarted = [DateTime]::UtcNow.AddSeconds(-2)

Push-Location $ProjectRoot
try {
  & bun run build:release
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $builtAfter = $buildStarted.ToString("o")
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "scripts\stage-release.ps1") -ProjectRoot $ProjectRoot -BuiltAfterUtc $builtAfter
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
