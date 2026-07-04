import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { StateManager } from "@/core/storage/StateManager"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { resetAgentarioData } from "@/shared/reset-agentario-data"
import type { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Полный сброс Agentario: настройки, кеш, индекс, MCP и пресеты.
 * Пользовательские файлы правил не удаляются; стандартные правила перезаписываются.
 */
export async function resetAgentario(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const userChoice = await HostProvider.window.showMessage({
		type: ShowMessageType.WARNING,
		message:
			"Сбросить Agentario? Будут удалены настройки, API-ключи, пресеты моделей, индексация, история чатов и кеш. Пользовательские файлы правил сохранятся; стандартный agentario-global-rules.md будет восстановлен.",
		options: { modal: true, items: ["Сбросить", "Отмена"] },
	})

	if (userChoice.selectedOption !== "Сбросить") {
		return Empty.create()
	}

	try {
		const controller = _controller
		if (controller.task) {
			controller.task.abortTask()
			controller.task = undefined
		}

		await resetAgentarioData(StateManager.get())

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Agentario сброшен. Перезапустите VS Code, если MCP-серверы не обновились.",
		})

		await controller.postStateToWebview()
		await sendChatButtonClickedEvent()

		return Empty.create()
	} catch (error) {
		Logger.error("[resetAgentario] Failed:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Не удалось сбросить Agentario: ${error instanceof Error ? error.message : String(error)}`,
		})
		throw error
	}
}
