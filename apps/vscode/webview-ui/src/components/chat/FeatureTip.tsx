import { LightbulbIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { t } from "@/i18n"
import { cn } from "@/lib/utils"

const SHOW_DELAY_MS = 2000
const CYCLE_INTERVAL_MS = 8000
const FADE_DURATION_MS = 300

/**
 * Shows rotating feature tips below the "Thinking..." indicator.
 */
export const FeatureTip = memo(() => {
	const featureTips = useMemo(
		() => [
			t("featureTips.doubleCheck"),
			t("featureTips.clinerules"),
			t("featureTips.planMode"),
			t("featureTips.atContext"),
			t("featureTips.mcp"),
			t("featureTips.checkpoints"),
			t("featureTips.compact"),
			t("featureTips.autoApprove"),
			t("featureTips.quote"),
			t("featureTips.dragDrop"),
			t("featureTips.reportBug"),
			t("featureTips.disableTips"),
		],
		[],
	)

	const [isVisible, setIsVisible] = useState(false)
	const [hasFadedIn, setHasFadedIn] = useState(false)
	const [isFading, setIsFading] = useState(false)
	const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * featureTips.length))
	const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const currentTip = featureTips[tipIndex]

	const advanceTip = useCallback(() => {
		setIsFading(true)
		fadeTimerRef.current = setTimeout(() => {
			setTipIndex((prev) => (prev + 1) % featureTips.length)
			setIsFading(false)
		}, FADE_DURATION_MS)
	}, [featureTips.length])

	useEffect(() => {
		showTimerRef.current = setTimeout(() => {
			setIsVisible(true)
			requestAnimationFrame(() => setHasFadedIn(true))
			cycleTimerRef.current = setInterval(advanceTip, CYCLE_INTERVAL_MS)
		}, SHOW_DELAY_MS)

		return () => {
			if (showTimerRef.current) {
				clearTimeout(showTimerRef.current)
			}
			if (cycleTimerRef.current) {
				clearInterval(cycleTimerRef.current)
			}
			if (fadeTimerRef.current) {
				clearTimeout(fadeTimerRef.current)
			}
		}
	}, [advanceTip])

	if (!isVisible) {
		return null
	}

	return (
		<div
			className={cn(
				"flex items-start gap-1.5 mt-2 ml-1 transition-opacity duration-300",
				!hasFadedIn || isFading ? "opacity-0" : "opacity-100",
			)}>
			<LightbulbIcon className="size-3 text-description shrink-0 mt-[1px]" />
			<span className="text-xs text-description leading-relaxed">
				<span className="font-medium">{t("featureTips.tipLabel")}</span> {currentTip}
			</span>
		</div>
	)
})

FeatureTip.displayName = "FeatureTip"
