import { StringRequest } from "@shared/proto/agentario/common"
import { TaskColorRequest } from "@shared/proto/agentario/task"
import { PaletteIcon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import ColorPickerPopup from "@/components/common/ColorPickerPopup"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const [colorPickerTaskId, setColorPickerTaskId] = useState<string | null>(null)

	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
		e.preventDefault()
		e.stopPropagation()
		console.log(`[HistoryPreview] handleContextMenu: taskId=${taskId}, prev=${colorPickerTaskId}`)
		setColorPickerTaskId(colorPickerTaskId === taskId ? null : taskId)
	}, [colorPickerTaskId])

	const handleColorSelect = useCallback((taskId: string, hex: string) => {
		console.log(`[HistoryPreview] handleColorSelect: taskId=${taskId}, hex=${hex}`)
		TaskServiceClient.setTaskColor(
			TaskColorRequest.create({ taskId, taskColor: hex }),
		).then(() => {
			console.log(`[HistoryPreview] setTaskColor OK: taskId=${taskId}, hex=${hex}`)
		}).catch((err) => console.error(`[HistoryPreview] setTaskColor FAILED:`, err))
		setColorPickerTaskId(null)
	}, [])

	const handleRemoveColor = useCallback((taskId: string) => {
		console.log(`[HistoryPreview] handleRemoveColor: taskId=${taskId}`)
		TaskServiceClient.setTaskColor(
			TaskColorRequest.create({ taskId, taskColor: "" }),
		).then(() => {
			console.log(`[HistoryPreview] removeColor OK: taskId=${taskId}`)
		}).catch((err) => console.error(`[HistoryPreview] removeColor FAILED:`, err))
		setColorPickerTaskId(null)
	}, [])

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 8px;
						padding: 10px 12px;
						display: flex;
						align-items: flex-start;
						gap: 12px;
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
						pointer-events: auto;
					}
					.history-task-content {
						flex: 1;
						display: flex;
						align-items: flex-start;
						gap: 8px;
						min-width: 0;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
						line-height: 1.4;
					}
					.history-meta-stack {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						flex-shrink: 0;
					}
					.history-date {
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
						white-space: nowrap;
					}
					.history-cost-chip {
						background-color: var(--vscode-badge-background);
						color: var(--vscode-badge-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.85em;
						font-weight: 500;
						white-space: nowrap;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					}
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{
							marginRight: "4px",
							transform: "scale(0.9)",
						}}></span>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent
					</span>
				</div>
				{taskHistory.filter((item) => item.ts && item.task).length > 0 && (
					<button
						aria-label="View all history"
						className="history-view-all-btn"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<span className="codicon codicon-chevron-right" />
					</button>
				)}
			</div>

			{
				<div className="px-4">
					{taskHistory.filter((item) => item.ts && item.task).length > 0 ? (
						taskHistory
							.filter((item) => item.ts && item.task)
							.slice(0, 3)
							.map((item) => (
								<div
									className="history-preview-item relative"
									key={item.id}
									onClick={() => handleHistorySelect(item.id)}
									onContextMenu={(e) => handleContextMenu(e, item.id)}
									style={item.taskColor ? { borderLeft: `3px solid #${item.taskColor}` } : undefined}>
									<div className="history-task-content">
										{item.isFavorited && (
											<span
												aria-label="Favorited"
												className="codicon codicon-star-full"
												style={{
													color: "var(--vscode-button-background)",
													flexShrink: 0,
												}}
											/>
										)}
										<div className="history-task-description ph-no-capture">{item.task}</div>
									</div>
									<div className="history-meta-stack">
										<span className="history-date">{formatDate(item.ts)}</span>
										{item.totalCost != null && (
											<span className="history-cost-chip">${item.totalCost.toFixed(2)}</span>
										)}
										{/* Кнопка выбора цвета */}
										<button
											className="p-0.5 rounded hover:bg-foreground/10 cursor-pointer border-0 bg-transparent"
											onClick={(e) => {
												e.stopPropagation()
												e.preventDefault()
												console.log(`[HistoryPreview] palette button clicked: taskId=${item.id}, colorPickerTaskId=${colorPickerTaskId}`)
												setColorPickerTaskId(colorPickerTaskId === item.id ? null : item.id)
											}}
												style={item.taskColor ? { color: `#${item.taskColor}` } : { color: "var(--vscode-descriptionForeground)" }}
												title="Выбрать цвет">
											<PaletteIcon size={14} />
										</button>
									</div>
										{/* Color picker popup — вынесен за overflow-hidden через fixed позиционирование */}
										{colorPickerTaskId === item.id && (
											<div className="fixed z-[200]" style={{ left: "50%", top: "30%" }}>
												<ColorPickerPopup
													onClose={() => setColorPickerTaskId(null)}
													onSelect={(hex) => handleColorSelect(item.id, hex)}
												/>
												{item.taskColor && (
													<button
														className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer bg-menu border border-foreground/15 rounded px-2 py-1 hover:bg-foreground/5"
													onClick={(e) => {
															e.stopPropagation()
															handleRemoveColor(item.id)
														}}
													>
														Убрать цвет
													</button>
												)}
											</div>
										)}
								</div>
							))
					) : (
						<div
							style={{
								textAlign: "center",
								color: "var(--vscode-descriptionForeground)",
								fontSize: "var(--vscode-font-size)",
								padding: "10px 0",
							}}>
							No recent tasks
						</div>
					)}
				</div>
			}
		</div>
	)
}

export default memo(HistoryPreview)
