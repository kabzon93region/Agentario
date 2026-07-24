import { memo, useCallback, useEffect, useRef } from "react"

const TASK_COLORS = [
	{ name: "red", hex: "ef4444" },
	{ name: "orange", hex: "f97316" },
	{ name: "amber", hex: "f59e0b" },
	{ name: "yellow", hex: "eab308" },
	{ name: "lime", hex: "84cc16" },
	{ name: "green", hex: "22c55e" },
	{ name: "emerald", hex: "10b981" },
	{ name: "teal", hex: "14b8a6" },
	{ name: "cyan", hex: "06b6d4" },
	{ name: "sky", hex: "0ea5e9" },
	{ name: "blue", hex: "3b82f6" },
	{ name: "indigo", hex: "6366f1" },
	{ name: "violet", hex: "8b5cf6" },
	{ name: "purple", hex: "a855f7" },
	{ name: "pink", hex: "ec4899" },
	{ name: "gray", hex: "6b7280" },
]

interface ColorPickerPopupProps {
	onSelect: (hex: string) => void
	onClose: () => void
}

const ColorPickerPopup = memo<ColorPickerPopupProps>(({ onSelect, onClose }) => {
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClose()
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [onClose])

	const handleSelect = useCallback(
		(hex: string) => {
			onSelect(hex)
			onClose()
		},
		[onSelect, onClose],
	)

	return (
		<div
			ref={ref}
			className="z-50 bg-menu border border-foreground/15 rounded-md shadow-lg p-2"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}>
			<div className="grid grid-cols-4 gap-1.5">
				{TASK_COLORS.map((color) => (
					<button
						key={color.hex}
						className="w-6 h-6 rounded cursor-pointer border border-foreground/10 hover:scale-110 transition-transform"
						style={{ backgroundColor: `#${color.hex}` }}
						onClick={() => handleSelect(color.hex)}
						title={color.name}
					/>
				))}
			</div>
		</div>
	)
})
ColorPickerPopup.displayName = "ColorPickerPopup"

export default ColorPickerPopup
