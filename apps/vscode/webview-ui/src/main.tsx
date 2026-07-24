import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"
import { initAgentarioUiLogger } from "@/utils/agentario-ui-logger"

// Initialize global UI event logging (clicks, snapshots)
initAgentarioUiLogger()

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
