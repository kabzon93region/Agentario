<# 
.SYNOPSIS
    Normalizes line endings and encoding for all project files.
.DESCRIPTION
    Rules from .gitattributes:
    - All text files: LF (including .ps1, .md, release/notes)
    - .cmd / .bat: CRLF (Windows requirement)
    - Binary files: skip
    - Encoding: UTF-8 no BOM (for code / markdown / configs / .ps1)
    - UTF-8 with BOM allowed for .cmd/.bat only
.NOTES
    Usage: .\scripts\normalize_line_endings.ps1 [-WhatIf] [-Verbose]
#>

param(
    [switch]$WhatIf,
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not $repoRoot) { $repoRoot = Get-Location }

# Keep in sync with .gitattributes: * text=auto eol=lf; *.cmd/*.bat eol=crlf
$eolRules = @{
    ".cmd" = "crlf"; ".bat" = "crlf"
    ".ps1"="crlf"; ".py"="lf"; ".js"="lf"; ".ts"="lf"; ".tsx"="lf"; ".jsx"="lf"
    ".json"="lf"; ".yml"="lf"; ".yaml"="lf"; ".toml"="lf"
    ".md"="lf"; ".sql"="lf"; ".html"="lf"; ".css"="lf"
    ".svg"="lf"; ".xml"="lf"; ".sh"="lf"; ".proto"="lf"
    ".mdc"="lf"; ".txt"="lf"
}

$binaryExtensions = @(
    ".png",".jpg",".jpeg",".gif",".ico",".bmp",".webp",
    ".woff",".woff2",".ttf",".eot",".otf",
    ".exe",".dll",".so",".dylib",
    ".zip",".tar",".gz",".7z",".rar",".vsix",".pdf",".pb",".icns"
)

$utf8NoBomExts = @(
    ".ts",".tsx",".js",".jsx",".json",
    ".py",".md",".sql",".html",".css",
    ".yml",".yaml",".toml",".svg",".xml",
    ".proto",".mdc",".sh",".txt"
)

# .ps1 needs UTF-8 BOM so Windows PowerShell (ParseFile) uses correct encoding
$utf8BomAllowed = @(".cmd",".bat",".ps1")

# Include release/notes. Skip only heavy / generated trees and VSIX binaries.
$skipPathRegex = '(?i)\\(\.git|node_modules|bin|obj|\.agentario|\.agentario-lab|\.cursor|__pycache__|dist|out|coverage|local-project|\.vscode-test|Exports)\\'

$stats = @{ scanned=0; eolFixed=0; bomRemoved=0; skipped=0; errors=0 }

Write-Host "`n=== Agentario Line Ending & Encoding Normalizer ===" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot`n" -ForegroundColor DarkGray

$allFiles = Get-ChildItem -Path $repoRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch $skipPathRegex -and
        $_.FullName -notmatch '(?i)\\release\\[^\\]+\.vsix$' -and
        $_.FullName -notmatch '(?i)\\release\\agentario-'
    }

foreach ($file in $allFiles) {
    $ext = $file.Extension.ToLower()
    $stats.scanned++

    if ($binaryExtensions -contains $ext) { $stats.skipped++; continue }
    if (-not $ext -and $file.Name -notmatch '^(Makefile|Dockerfile|\.gitignore|\.gitattributes)$') { $stats.skipped++; continue }

    $targetEol = if ($eolRules[$ext]) { $eolRules[$ext] } else { "lf" }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        if ($bytes.Length -eq 0) { $stats.skipped++; continue }

        $changed = $false

        $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
        if ($hasBom -and ($utf8NoBomExts -contains $ext) -and ($utf8BomAllowed -notcontains $ext)) {
            if (-not $WhatIf) {
                $noBom = New-Object byte[] ($bytes.Length - 3)
                [Array]::Copy($bytes, 3, $noBom, 0, $bytes.Length - 3)
                [System.IO.File]::WriteAllBytes($file.FullName, $noBom)
                $bytes = $noBom
            }
            $stats.bomRemoved++; $changed = $true
            if ($Verbose) { Write-Host "  BOM removed: $($file.Name)" -ForegroundColor Yellow }
        }

        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        $crlf = ([regex]::Matches($text, "\r\n")).Count
        $lfOnly = ([regex]::Matches($text, "(?<!\r)\n")).Count
        $crOnly = ([regex]::Matches($text, "\r(?!\n)")).Count
        $total = $crlf + $lfOnly + $crOnly

        if ($total -eq 0) { $stats.skipped++; continue }

        $needsFix = $false
        if ($targetEol -eq "crlf") {
            if ($lfOnly -gt 0 -or $crOnly -gt 0) { $needsFix = $true }
        } else {
            if ($crlf -gt 0 -or $crOnly -gt 0) { $needsFix = $true }
        }

        if ($needsFix) {
            if (-not $WhatIf) {
                $norm = $text -replace "\r\n", "`n" -replace "\r", "`n"
                if ($targetEol -eq "crlf") { $norm = $norm -replace "`n", "`r`n" }
                $newBytes = [System.Text.Encoding]::UTF8.GetBytes($norm)
                [System.IO.File]::WriteAllBytes($file.FullName, $newBytes)
            }
            $stats.eolFixed++; $changed = $true
            if ($Verbose) { Write-Host "  EOL -> $($targetEol.ToUpper()): $($file.Name)" -ForegroundColor Green }
        }

        if ($changed) {
            $rel = $file.FullName.Substring($repoRoot.Length + 1)
            Write-Host "  FIXED: $rel" -ForegroundColor Green
        }
    } catch {
        $stats.errors++
        Write-Host "  ERROR: $($file.Name) - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Results ===" -ForegroundColor Cyan
Write-Host "  Scanned:    $($stats.scanned)"
Write-Host "  EOL fixed:  $($stats.eolFixed)" -ForegroundColor $(if($stats.eolFixed -gt 0){"Green"}else{"DarkGray"})
Write-Host "  BOM removed:$($stats.bomRemoved)" -ForegroundColor $(if($stats.bomRemoved -gt 0){"Yellow"}else{"DarkGray"})
Write-Host "  Skipped:    $($stats.skipped) (binary/empty)" -ForegroundColor DarkGray
Write-Host "  Errors:     $($stats.errors)" -ForegroundColor $(if($stats.errors -gt 0){"Red"}else{"DarkGray"})
if ($WhatIf) { Write-Host "`n  [DRY RUN]" -ForegroundColor Yellow }
Write-Host ""
