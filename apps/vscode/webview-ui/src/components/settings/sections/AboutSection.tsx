import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { t } from "@/i18n"
import Section from "../Section"

const AGENTARIO_REPO = "https://github.com/kabzon93region/Agentario"
const AGENTARIO_ISSUES = "https://github.com/kabzon93region/Agentario/issues"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">{t("about.title", { version })}</h2>
					<p>{t("about.description")}</p>

					<h3 className="text-md font-semibold">{t("about.development")}</h3>
					<p>
						<VSCodeLink href={AGENTARIO_REPO}>GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href={AGENTARIO_ISSUES}>{t("about.featureRequests")}</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("about.resources")}</h3>
					<p>
						<VSCodeLink href={AGENTARIO_REPO}>{t("about.documentation")}</VSCodeLink>
						{" • "}
						<VSCodeLink href={AGENTARIO_REPO}>{AGENTARIO_REPO}</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
