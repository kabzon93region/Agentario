#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$TemplatePath = Join-Path $RepoRoot "config\agentario-recommended-mcp.json"
$RulesTemplate = Join-Path $RepoRoot "config\agentario-global-rules.md"

function Find-NpxCommand {
	$cmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
	if ($cmd -and $cmd.Source) {
		return $cmd.Source
	}

	$candidates = @(
		"$env:ProgramFiles\nodejs\npx.cmd",
		"$env:ProgramFiles(x86)\nodejs\npx.cmd",
		"$env:LOCALAPPDATA\Programs\node\npx.cmd"
	)
	foreach ($candidate in $candidates) {
		if (Test-Path $candidate) {
			return (Resolve-Path $candidate).Path
		}
	}

	$toolsRoot = Join-Path $env:USERPROFILE "tools"
	if (Test-Path $toolsRoot) {
		$found = Get-ChildItem -Path $toolsRoot -Filter "npx.cmd" -Recurse -ErrorAction SilentlyContinue |
			Select-Object -First 1
		if ($found) {
			return $found.FullName
		}
	}

	$cmd = Get-Command npx -ErrorAction SilentlyContinue
	if ($cmd -and $cmd.Source) {
		return $cmd.Source
	}

	return $null
}

function Resolve-NodePathPrefix {
	param([string]$NpxPath)
	if (-not $NpxPath) {
		return $null
	}
	$nodeDir = Split-Path -Parent $NpxPath
	if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
		return $null
	}
	return $nodeDir
}

function Patch-McpTransportForWindows {
	param([object]$Transport, [string]$NpxPath, [string]$NodeDir)

	if (-not $Transport -or $Transport.type -ne "stdio") {
		return $Transport
	}
	if ($Transport.command -ne "npx") {
		return $Transport
	}
	if (-not $NpxPath) {
		Write-Host "  ! npx not found - stdio MCP servers need Node.js for VS Code" -ForegroundColor Yellow
		return $Transport
	}

	$Transport.command = $NpxPath
	if ($NodeDir) {
		$existingPath = ""
		if ($Transport.PSObject.Properties.Name -contains "env" -and $Transport.env -and $Transport.env.PATH) {
			$existingPath = [string]$Transport.env.PATH
		}
		$pathValue = $NodeDir
		$envBlock = [ordered]@{ PATH = $pathValue }
		if ($Transport.PSObject.Properties.Name -contains "env" -and $Transport.env) {
			foreach ($key in @($Transport.env.PSObject.Properties.Name)) {
				if ($key -ne "PATH") {
					$envBlock[$key] = $Transport.env.$key
				}
			}
		}
		$Transport | Add-Member -NotePropertyName env -NotePropertyValue $envBlock -Force
	}
	return $Transport
}

function Patch-AllMcpServers {
	param([object]$Settings, [string]$NpxPath, [string]$NodeDir)
	if (-not $Settings -or -not $Settings.mcpServers) {
		return $Settings
	}
	foreach ($name in @($Settings.mcpServers.PSObject.Properties.Name)) {
		$server = $Settings.mcpServers.$name
		if ($null -eq $server) {
			continue
		}
		if ($server.PSObject.Properties.Name -contains "transport" -and $server.transport) {
			$server.transport = Patch-McpTransportForWindows -Transport $server.transport -NpxPath $NpxPath -NodeDir $NodeDir
		} elseif ($server.command -eq "npx") {
			$server.command = $NpxPath
		}
	}
	return $Settings
}

$NpxPath = Find-NpxCommand
$NodeDir = Resolve-NodePathPrefix -NpxPath $NpxPath
if ($NpxPath) {
	Write-Host "==> Node.js npx: $NpxPath" -ForegroundColor DarkGray
	$env:Path = $NodeDir + ';' + $env:Path
} else {
	Write-Host "==> WARNING: npx not found. Install Node.js LTS and re-run this script." -ForegroundColor Yellow
	Write-Host "    VS Code does not inherit your PowerShell PATH unless Node is in system PATH." -ForegroundColor Yellow
}

$AgentarioData = Join-Path $env:USERPROFILE ".agentario\data\settings"
$LegacyClineData = Join-Path $env:USERPROFILE ".cline\data\settings"
$AgentarioRules = Join-Path $env:USERPROFILE "Documents\Agentario\Rules"
$McpSettingsPath = Join-Path $AgentarioData "agentario_mcp_settings.json"
$LegacyMcpSettingsPath = Join-Path $LegacyClineData "cline_mcp_settings.json"
$RulesDest = Join-Path $AgentarioRules "agentario-global-rules.md"

