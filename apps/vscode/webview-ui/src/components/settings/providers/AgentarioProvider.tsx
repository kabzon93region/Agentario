import { Mode } from "@shared/storage/types"
import { AgentarioAccountInfoCard } from "../AgentarioAccountInfoCard"
import AgentarioModelPicker from "../AgentarioModelPicker"

/**
 * Props for the AgentarioProvider component
 */
interface ClineProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The Cline provider configuration component
 */
export const AgentarioProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: ClineProviderProps) => {
	return (
		<div>
			{/* Cline Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<AgentarioAccountInfoCard />
			</div>

			{showModelOptions && (
				<AgentarioModelPicker
					currentMode={currentMode}
					initialTab={initialModelTab}
					isPopup={isPopup}
					showProviderRouting={true}
				/>
			)}
		</div>
	)
}
