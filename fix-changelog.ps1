$content = Get-Content CHANGELOG.md -Raw
$newEntry = @"

## [0.14.15] — 2026-07-26

### Fixed
- **Некорректный размер чанков суммаризации**: createTokenEstimator() считал токены по JSON.stringify(block).length для tool_use и tool_result блоков, а serializeMessage() обрезал tool output до 2000 символов. Расхождение до 12.5x. Исправлено: estimator теперь считает по ТОМУ ЖЕ формату что и serializeMessage().
- **Полоска контекста не обновлялась**: normalizeUsageEvent() читал DELTA inputTokens вместо кумулятивного totalInputTokens. Исправлено.

## [0.14.14] — 2026-07-26

### Fixed
- **PowerShell escape-символы в путях**: добавлена sanitizePowerShellCommand() в shell.ts.

### Changed
- **System prompt: инструкции по индексации**: запрет на Get-ChildItem -Recurse, использование semantic_search и search_codebase.

"@
$content = $content -replace '(## \[0\.14\.2\])', "$newEntry`n`n`$1"
Set-Content CHANGELOG.md -Value $content
