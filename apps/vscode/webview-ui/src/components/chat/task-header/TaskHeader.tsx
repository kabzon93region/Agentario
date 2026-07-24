import { AgentarioMessage } from "@shared/ExtensionMessage"
import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { TaskColorRequest } from "@shared/proto/agentario/task"
import { ChevronDownIcon, ChevronRightIcon, PaletteIcon } from "lucide-react"
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import ColorPickerPopup from "@/components/common/ColorPickerPopup"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import ContextWindow from "./ContextWindow"
import { highlightText } from "./Highlights"

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-foreground/10 hover:bg-foreground/20 text-foreground rounded-sm"

interface TaskHeaderProps {
	task: AgentarioMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	contextBudget?: ContextBudgetBreakdown
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	contextBudget,
	onClose,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
		useAutoCondense,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const [showColorPicker, setShowColorPicker] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)
	

	// Цвет плашки таска из состояния
	const taskColor = currentTaskItem?.taskColor



	// Установить цвет таска
	const handleColorSelect = useCallback((hex: string) => {
		if (!currentTaskItem?.id) return
		console.log(`[TaskHeader] handleColorSelect: taskId=${currentTaskItem.id}, hex=${hex}`)
		TaskServiceClient.setTaskColor(
			TaskColorRequest.create({ taskId: currentTaskItem.id, taskColor: hex }),
		).then(() => {
			console.log(`[TaskHeader] setTaskColor OK: taskId=${currentTaskItem.id}, hex=${hex}`)
		}).catch((err) => console.error(`[TaskHeader] setTaskColor FAILED:`, err))
		setShowColorPicker(false)
	}, [currentTaskItem?.id])

	// Убрать цвет таска
	const handleRemoveColor = useCallback(() => {
		if (!currentTaskItem?.id) return
		console.log(`[TaskHeader] handleRemoveColor: taskId=${currentTaskItem.id}`)
		TaskServiceClient.setTaskColor(
			TaskColorRequest.create({ taskId: currentTaskItem.id, taskColor: "" }),
		).then(() => {
			console.log(`[TaskHeader] removeColor OK: taskId=${currentTaskItem.id}`)
		}).catch((err) => console.error(`[TaskHeader] removeColor FAILED:`, err))
		setShowColorPicker(false)
	}, [currentTaskItem?.id])

	const highlightedText = useMemo(() => highlightText(currentTaskItem?.task || task.text, false), [task.text, currentTaskItem?.task])

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [task.text, isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Simplified computed values
	const { selectedModelInfo } = useNormalizedApiConfiguration(mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	// Local providers report no cost; the openai-compatible provider can
	// report cost only when the user has supplied both prices. For every
	// other provider, the SDK is the source of truth for whether to render
	// per-task cost: providers with `metadata.usageCostDisplay = "hide"`
	// (e.g. ChatGPT Plus/Pro subscription) are filtered out here. This
	// mirrors the CLI's `shouldShowCliUsageCost` consumer and removes the
	// previous extension-side hard-coded "openai-codex" check.
	const usageCostDisplay = useProviderUsageCostDisplay(modeFields.apiProvider)
	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" &&
			modeFields.apiProvider !== "ollama" &&
			modeFields.apiProvider !== "lmstudio" &&
			usageCostDisplay !== "hide")

	// Event handlers
	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className="py-2 px-4 flex flex-col gap-2 relative">
			{/* Task Header */}
			<div
				className={cn(
					"relative overflow-hidden cursor-pointer rounded-sm flex flex-col gap-1.5 z-10 pt-2 pb-2 px-2 hover:opacity-100 bg-(--vscode-toolbar-hoverBackground)/65",
					{
						"opacity-100 border-1": isTaskExpanded,
						"hover:bg-toolbar-hover border-1": !isTaskExpanded,
					},
				)}
				style={{
					borderColor: environmentBorderColor,
					...(taskColor ? { borderLeft: `4px solid #${taskColor}` } : {}),
				}}>
				{/* Task Title */}
				<div
					aria-label={isTaskExpanded ? "Collapse task header" : "Expand task header"}
					className="flex justify-between items-center cursor-pointer"
					onClick={(e) => {
						// Не сворачивать/разворачивать если клик по кнопке внутри
						if ((e.target as HTMLElement).closest("button")) {
							return
						}
						toggleTaskExpanded()
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							e.stopPropagation()
							toggleTaskExpanded()
						}
					}}
					tabIndex={0}>
					<div className="flex justify-between items-center">
						{isTaskExpanded ? <ChevronDownIcon size="16" /> : <ChevronRightIcon size="16" />}
						{isTaskExpanded && (
							<div className="mt-1 flex justify-end cursor-pointer opacity-80 gap-2 mx-2">
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								{/* Кнопка выбора цвета плашки */}
								<button
									className={cn(BUTTON_CLASS, "flex items-center justify-center")}
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										setShowColorPicker(true)
									}}
									style={taskColor ? { color: `#${taskColor}` } : undefined}
									title="Выбрать цвет таска">
									<PaletteIcon size={14} />
								</button>
								<DeleteTaskButton
									className={BUTTON_CLASS}
									taskId={currentTaskItem?.id}
									taskSize={currentTaskItem?.size}
								/>
							</div>
						)}
					</div>
					<div className="flex items-center select-none grow min-w-0 gap-1 justify-between">
						{!isTaskExpanded && (
							<div className="whitespace-nowrap overflow-hidden text-ellipsis grow min-w-0">
								<span className="ph-no-capture text-base">{highlightedText}</span>
							</div>
						)}
					</div>
					<div className="inline-flex items-center justify-end select-none shrink-0 gap-1">
						{currentTaskItem?.id && (
							<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem.id} />
						)}
						{isCostAvailable && (
							<div
								className="mx-1 px-1 py-0.25 rounded-full inline-flex shrink-0 text-badge-background bg-badge-foreground/80 items-center"
								id="price-tag">
								<span className="text-xs sm:text-sm">${totalCost?.toFixed(4)}</span>
							</div>
						)}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</div>
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						<div
							className={cn(
								"ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm mt-1 relative",
								"max-h-[4.5rem] overflow-hidden",
								{
									"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded,
									"cursor-pointer": isTextOverflowing,
								},
							)}
							onClick={() => isTextOverflowing && setIsHighlightedTextExpanded(true)}
							ref={highlightedTextRef}
							style={
								!isHighlightedTextExpanded && isTextOverflowing
									? {
											WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
											maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
										}
									: undefined
							}>
							{highlightedText}
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextBudget={contextBudget}
							contextWindow={selectedModelInfo?.contextWindow}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							useAutoCondense={useAutoCondense ?? false}
						/>
					</div>
				)}
			</div>

			{/* Color picker popup — открывается слева, вне overflow-hidden контейнера */}
			{showColorPicker && currentTaskItem?.id && (
				<div className="absolute left-4 top-12 z-[100]">
					<ColorPickerPopup
						onClose={() => setShowColorPicker(false)}
						onSelect={handleColorSelect}
					/>
					{taskColor && (
						<button
							className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer bg-menu border border-foreground/15 rounded px-2 py-1 hover:bg-foreground/5"
							onClick={(e) => {
								e.stopPropagation()
								handleRemoveColor()
							}}>
							Убрать цвет
						</button>
					)}
				</div>
			)}
		</div>
	)
}

export default TaskHeader
