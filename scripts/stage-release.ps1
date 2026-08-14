param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [string]$BuiltAfterUtc = ""
)

$ErrorActionPreference = "Stop"

$tauriRoot = Join-Path $ProjectRoot "src-tauri"
$bundleRoot = Join-Path $tauriRoot "target\release\bundle"
$releaseRoot = Join-Path $ProjectRoot "release"
$tauriConfigPath = Join-Path $tauriRoot "tauri.conf.json"
$packagePath = Join-Path $ProjectRoot "package.json"

if (-not (Test-Path -LiteralPath $bundleRoot)) {
  throw "Release bundle not found at $bundleRoot. Run 'bun run build:release' first."
}

$tauriConfig = Get-Content -Raw -LiteralPath $tauriConfigPath | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
$version = [string]$tauriConfig.version
$productName = [string]$tauriConfig.productName
$packageName = [string]$package.name

if ([string]::IsNullOrWhiteSpace($version) -or [string]::IsNullOrWhiteSpace($productName)) {
  throw "Tauri productName and version are required in $tauriConfigPath."
}

$builtAfter = [DateTime]::MinValue.ToUniversalTime()
if (-not [string]::IsNullOrWhiteSpace($BuiltAfterUtc)) {
  $builtAfter = [DateTime]::Parse($BuiltAfterUtc).ToUniversalTime()
}

function Get-SingleArtifact([string]$Directory, [string]$Extension) {
  $escapedVersion = [regex]::Escape($version)
  $candidates = @(Get-ChildItem -LiteralPath $Directory -Filter "*$Extension" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "_${escapedVersion}_" })
  if ($candidates.Count -ne 1) {
    throw "Expected exactly one $Extension installer for version $version in $Directory, found $($candidates.Count)."
  }
  if ($candidates[0].LastWriteTimeUtc -lt $builtAfter) {
    throw "$($candidates[0].Name) predates the requested release build. Run the release build again."
  }
  return $candidates[0]
}

$nsis = Get-SingleArtifact (Join-Path $bundleRoot "nsis") ".exe"
$msi = Get-SingleArtifact (Join-Path $bundleRoot "msi") ".msi"
$versionPattern = [regex]::Escape($version)
$nsisMatch = [regex]::Match($nsis.BaseName, "_" + $versionPattern + "_([^_]+)-setup$")
$msiMatch = [regex]::Match($msi.BaseName, "_" + $versionPattern + "_([^_]+)(?:_|$)")

if (-not $nsisMatch.Success -or -not $msiMatch.Success -or $nsisMatch.Groups[1].Value -ne $msiMatch.Groups[1].Value) {
  throw "NSIS and MSI installers do not agree on product version or architecture."
}

$architecture = $nsisMatch.Groups[1].Value.ToLowerInvariant()
$downloadStem = "$packageName-windows-$architecture"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Get-ChildItem -LiteralPath $releaseRoot -File -ErrorAction SilentlyContinue | Remove-Item -Force

$artifacts = @(
  @{ Source = $nsis; Name = "$downloadStem.exe" },
  @{ Source = $msi; Name = "$downloadStem.msi" }
)

$manifest = [ordered]@{
  product = $productName
  version = $version
  platform = "windows-$architecture"
  files = @()
}

foreach ($artifact in $artifacts) {
  $destination = Join-Path $releaseRoot $artifact.Name
  Copy-Item -LiteralPath $artifact.Source.FullName -Destination $destination
  $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($artifact.Name)" | Set-Content -LiteralPath (Join-Path $releaseRoot "$($artifact.Name).sha256") -Encoding ascii
  $manifest.files += [ordered]@{
    name = $artifact.Name
    sha256 = $hash
    bytes = (Get-Item -LiteralPath $destination).Length
  }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseRoot "manifest.json") -Encoding utf8
Write-Host "Staged $($manifest.files.Count) release artifact(s) for $productName $version ($architecture) in $releaseRoot"
