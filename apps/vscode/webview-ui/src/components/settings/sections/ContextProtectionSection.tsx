import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { DebouncedTextField } from "../common/DebouncedTextField"
import CollapsibleSection from "../CollapsibleSection"
import Section from "../Section"
import { updateSettingsPatch } from "../utils/settingsHandlers"

interface ContextProtectionSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ContextProtectionSection = ({ renderSectionHeader }: ContextProtectionSectionProps) => {
	const {
		smartChunkingEnabled,
		showFileOutline,
		maxOutlineEntries,
		smartTruncationEnabled,
		smartTruncationThreshold,
		smartTruncationHead,
		smartTruncationTail,
		astNavigatorEnabled,
	} = useExtensionState()

	return (
		<div className="mb-2">
			{renderSectionHeader("context-protection")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Tier 1: Smart File Navigation */}
					<CollapsibleSection title="Smart File Navigation (Regex)" defaultExpanded={true}>
						<p className="text-xs text-description mb-3">
							Tier 1: Regex-парсинг функций, классов и экспортов из файлов. Работает для всех текстовых файлов без дополнительных зависимостей.
						</p>

						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									Включить Smart Chunking
								</Label>
								<div className="text-xs text-muted-foreground">
									Автоматически парсит структуру больших файлов и возвращает outline с сигнатурами функций/классов.
								</div>
							</div>
							<Switch
								checked={smartChunkingEnabled ?? true}
								onCheckedChange={(checked) => updateSettingsPatch({ smartChunkingEnabled: checked })}
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									Показывать outline файла
								</Label>
								<div className="text-xs text-muted-foreground">
									Добавлять список найденных функций/классов к результату чтения.
								</div>
							</div>
							<Switch
								checked={showFileOutline ?? true}
								onCheckedChange={(checked) => updateSettingsPatch({ showFileOutline: checked })}
							/>
						</div>

						<div className="space-y-1">
							<Label className="text-sm font-semibold">Максимум записей в outline</Label>
							<p className="text-xs text-description">
								Максимальное количество сигнатур в outline (чтобы не раздувать ответ).
							</p>
							<DebouncedTextField
								initialValue={String(maxOutlineEntries ?? 100)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										maxOutlineEntries: Number.isFinite(num) && num > 0 ? num : 100,
									})
								}}
								placeholder="100"
								style={{ width: "100%" }}
							/>
						</div>
					</CollapsibleSection>

					{/* Tier 2: Tool Result Truncation */}
					<CollapsibleSection title="Tool Result Truncation (Proxy)">
						<p className="text-xs text-description mb-3">
							Tier 2: Умное сжатие больших результатов инструментов. Вместо простого обрезания посередине — сохраняет начало и конец с подсказкой.
						</p>

						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									Включить Smart Truncation
								</Label>
								<div className="text-xs text-muted-foreground">
									Для результатов больше порога — head + tail + summary вместо middle-truncation.
								</div>
							</div>
							<Switch
								checked={smartTruncationEnabled ?? true}
								onCheckedChange={(checked) => updateSettingsPatch({ smartTruncationEnabled: checked })}
							/>
						</div>

						<div className="space-y-1">
							<Label className="text-sm font-semibold">Порог Smart Truncation (символы)</Label>
							<p className="text-xs text-description">
								Результаты больше этого размера получают умное сжатие (head + tail + summary).
							</p>
							<DebouncedTextField
								initialValue={String(smartTruncationThreshold ?? 16000)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										smartTruncationThreshold: Number.isFinite(num) && num > 0 ? num : 16000,
									})
								}}
								placeholder="16000"
								style={{ width: "100%" }}
							/>
						</div>

						<div className="space-y-1">
							<Label className="text-sm font-semibold">Размер начала (символы)</Label>
							<p className="text-xs text-description">
								Сколько символов сохранять из начала результата.
							</p>
							<DebouncedTextField
								initialValue={String(smartTruncationHead ?? 2000)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										smartTruncationHead: Number.isFinite(num) && num > 0 ? num : 2000,
									})
								}}
								placeholder="2000"
								style={{ width: "100%" }}
							/>
						</div>

						<div className="space-y-1">
							<Label className="text-sm font-semibold">Размер конца (символы)</Label>
							<p className="text-xs text-description">
								Сколько символов сохранять из конца результата.
							</p>
							<DebouncedTextField
								initialValue={String(smartTruncationTail ?? 1000)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										smartTruncationTail: Number.isFinite(num) && num > 0 ? num : 1000,
									})
								}}
								placeholder="1000"
								style={{ width: "100%" }}
							/>
						</div>
					</CollapsibleSection>

					{/* Tier 3: AST Navigator */}
					<CollapsibleSection title="AST Navigator (Tree-sitter)">
						<p className="text-xs text-description mb-3">
							Tier 3: Точный парсинг кода через Tree-sitter (WASM). Поддерживает TypeScript, JavaScript, Python, Rust, Go, Java. Требует установки web-tree-sitter.
						</p>

						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									Включить AST анализ
								</Label>
								<div className="text-xs text-muted-foreground">
									Использовать Tree-sitter для точного извлечения функций, классов и методов из кода.
								</div>
							</div>
							<Switch
								checked={astNavigatorEnabled ?? false}
								onCheckedChange={(checked) => updateSettingsPatch({ astNavigatorEnabled: checked })}
							/>
						</div>

						<div className="mt-2 p-2 rounded border border-editor-widget-border/30 bg-editor-background/50">
							<p className="text-xs text-muted-foreground">
								Статус: <span className="font-mono">web-tree-sitter</span> — требуется установка через npm.
								<br />
								Поддерживаемые языки: TypeScript, JavaScript, Python, Rust, Go, Java.
							</p>
						</div>
					</CollapsibleSection>

					{/* Fallback Chain Info */}
					<CollapsibleSection title="Цепочка фолбеков">
						<p className="text-xs text-description mb-3">
							Порядок применения методов защиты контекста при чтении больших файлов:
						</p>

						<div className="space-y-2">
							<div className="flex items-start gap-2 p-2 rounded border border-editor-widget-border/30">
								<span className="text-sm font-bold text-blue-400 min-w-[24px]">1.</span>
								<div>
									<Label className="text-sm font-semibold">Smart Chunked Navigation (Regex)</Label>
									<p className="text-xs text-muted-foreground mt-1">
										Regex-парсинг функций/классов. Работает для всех файлов. Активируется первой.
									</p>
								</div>
							</div>

							<div className="flex items-start gap-2 p-2 rounded border border-editor-widget-border/30">
								<span className="text-sm font-bold text-yellow-400 min-w-[24px]">2.</span>
								<div>
									<Label className="text-sm font-semibold">Tool Result Truncation Proxy</Label>
									<p className="text-xs text-muted-foreground mt-1">
										Умное сжатие: head + tail + summary. Срабатывает если regex не нашёл структуру.
									</p>
								</div>
							</div>

							<div className="flex items-start gap-2 p-2 rounded border border-editor-widget-border/30">
								<span className="text-sm font-bold text-green-400 min-w-[24px]">3.</span>
								<div>
									<Label className="text-sm font-semibold">AST Navigator (Tree-sitter)</Label>
									<p className="text-xs text-muted-foreground mt-1">
										Точный парсинг через Tree-sitter WASM. Только для поддерживаемых языков кода.
									</p>
								</div>
							</div>
						</div>

						<div className="mt-3 p-2 rounded bg-editor-background/50 border border-editor-widget-border/30">
							<p className="text-xs text-muted-foreground">
								Каждый уровень активируется только если предыдущий не сработал или дал ошибку.
								Если ни один не сработал — возвращаются первые 200 строк (текущее поведение).
							</p>
						</div>
					</CollapsibleSection>
				</div>
			</Section>
		</div>
	)
}

export default memo(ContextProtectionSection)
