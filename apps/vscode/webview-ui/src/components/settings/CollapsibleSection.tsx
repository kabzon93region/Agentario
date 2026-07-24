import { memo, useState } from "react"

interface CollapsibleSectionProps {
	title: string
	defaultExpanded?: boolean
	children: React.ReactNode
}

const CollapsibleSection = memo<CollapsibleSectionProps>(({ title, defaultExpanded = false, children }) => {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)

	return (
		<div className="my-2">
			<div
				className="flex items-center justify-between cursor-pointer mb-2 px-1 py-1.5 rounded hover:bg-foreground/5 transition-colors"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="text-sm font-semibold text-foreground uppercase tracking-wider">
					{title}
				</div>
				<div className="text-foreground/60 text-sm">
					{isExpanded ? "▼" : "▶"}
				</div>
			</div>
			{isExpanded && (
				<div className="relative p-3 rounded-md border border-foreground/15 space-y-3">
					{children}
				</div>
			)}
		</div>
	)
})
CollapsibleSection.displayName = "CollapsibleSection"

export default CollapsibleSection
