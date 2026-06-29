#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$TemplatePath = Join-Path $RepoRoot "config\agentario-recommended-mcp.json"
$RulesTemplate = Join-Path $RepoRoot "config\agentario-global-rules.md"

$NodeDir = "C:\Users\Admin\tools\node-v22.14.0-win-x64"
if (Test-Path $NodeDir) {
	$env:Path = "$NodeDir;$env:Path"
}

$ClineData = Join-Path $env:USERPROFILE ".cline\data\settings"
$ClineRules = Join-Path $env:USERPROFILE "Documents\Cline\Rules"
$McpSettingsPath = Join-Path $ClineData "cline_mcp_settings.json"
$RulesDest = Join-Path $ClineRules "agentario-global-rules.md"

Write-Host "==> Agentario MCP setup" -ForegroundColor Cyan
Write-Host "Settings: $McpSettingsPath"

if (-not (Test-Path $TemplatePath)) {
	throw "Template not found: $TemplatePath"
}

New-Item -ItemType Directory -Force -Path $ClineData | Out-Null
New-Item -ItemType Directory -Force -Path $ClineRules | Out-Null

$template = Get-Content $TemplatePath -Raw -Encoding UTF8 | ConvertFrom-Json

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
	return $merged
}

$existing = $null
if (Test-Path $McpSettingsPath) {
	try {
		$existing = Get-Content $McpSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
	} catch {
		Write-Host "  ! Could not parse existing settings, backing up..." -ForegroundColor Yellow
		Copy-Item $McpSettingsPath "$McpSettingsPath.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
	}
}

$merged = Merge-McpSettings -Existing $existing -Incoming $template
$json = $merged | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($McpSettingsPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "==> MCP settings written" -ForegroundColor Green

if (Test-Path $RulesTemplate) {
	Copy-Item $RulesTemplate $RulesDest -Force
	Write-Host "==> Global rules: $RulesDest" -ForegroundColor Green
}

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
Write-Host "  (MCP packages will finish installing on first server start in VS Code)" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Done. Restart VS Code and open Agentario -> MCP Servers to verify." -ForegroundColor Cyan
Write-Host "Optional: enable GitHub MCP after setting GITHUB_PERSONAL_ACCESS_TOKEN in MCP settings." -ForegroundColor DarkGray
