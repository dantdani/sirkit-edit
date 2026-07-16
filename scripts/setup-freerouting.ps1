[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$FreeroutingVersion = "2.2.4"
$FreeroutingCommit = "20f1a72e546b9b23c7ba5127086885cfacbdd4be"
$FreeroutingJarSha256 = "f5ed374182900ccc78e473518bbb9f6b869f4a07159495f663a76f52bb10523b"
$JreArchiveName = "OpenJDK25U-jre_x64_windows_hotspot_25.0.3_9.zip"
$JreSha256 = "a183e7280220ad5f6fe94ecbf025a5f10fc5797a0b18c600ed8f813c8158c530"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$VendorRoot = Join-Path $RepoRoot "vendor\freerouting"
$RuntimeRoot = Join-Path $VendorRoot "runtime"
$JarPath = Join-Path $RuntimeRoot "freerouting-$FreeroutingVersion.jar"
$JreArchivePath = Join-Path $RuntimeRoot $JreArchiveName
$JavaPath = Join-Path $RuntimeRoot "jdk-25.0.3+9-jre\bin\java.exe"

function Assert-WithinRepo([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $prefix = $RepoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the Sirkit working copy: $full"
  }
}

function Get-VerifiedDownload(
  [string]$Uri,
  [string]$Destination,
  [string]$ExpectedSha256
) {
  Assert-WithinRepo $Destination
  if (Test-Path -LiteralPath $Destination) {
    $existing = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
    if ($existing -eq $ExpectedSha256) {
      Write-Host "Verified existing $(Split-Path -Leaf $Destination)"
      return
    }
    throw "Existing download failed checksum verification: $Destination"
  }

  $temporary = "$Destination.download"
  Assert-WithinRepo $temporary
  Write-Host "Downloading $Uri"
  Invoke-WebRequest -UseBasicParsing -Headers @{ "User-Agent" = "Sirkit-Freerouting-Setup" } -Uri $Uri -OutFile $temporary
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256) {
    Remove-Item -LiteralPath $temporary -Force
    throw "Checksum mismatch for $(Split-Path -Leaf $Destination). Expected $ExpectedSha256, got $actual."
  }
  Move-Item -LiteralPath $temporary -Destination $Destination
}

Assert-WithinRepo $VendorRoot
Assert-WithinRepo $RuntimeRoot
New-Item -ItemType Directory -Force $RuntimeRoot | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $VendorRoot ".git"))) {
  Write-Host "Cloning Freerouting v$FreeroutingVersion source"
  git clone --depth 1 --branch "v$FreeroutingVersion" https://github.com/freerouting/freerouting.git $VendorRoot
  if ($LASTEXITCODE -ne 0) { throw "Freerouting source clone failed." }
}

$sourceCommit = (git -C $VendorRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -ne $FreeroutingCommit) {
  throw "Freerouting source is not the reviewed v$FreeroutingVersion commit ($FreeroutingCommit). Found: $sourceCommit"
}
Write-Host "Verified Freerouting source v$FreeroutingVersion ($($sourceCommit.Substring(0, 7)))"

Get-VerifiedDownload `
  "https://github.com/freerouting/freerouting/releases/download/v$FreeroutingVersion/freerouting-$FreeroutingVersion.jar" `
  $JarPath `
  $FreeroutingJarSha256

if (-not (Test-Path -LiteralPath $JavaPath)) {
  Get-VerifiedDownload `
    "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.3%2B9/$JreArchiveName" `
    $JreArchivePath `
    $JreSha256
  Write-Host "Extracting the private Temurin JRE 25 runtime"
  Expand-Archive -LiteralPath $JreArchivePath -DestinationPath $RuntimeRoot -Force
}

if (-not (Test-Path -LiteralPath $JavaPath)) {
  throw "The portable Java runtime was not extracted to the expected path: $JavaPath"
}

& $JavaPath -version
if ($LASTEXITCODE -ne 0) { throw "The bundled Java runtime failed its version check." }

$manifest = [ordered]@{
  freeroutingVersion = $FreeroutingVersion
  freeroutingCommit = $FreeroutingCommit
  freeroutingJarSha256 = $FreeroutingJarSha256
  javaRuntime = "Eclipse Temurin JRE 25.0.3+9"
  javaArchiveSha256 = $JreSha256
  installedAt = [DateTime]::UtcNow.ToString("o")
  apiKeyRequired = $false
}
$manifestPath = Join-Path $RuntimeRoot "sirkit-runtime.json"
Assert-WithinRepo $manifestPath
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host ""
Write-Host "Freerouting is ready for Sirkit."
Write-Host "  Source: v$FreeroutingVersion ($($sourceCommit.Substring(0, 7)))"
Write-Host "  JAR:    $JarPath"
Write-Host "  Java:   $JavaPath"
Write-Host "  API key required: no"
