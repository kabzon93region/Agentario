import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import AgentarioLogoVariable from "./AgentarioLogoVariable"

/**
 * Festive wrapper — same Agentario mark (Santa robot removed with Cline branding).
 */
const AgentarioLogoSanta = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => (
	<AgentarioLogoVariable {...props} />
)

export default AgentarioLogoSanta
