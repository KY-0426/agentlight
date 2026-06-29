# Agent Light Windows launcher
# Usage:
#   .\scripts\run-agent-light.ps1           # auto: release exe if built, else dev
#   .\scripts\run-agent-light.ps1 -Mode dev
#   .\scripts\run-agent-light.ps1 -Mode release
#   .\scripts\run-agent-light.ps1 -Mode build

param(
  [ValidateSet("auto", "dev", "release", "build")]
  [string]$Mode = "auto"
)

$ErrorActionPreference = "Stop"

function Import-RustToolchainPath {
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  if (Test-Path $cargoBin) {
    $env:PATH = "$cargoBin;$env:PATH"
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    return
  }

  $vcPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if (-not $vcPath) {
    return
  }

  $msvcRoot = Get-ChildItem (Join-Path $vcPath "VC\Tools\MSVC") -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $msvcRoot) {
    return
  }

  $linkDir = Join-Path $msvcRoot.FullName "bin\Hostx64\x64"
  if (Test-Path $linkDir) {
    $env:PATH = "$linkDir;$env:PATH"
  }
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$releaseExe = Join-Path $Root "src-tauri\target\release\agent-light.exe"
$debugExe = Join-Path $Root "src-tauri\target\debug\agent-light.exe"

function Start-BuiltApp {
  param([string]$ExePath)

  if (-not (Test-Path $ExePath)) {
    return $false
  }

  Write-Host "Starting $ExePath"
  Start-Process -FilePath $ExePath -WorkingDirectory $Root
  return $true
}

if ($Mode -eq "build") {
  Import-RustToolchainPath
  npm run tauri:build:windows
  exit $LASTEXITCODE
}

if ($Mode -eq "release") {
  if (Start-BuiltApp $releaseExe) {
    exit 0
  }
  Write-Error "Release exe not found. Build first: npm run tauri:build:windows"
  exit 1
}

if ($Mode -eq "auto" -and (Start-BuiltApp $releaseExe)) {
  exit 0
}

if ($Mode -eq "auto" -and (Start-BuiltApp $debugExe)) {
  exit 0
}

Write-Host "No built exe found, starting development mode (tauri dev)..."
Import-RustToolchainPath
npm run tauri:dev @args
