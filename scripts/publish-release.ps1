# Agentario — publish to GitHub + GitHub Release with VSIX asset
# Called from publish-release.cmd

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
	Write-Host ""
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
	Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
	Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err([string]$Message) {
	Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Normalize-PathString([string]$Path) {
	if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
	return $Path.TrimEnd('\', '/')
}

function Get-RepoRoot {
	$root = Normalize-PathString $(Split-Path $PSScriptRoot -Parent)
	return $root
}

function Get-PackageVersion([string]$RepoRoot) {
	$pkgPath = Join-Path $RepoRoot "apps\vscode\package.json"
	if (-not (Test-Path $pkgPath)) {
		throw "package.json not found: $pkgPath"
	}
	$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
	$version = [string]$pkg.version
	if ($version -notmatch '^\d+\.\d+\.\d+$') {
		throw "Invalid version in package.json: '$version' (expected MAJOR.MINOR.PATCH)"
	}
	return $version
}

function Get-ChangelogSection([string]$ChangelogPath, [string]$Version) {
	if (-not (Test-Path $ChangelogPath)) { return $null }
	$content = Get-Content $ChangelogPath -Raw -Encoding UTF8
	$escaped = [regex]::Escape($Version)
	$pattern = "(?ms)^## \[$escaped\][^\r\n]*\r?\n(.*?)(?=^\---\r?\n|^## \[|\z)"
	if ($content -match $pattern) {
		return $Matches[1].Trim()
	}
	return $null
}

function Resolve-ReleaseNotesPath([string]$RepoRoot, [string]$Version) {
	$candidates = @(
		Join-Path $RepoRoot "release\notes\v$Version.md"
		Join-Path $RepoRoot "release\notes\$Version.md"
	)
	foreach ($path in $candidates) {
		if (Test-Path $path) {
			return $path
		}
	}
	return $null
}

function New-TempNotesFromChangelog([string]$ChangelogSection, [string]$Version) {
	$temp = Join-Path $env:TEMP "agentario-release-notes-$Version.md"
	$body = @(
		"# Agentario v$Version"
		""
		$ChangelogSection
	) -join "`r`n"
	[System.IO.File]::WriteAllText($temp, $body, [System.Text.UTF8Encoding]::new($false))
	return $temp
}

function Resolve-ReleaseNotes {
	param(
		[string]$RepoRoot,
		[string]$Version
	)
	$explicit = Resolve-ReleaseNotesPath -RepoRoot $RepoRoot -Version $Version
	if ($explicit) {
		return @{ Path = $explicit; Source = $explicit; Temporary = $false }
	}
	$changelogPath = Join-Path $RepoRoot "CHANGELOG.md"
	$section = Get-ChangelogSection -ChangelogPath $changelogPath -Version $Version
	if ($section) {
		$temp = New-TempNotesFromChangelog -ChangelogSection $section -Version $Version
		return @{ Path = $temp; Source = "CHANGELOG.md ## [$Version]"; Temporary = $true }
	}
	return $null
}

function Test-CommandExists([string]$Name) {
	return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External([string]$FilePath, [string[]]$Arguments) {
	& $FilePath @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
	}
}

$RepoRoot = Get-RepoRoot
$Version = Get-PackageVersion -RepoRoot $RepoRoot
$Tag = "v$Version"
$Remote = if ($env:AGENTARIO_GIT_REMOTE) { $env:AGENTARIO_GIT_REMOTE } else { "origin" }
$Branch = if ($env:AGENTARIO_GIT_BRANCH) { $env:AGENTARIO_GIT_BRANCH } else { "main" }
$VsixPath = Join-Path $RepoRoot "release\agentario-$Version.vsix"
$SkipBuild = $env:AGENTARIO_SKIP_BUILD -eq "1"
$SkipGit = $env:AGENTARIO_SKIP_GIT -eq "1"
$TempNotes = $null
$Summary = @{
	Version = $Version
	Tag = $Tag
	NotesSource = ""
	VsixPath = $VsixPath
	ReleaseUrl = ""
	GitPushed = $false
	ReleaseCreated = $false
}

Write-Host "Agentario publish-release"
Write-Host "Repository: $RepoRoot"
Write-Host "Version:    $Version"
Write-Host "Tag:        $Tag"

try {
	if (-not (Test-CommandExists "git")) { throw "git not found in PATH" }
	if (-not (Test-CommandExists "gh")) { throw "gh CLI not found. Install: https://cli.github.com/" }

	Write-Step "Checking gh authentication"
	Invoke-External "gh" @("auth", "status")
	Write-Ok "gh authenticated"

	Write-Step "Resolving release notes for v$Version"
	$notes = Resolve-ReleaseNotes -RepoRoot $RepoRoot -Version $Version
	if (-not $notes) {
		$hint = @(
			"Release notes not found for version $Version."
			""
			"Create one of:"
			"  release/notes/v$Version.md   (recommended, copy from release/notes/TEMPLATE.md)"
			"  release/notes/$Version.md"
			"  section ## [$Version] in CHANGELOG.md"
			""
			"See config/RELEASE.md"
		) -join "`n"
		throw $hint
	}
	$Summary.NotesSource = $notes.Source
	if ($notes.Temporary) { $TempNotes = $notes.Path }
	Write-Ok "Notes: $($notes.Source)"

	Push-Location $RepoRoot
	try {
		Write-Step "Checking git branch"
		$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
		if ($currentBranch -ne $Branch) {
			Write-Warn "Current branch is '$currentBranch', expected '$Branch'. Continuing."
		}

		if (-not $SkipGit) {
			Write-Step "Staging and committing changes"
			git add -A
			$exportsPath = Join-Path $RepoRoot "Exports"
			if (Test-Path $exportsPath) {
				git reset HEAD -- "Exports" 2>$null | Out-Null
			}
			foreach ($secret in @(".env", ".env.local", ".env.production")) {
				if (Test-Path (Join-Path $RepoRoot $secret)) {
					git reset HEAD -- $secret 2>$null | Out-Null
				}
			}
			$status = git status --porcelain
			if ($status) {
				$commitMsg = "Release v$Version"
				git commit -m $commitMsg
				Write-Ok "Committed: $commitMsg"
			} else {
				Write-Ok "Working tree clean - nothing to commit"
			}

			Write-Step "Pushing to $Remote/$Branch"
			git push $Remote $Branch
			$Summary.GitPushed = $true
			Write-Ok "Pushed $Remote $Branch"

			Write-Step "Creating git tag $Tag (if missing)"
			$existingTags = git tag -l $Tag
			if (-not $existingTags) {
				git tag $Tag
				Write-Ok "Tag created locally: $Tag"
			} else {
				Write-Ok "Tag already exists locally: $Tag"
			}
			git push $Remote $Tag
			Write-Ok "Tag pushed: $Remote $Tag"
		} else {
			Write-Warn "AGENTARIO_SKIP_GIT=1 - skipped commit/push/tag"
		}

		if (-not (Test-Path $VsixPath)) {
			if ($SkipBuild) {
				throw "VSIX not found: $VsixPath (set AGENTARIO_SKIP_BUILD=0 or run build.cmd)"
			}
			Write-Step "Building VSIX (release/agentario-$Version.vsix)"
			$buildPs1 = Join-Path $RepoRoot "scripts\build-windows.ps1"
			if (-not (Test-Path $buildPs1)) {
				throw "build-windows.ps1 not found: $buildPs1"
			}
			& $buildPs1
			if ($LASTEXITCODE -ne 0) {
				throw "build-windows.ps1 failed with exit code $LASTEXITCODE"
			}
		}
		if (-not (Test-Path $VsixPath)) {
			throw "VSIX still missing after build: $VsixPath"
		}
		Write-Ok "VSIX: $VsixPath ($([math]::Round((Get-Item $VsixPath).Length / 1MB, 2)) MB)"

		Write-Step "Publishing GitHub Release $Tag"
		$releaseView = gh release view $Tag 2>$null
		if ($LASTEXITCODE -eq 0) {
			Write-Warn "Release $Tag already exists - updating notes and VSIX asset"
			Invoke-External "gh" @("release", "edit", $Tag, "--title", "Agentario v$Version", "--notes-file", $notes.Path)
			Invoke-External "gh" @("release", "upload", $Tag, $VsixPath, "--clobber")
			Write-Ok "Release updated"
		} else {
			Invoke-External "gh" @(
				"release", "create", $Tag,
				$VsixPath,
				"--repo", "kabzon93region/Agentario",
				"--title", "Agentario v$Version",
				"--notes-file", $notes.Path
			)
			Write-Ok "Release created"
		}
		$Summary.ReleaseCreated = $true

		$releaseJson = gh release view $Tag --repo kabzon93region/Agentario --json url -q .url
		if ($releaseJson) {
			$Summary.ReleaseUrl = $releaseJson.Trim()
		}
	} finally {
		Pop-Location
	}
} catch {
	Write-Err $_.Exception.Message
	exit 1
} finally {
	if ($TempNotes -and (Test-Path $TempNotes)) {
		Remove-Item $TempNotes -Force -ErrorAction SilentlyContinue
	}
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  PUBLISH SUMMARY" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ("  Version:      " + $Summary.Version)
Write-Host ("  Tag:          " + $Summary.Tag)
Write-Host ("  Notes:        " + $Summary.NotesSource)
Write-Host ("  VSIX:         " + $Summary.VsixPath)
if ($Summary.ReleaseUrl) {
	Write-Host ("  Release URL:  " + $Summary.ReleaseUrl)
} else {
	Write-Host ("  Release URL:  https://github.com/kabzon93region/Agentario/releases/tag/" + $Tag)
}
$gitPushLabel = if ($Summary.GitPushed) { "yes" } else { "skipped" }
$ghReleaseLabel = if ($Summary.ReleaseCreated) { "yes" } else { "no" }
Write-Host ("  Git push:     " + $gitPushLabel)
Write-Host ("  GH release:   " + $ghReleaseLabel)
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

exit 0