Write-Host "==> Agentario MCP setup" -ForegroundColor Cyan
Write-Host "Settings: $McpSettingsPath"

if (-not (Test-Path $TemplatePath)) {
	throw "Template not found: $TemplatePath"
}

New-Item -ItemType Directory -Force -Path $AgentarioData | Out-Null
New-Item -ItemType Directory -Force -Path $AgentarioRules | Out-Null

$template = Get-Content $TemplatePath -Raw -Encoding UTF8 | ConvertFrom-Json
$template = Patch-AllMcpServers -Settings $template -NpxPath $NpxPath -NodeDir $NodeDir

function Merge-McpSettings {
	param([object]$Existing, [object]$Incoming)
	if (-not $Existing -or -not $Existing.mcpServers) {
		return $Incoming
	}
	$merged = [ordered]@{ mcpServers = [ordered]@{} }
	foreach ($prop in $Existing.mcpServers.PSObject.Properties) {
		$merged.mcpServers[$prop.Name] = $prop.Value
	}
	foreach ($prop in $Incoming.mcpServers.PSObject.Properties) {
		if (-not $merged.mcpServers.Contains($prop.Name)) {
			$merged.mcpServers[$prop.Name] = $prop.Value
			Write-Host "  + MCP server: $($prop.Name)" -ForegroundColor Green
		} else {
			Write-Host "  = MCP server already present: $($prop.Name)" -ForegroundColor DarkYellow
		}
	}
	return ($merged | ConvertTo-Json -Depth 20 | ConvertFrom-Json)
}

$existing = $null
$existingPath = $null
foreach ($candidate in @($McpSettingsPath, $LegacyMcpSettingsPath)) {
	if (Test-Path $candidate) {
		$existingPath = $candidate
		try {
			$existing = Get-Content $candidate -Raw -Encoding UTF8 | ConvertFrom-Json
			break
		} catch {
		 Write-Host "  ! Could not parse $candidate, trying next..." -ForegroundColor Yellow
		}
	}
}
if ($existingPath -and $existingPath -ne $McpSettingsPath) {
	Write-Host "  Migrating MCP settings from $existingPath" -ForegroundColor Cyan
}

$merged = Merge-McpSettings -Existing $existing -Incoming $template
$merged = Patch-AllMcpServers -Settings $merged -NpxPath $NpxPath -NodeDir $NodeDir
$json = $merged | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($McpSettingsPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "==> MCP settings written" -ForegroundColor Green

if ($LegacyMcpSettingsPath -ne $McpSettingsPath) {
	New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LegacyMcpSettingsPath) | Out-Null
	Copy-Item $McpSettingsPath $LegacyMcpSettingsPath -Force
	Write-Host "==> Legacy MCP settings updated: $LegacyMcpSettingsPath" -ForegroundColor DarkGray
}

if (Test-Path $RulesTemplate) {
	Copy-Item $RulesTemplate $RulesDest -Force
	Write-Host "==> Global rules: $RulesDest" -ForegroundColor Green
}
$SystemPromptTemplate = Join-Path $RepoRoot "config\lmstudio-system-prompt.md"
$SystemPromptDest = Join-Path $AgentarioRules "agentario-system-prompt-reference.md"
if (Test-Path $SystemPromptTemplate) {
	Copy-Item $SystemPromptTemplate $SystemPromptDest -Force
	Write-Host "==> LM Studio prompt reference: $SystemPromptDest" -ForegroundColor Green
}

if ($NpxPath) {
	Write-Host "==> Pre-downloading MCP packages (npm cache)..." -ForegroundColor Cyan
	$packages = @(
		"@modelcontextprotocol/server-memory",
		"@modelcontextprotocol/server-sequential-thinking",
		"@playwright/mcp"
	)
	foreach ($pkg in $packages) {
		Write-Host "  npm cache add $pkg ..."
		& npm cache add "$pkg@latest" 2>$null
	}
	Write-Host "  Optional: npx playwright install chromium" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done. Restart VS Code and open Agentario -> MCP Servers to verify." -ForegroundColor Cyan
