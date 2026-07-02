$ErrorActionPreference = "Stop"

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
    $env:PATH = "$cargoBin;$env:PATH"
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vcPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vcPath) {
        $msvcRoot = Get-ChildItem (Join-Path $vcPath "VC\Tools\MSVC") -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($msvcRoot) {
            $linkDir = Join-Path $msvcRoot.FullName "bin\Hostx64\x64"
            if (Test-Path $linkDir) {
                $env:PATH = "$linkDir;$env:PATH"
            }
        }
    }
}

Set-Location (Join-Path $PSScriptRoot "..")

# Debug builds skip usage sync unless explicitly enabled; dev script turns it on by default.
$env:AGENT_LIGHT_ENABLE_USAGE_SYNC = "1"

npm run tauri:dev @args
