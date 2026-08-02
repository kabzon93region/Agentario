# CocoIndex DB Migration to Local Drive
# Run in PowerShell as Administrator

$ErrorActionPreference = "Stop"

$Project = "Z:\T\Agentario"
$SourceDB = Join-Path $Project ".cocoindex_code\cocoindex.db"
$TargetDB = "C:\Users\Admin\.MCP\cocoindex-code\Agentario\db\cocoindex.db"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " CocoIndex DB Migration to Local Drive" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop ccc daemon
Write-Host "[1/5] Stopping ccc daemon..." -ForegroundColor Yellow
$procs = Get-Process ccc -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Stop-Process -Force
    Write-Host "  Stopped $($procs.Count) process(es)."
    Start-Sleep -Seconds 3
} else {
    Write-Host "  Daemon not running (OK)."
}

# 2. Verify source
Write-Host "`n[2/5] Checking source..." -ForegroundColor Yellow
$dataMdb = Join-Path $SourceDB "mdb\data.mdb"
if (-not (Test-Path $dataMdb)) {
    Write-Host "  ERROR: source DB not found at $SourceDB" -ForegroundColor Red
    exit 1
}
$size = [math]::Round((Get-Item $dataMdb).Length / 1MB, 1)
Write-Host "  Source DB found ($size MB)."

# 3. Copy to local drive
Write-Host "`n[3/5] Copying to local drive..." -ForegroundColor Yellow
if (Test-Path (Join-Path $TargetDB "mdb\data.mdb")) {
    Write-Host "  Target already exists, skipping copy."
} else {
    New-Item -ItemType Directory -Path (Join-Path $TargetDB "mdb") -Force | Out-Null
    Copy-Item (Join-Path $SourceDB "mdb\data.mdb") (Join-Path $TargetDB "mdb\data.mdb") -Force
    Copy-Item (Join-Path $SourceDB "mdb\lock.mdb") (Join-Path $TargetDB "mdb\lock.mdb") -Force -ErrorAction SilentlyContinue
    $newSize = [math]::Round((Get-Item (Join-Path $TargetDB "mdb\data.mdb")).Length / 1MB, 1)
    Write-Host "  Copied ($newSize MB)."
}

# 4. Remove old directory
Write-Host "`n[4/5] Removing old DB directory..." -ForegroundColor Yellow
Remove-Item $SourceDB -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $SourceDB) {
    Write-Host "  WARNING: Could not remove (locked?). Try after closing Cursor." -ForegroundColor Red
    exit 1
}
Write-Host "  Removed."

# 5. Create junction
Write-Host "`n[5/5] Creating junction..." -ForegroundColor Yellow
cmd /c "mklink /J `"$SourceDB`" `"$TargetDB`"" 2>&1
if (Test-Path $SourceDB) {
    $item = Get-Item $SourceDB
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Write-Host "  Junction created!" -ForegroundColor Green
    } else {
        Write-Host "  Created (but may not be a junction)." -ForegroundColor Yellow
    }
} else {
    Write-Host "  ERROR: junction not created." -ForegroundColor Red
    exit 1
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host " DONE! Restart Cursor to apply." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Start-Sleep -Seconds 10
