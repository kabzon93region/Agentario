import { Button } from "@/components/ui/button"
import { t } from "@/i18n"
import { getEnvironmentColor } from "@/utils/environmentColors"
import type { Environment } from "../../../../src/shared/config-types"

const ENV_DISPLAY_KEYS: Record<Environment, string> = {
	production: "environment.production",
	staging: "environment.staging",
	local: "environment.local",
	selfHosted: "environment.selfHosted",
}

type ViewHeaderProps = {
	title: string
	onDone: () => void
	showEnvironmentSuffix?: boolean
	environment?: Environment
}

const ViewHeader = ({ title, onDone, showEnvironmentSuffix, environment }: ViewHeaderProps) => {
	const showSubtext = showEnvironmentSuffix && environment && environment !== "production"
	const envLabel = environment ? t(ENV_DISPLAY_KEYS[environment]) : ""
	const titleColor = getEnvironmentColor(environment)

	return (
		<div className="flex justify-between items-center py-2.5 px-5 mb-[17px]">
			<div className="relative">
				<h3 className="m-0 text-lg font-normal" style={{ color: titleColor }}>
					{title}
				</h3>
				{showSubtext && (
					<span className="absolute left-0 top-8 -translate-y-1 text-xs text-description whitespace-nowrap">
						{t("environment.suffix", { env: envLabel })}
					</span>
				)}
			</div>
			<Button size="header" onClick={onDone}>
				{t("common.done")}
			</Button>
		</div>
	)
}

export default ViewHeader
