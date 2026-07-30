import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ThinkingRow } from "./ThinkingRow"

describe("ThinkingRow", () => {
	it("renders streaming title styling and expanded reasoning content", () => {
		render(
			<ThinkingRow
				isExpanded={true}
				isStreaming={true}
				isVisible={true}
				reasoningContent="Inspecting files..."
				showTitle={true}
				title="Размышление…"
			/>,
		)

		const title = screen.getByText("Размышление…")
		expect(title).toBeInTheDocument()
		expect(title).toHaveClass("animate-shimmer")
		expect(screen.getByText("Inspecting files...")).toBeInTheDocument()
	})

	it("shows full reasoning without a max-height scroll box when expanded", () => {
		const longText = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of reasoning`).join("\n")
		const { container } = render(
			<ThinkingRow
				isExpanded={true}
				isVisible={true}
				onToggle={vi.fn()}
				reasoningContent={longText}
				showTitle={true}
				title="Размышление"
			/>,
		)

		expect(screen.getByText(longText)).toBeInTheDocument()
		expect(container.querySelector(".max-h-\\[150px\\]")).toBeNull()
		expect(container.querySelector(".overflow-y-auto")).toBeNull()
		expect(container.querySelector(".sticky")).toBeInTheDocument()
	})

	it("calls onToggle when header is clicked", () => {
		const onToggle = vi.fn()

		render(
			<ThinkingRow
				isExpanded={false}
				isVisible={true}
				onToggle={onToggle}
				reasoningContent="some reasoning"
				showTitle={true}
				title="Размышление"
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Размышление/i }))
		expect(onToggle).toHaveBeenCalledTimes(1)
	})
})
