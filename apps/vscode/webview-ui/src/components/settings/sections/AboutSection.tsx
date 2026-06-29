import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { t } from "@/i18n"
import Section from "../Section"

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

					<h3 className="text-md font-semibold">{t("about.community")}</h3>
					<p>
						<VSCodeLink href="https://x.com/cline">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/cline">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/cline/"> r/cline</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("about.development")}</h3>
					<p>
						<VSCodeLink href="https://github.com/kabzon93region/Agentario">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/kabzon93region/Agentario/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/discussions/categories/feature-requests">
							{t("about.featureRequests")}
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("about.resources")}</h3>
					<p>
						<VSCodeLink href="https://docs.cline.bot/">{t("about.documentation")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/kabzon93region/Agentario">https://github.com/kabzon93region/Agentario</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
