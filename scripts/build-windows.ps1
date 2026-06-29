# Agentario Windows build (runs on C: — bun crashes on network drive Z:)
$ErrorActionPreference = "Stop"

$Source = if ($env:AGENTARIO_SRC) { $env:AGENTARIO_SRC } else { Split-Path $PSScriptRoot -Parent }

$BuildRoot = if ($env:AGENTARIO_BUILD) { $env:AGENTARIO_BUILD } else { "C:\Users\Admin\Agentario" }
$NodeDir = if ($env:AGENTARIO_NODE) { $env:AGENTARIO_NODE } else { "$env:USERPROFILE\tools\node-v22.14.0-win-x64" }
$BunExe = if ($env:AGENTARIO_BUN) { $env:AGENTARIO_BUN } else { "$env:USERPROFILE\tools\bun-v1.3.13\bun.exe" }

if (-not (Test-Path $BunExe)) {
    $BunExe = "$env:USERPROFILE\.bun\bin\bun.exe"
}
if (-not (Test-Path $NodeDir\node.exe)) {
    Write-Error "Node.js not found at $NodeDir. Install Node 22 or set AGENTARIO_NODE."
}
if (-not (Test-Path $BunExe)) {
    Write-Error "Bun not found. Install from https://bun.sh or set AGENTARIO_BUN."
}

$env:Path = "$NodeDir;$(Split-Path $BunExe -Parent);C:\Program Files\Git\bin;$env:Path"

Write-Host "Source:  $Source"
Write-Host "Build:   $BuildRoot"
Write-Host "Node:    $NodeDir\node.exe"
Write-Host "Bun:     $BunExe"
Write-Host ""

Write-Host "==> Syncing sources (excluding node_modules, .git)..."
New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
$robocopy = Join-Path $env:SystemRoot "System32\robocopy.exe"
if (Test-Path $robocopy) {
    & $robocopy $Source $BuildRoot /MIR /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Error "robocopy failed with exit code $LASTEXITCODE"
    }
} else {
    $exclude = @("node_modules", ".git")
    Get-ChildItem -Path $Source -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
        $dest = Join-Path $BuildRoot $_.Name
        if ($_.PSIsContainer) {
            if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
            Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
        } else {
            Copy-Item -Path $_.FullName -Destination $dest -Force
        }
    }
}

$VsCodeDir = Join-Path $BuildRoot "apps\vscode"
if (-not (Test-Path (Join-Path $VsCodeDir "esbuild.mjs"))) {
    Write-Error "esbuild.mjs not found in $VsCodeDir"
}

if (-not (Test-Path (Join-Path $BuildRoot "node_modules"))) {
    Write-Host "==> Installing dependencies (first run, may take several minutes)..."
    Push-Location $BuildRoot
    & $BunExe install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Pop-Location
}

Write-Host "==> Building SDK..."
Push-Location $BuildRoot
& $BunExe run build:sdk
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

Write-Host "==> Building webview..."
Push-Location $VsCodeDir
& $BunExe run build:webview
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Building extension..."
& $BunExe esbuild.mjs --production
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Packaging VSIX..."
& $BunExe x @vscode/vsce package --no-dependencies --allow-missing-repository
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$vsix = Get-ChildItem -Path $VsCodeDir -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $vsix) {
    Write-Error "VSIX file was not created."
}

$releaseDir = Join-Path $Source "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$outVsix = Join-Path $releaseDir "agentario-4.0.0.vsix"
Copy-Item -Path $vsix.FullName -Destination $outVsix -Force

Pop-Location

Write-Host ""
Write-Host "Done: $outVsix"
Write-Host "Install in VS Code: Extensions -> ... -> Install from VSIX"
