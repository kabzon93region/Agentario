# Apply rebrand changes to SOURCE directory (Z:\T\Agentario)
$ErrorActionPreference = "Continue"
$src = "Z:\T\Agentario"

Write-Host "=== Applying rebrand to SOURCE: $src ==="

# 1. Fix SDK package.json files
Write-Host "--- Fixing SDK package.json files ---"
$sdkPkgFiles = Get-ChildItem -Path "$src\sdk\packages" -Recurse -Include "package.json" -Depth 1
foreach ($f in $sdkPkgFiles) {
    $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    $original = $content
    $content = $content -replace '"@cline/', '"@agentario/'
    if ($content -ne $original) {
        Set-Content -Path $f.FullName -Value $content -NoNewline
        Write-Host "  SDK pkg: $($f.Name)"
    }
}

# 2. Fix apps/vscode/package.json
Write-Host "--- Fixing apps/vscode/package.json ---"
$vscodePkg = "$src\apps\vscode\package.json"
$content = Get-Content $vscodePkg -Raw
$original = $content
$content = $content -replace '"@cline/', '"@agentario/'
# Fix version
$content = $content -replace '"version": "0\.\d+\.\d+"', '"version": "0.8.0"'
if ($content -ne $original) {
    Set-Content -Path $vscodePkg -Value $content -NoNewline
    Write-Host "  Updated apps/vscode/package.json"
}

# 3. Fix variant="primary" in SummarizationSettingsSection.tsx
Write-Host "--- Fixing variant=primary ---"
$sumFile = "$src\apps\vscode\webview-ui\src\components\settings\sections\SummarizationSettingsSection.tsx"
if (Test-Path $sumFile) {
    $content = Get-Content $sumFile -Raw
    $original = $content
    $content = $content -replace 'variant="primary"', 'variant="default"'
    if ($content -ne $original) {
        Set-Content -Path $sumFile -Value $content -NoNewline
        Write-Host "  Fixed variant=primary"
    }
}

# 4. Fix ALL @cline/ imports in TS/TSX source files
Write-Host "--- Fixing @cline/ imports in app source files ---"
$count = 0
$tsFiles = Get-ChildItem -Path "$src\apps\vscode\src", "$src\apps\vscode\webview-ui\src" -Recurse -Include "*.ts","*.tsx" | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\generated\\' -and $_.FullName -notmatch '\\dist\\' }
foreach ($f in $tsFiles) {
    $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains('"@cline/')) {
        $new = $content.Replace('"@cline/', '"@agentario/')
        if ($content -ne $new) {
            Set-Content -Path $f.FullName -Value $new -NoNewline
            $count++
        }
    }
}
Write-Host "  Fixed $count app source files"

# 5. Fix ALL @cline/ imports in SDK source files
Write-Host "--- Fixing @cline/ imports in SDK files ---"
$count = 0
$sdkFiles = Get-ChildItem -Path "$src\sdk" -Recurse -Include "*.ts","*.tsx" | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\dist\\' }
foreach ($f in $sdkFiles) {
    $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains('"@cline/')) {
        $new = $content.Replace('"@cline/', '"@agentario/')
        if ($content -ne $new) {
            Set-Content -Path $f.FullName -Value $new -NoNewline
            $count++
        }
    }
}
Write-Host "  Fixed $count SDK files"

# 6. Fix ALL @cline/ in JSON config files
Write-Host "--- Fixing @cline/ in config files ---"
$count = 0
$jsonFiles = Get-ChildItem -Path "$src" -Recurse -Include "*.json" -Depth 4 | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\dist\\' -and $_.FullName -notmatch '\\.git\\' }
foreach ($f in $jsonFiles) {
    $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains('"@cline/')) {
        $new = $content.Replace('"@cline/', '"@agentario/')
        if ($content -ne $new) {
            Set-Content -Path $f.FullName -Value $new -NoNewline
            $count++
        }
    }
}
Write-Host "  Fixed $count JSON config files"

# 7. Update README version
Write-Host "--- Updating README.md version ---"
$readme = "$src\README.md"
if (Test-Path $readme) {
    $content = Get-Content $readme -Raw
    $content = $content -replace '0\.\d+\.\d+', '0.8.0'
    Set-Content -Path $readme -Value $content -NoNewline
    Write-Host "  README updated"
}

# 8. Ensure slash handler stubs exist
Write-Host "--- Ensuring slash handler stubs exist ---"
$slashDir = "$src\apps\vscode\src\core\controller\slash"
if (-not (Test-Path "$slashDir\openCompactionDebugFile.ts")) {
    Set-Content -Path "$slashDir\openCompactionDebugFile.ts" -Value @'
import { StringRequest, String } from "@/shared/proto/index.agentario"
import { Controller } from "../index"

export const openCompactionDebugFile = async (
	request: StringRequest,
	controller: Controller,
): Promise<String> => {
	return { value: "" }
}
'@ -NoNewline
    Write-Host "  Created openCompactionDebugFile.ts"
}
if (-not (Test-Path "$slashDir\applyCompactionPostProcessing.ts")) {
    Set-Content -Path "$slashDir\applyCompactionPostProcessing.ts" -Value @'
import { StringRequest } from "@/shared/proto/index.agentario"
import { Controller } from "../index"

export const applyCompactionPostProcessing = async (
	request: StringRequest,
	controller: Controller,
): Promise<void> => {}
'@ -NoNewline
    Write-Host "  Created applyCompactionPostProcessing.ts"
}

Write-Host "=== Rebrand applied to SOURCE directory ==="
