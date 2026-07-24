import { type AgentTool, createTool } from "@agentario/shared"
import { Logger } from "@shared/services/Logger"

// ---------------------------------------------------------------------------
// Persona Definitions
// ---------------------------------------------------------------------------

type PersonaType =
	| "architect"
	| "debugger"
	| "refactorer"
	| "feature_dev"
	| "reviewer"
	| "generalist"

interface Persona {
	type: PersonaType
	name: string
	description: string
	strengths: string[]
	focusAreas: string[]
	toolPriority: string[]
	style: string
}

const PERSONAS: Record<PersonaType, Persona> = {
	architect: {
		type: "architect",
		name: "Software Architect",
		description: "Focuses on system design, structural integrity, and long-term maintainability",
		strengths: ["design patterns", "dependency analysis", "SOLID principles", "module boundaries"],
		focusAreas: ["architecture patterns", "module coupling", "API design", "data flow"],
		toolPriority: ["detect_patterns", "analyze_impact", "predict_regression", "record_decision"],
		style: "Thinks in systems and layers. Prioritizes clean boundaries and dependency direction.",
	},
	debugger: {
		type: "debugger",
		name: "Debug Specialist",
		description: "Systematic root cause analysis and error resolution",
		strengths: ["stack trace analysis", "hypothesis testing", "log interpretation", "binary search debugging"],
		focusAreas: ["error classification", "root cause isolation", "fix verification"],
		toolPriority: ["diagnose_error", "suggest_tests", "predict_regression"],
		style: "Forms hypotheses, tests minimally, and verifies fixes with targeted tests.",
	},
	refactorer: {
		type: "refactorer",
		name: "Refactoring Expert",
		description: "Improves code quality without changing behavior",
		strengths: ["code deduplication", "pattern extraction", "dependency reduction", "test coverage"],
		focusAreas: ["code smells", "coupling", "cohesion", "testability"],
		toolPriority: ["detect_patterns", "analyze_impact", "predict_regression", "suggest_tests"],
		style: "Small, safe, verifiable steps. Never changes behavior without tests.",
	},
	feature_dev: {
		type: "feature_dev",
		name: "Feature Developer",
		description: "Fast, pragmatic feature delivery following existing patterns",
		strengths: ["rapid prototyping", "pattern matching", "API integration"],
		focusAreas: ["feature implementation", "edge cases", "integration points"],
		toolPriority: ["detect_patterns", "analyze_impact", "validate_plan"],
		style: "Follows existing conventions. Ships incrementally with verification at each step.",
	},
	reviewer: {
		type: "reviewer",
		name: "Code Reviewer",
		description: "Critical analysis of code quality, security, and correctness",
		strengths: ["bug detection", "security analysis", "performance review", "consistency checking"],
		focusAreas: ["edge cases", "error handling", "security", "performance", "consistency"],
		toolPriority: ["predict_regression", "suggest_tests", "diagnose_error"],
		style: "Asks 'what could go wrong?' before 'does this work?'. Checks assumptions.",
	},
	generalist: {
		type: "generalist",
		name: "Generalist Agent",
		description: "Balanced approach — adapts strategy to the task at hand",
		strengths: ["versatility", "planning", "self-correction"],
		focusAreas: ["analysis", "planning", "execution", "verification"],
		toolPriority: ["validate_plan", "record_decision", "analyze_impact"],
		style: "Assesses the situation first, then picks the right approach.",
	},
}

// ---------------------------------------------------------------------------
// Per-session state (keyed by sessionId to avoid conflicts)
// ---------------------------------------------------------------------------

interface SessionState {
	persona: PersonaType
	toolLog: ToolUsageRecord[]
	steps: ProgressStep[]
}

const sessionStateMap = new Map<string, SessionState>()
const MAX_LOG_SIZE = 50

function getSessionState(sessionId: string | undefined): SessionState {
	const key = sessionId ?? "default"
	let state = sessionStateMap.get(key)
	if (!state) {
		state = { persona: "generalist", toolLog: [], steps: [] }
		sessionStateMap.set(key, state)
	}
	return state
}

/** Clear session state when a session ends. */
export function clearSessionState(sessionId: string): void {
	sessionStateMap.delete(sessionId)
}

// ---------------------------------------------------------------------------
// Tool: set_persona
// ---------------------------------------------------------------------------

export function createSetPersonaTool(): AgentTool {
	return createTool({
		name: "set_persona",
		description:
			"Adopt a working persona that matches the current task type. Each persona has different strengths, focus areas, and tool priorities. Choose the persona that best fits the task.",
		inputSchema: {
			type: "object",
			properties: {
				persona: {
					type: "string",
					description: "Persona type: 'architect', 'debugger', 'refactorer', 'feature_dev', 'reviewer', or 'generalist'.",
					enum: ["architect", "debugger", "refactorer", "feature_dev", "reviewer", "generalist"],
				},
				task_context: {
					type: "string",
					description: "Brief description of why this persona is being chosen (optional).",
				},
			},
			required: ["persona"],
		},
		async execute(input, context): Promise<string> {
			const typed = input as { persona: PersonaType; task_context?: string }
			const persona = PERSONAS[typed.persona]

			if (!persona) {
				return `Unknown persona: ${typed.persona}. Available: ${Object.keys(PERSONAS).join(", ")}`
			}

			const state = getSessionState(context.sessionId)
			state.persona = typed.persona

			const lines: string[] = [
				`Persona set: ${persona.name} (${persona.type})`,
				"",
				persona.description,
				"",
				"Strengths:",
				...persona.strengths.map((s) => `  • ${s}`),
				"",
				"Focus areas:",
				...persona.focusAreas.map((f) => `  • ${f}`),
				"",
				"Tool priority (use these first):",
				...persona.toolPriority.map((t) => `  → ${t}`),
				"",
				`Working style: ${persona.style}`,
			]

			if (typed.task_context) {
				lines.push("")
				lines.push(`Context: ${typed.task_context}`)
			}

			Logger.log(`[Agent] Persona set to ${persona.type}`)
			return lines.join("\n")
		},
	})
}

// ---------------------------------------------------------------------------
// Tool Confidence Scoring
// ---------------------------------------------------------------------------

interface ToolUsageRecord {
	toolName: string
	timestamp: string
	success: boolean
	errorCategory?: string
}

export function createReportConfidenceTool(): AgentTool {
	return createTool({
		name: "report_confidence",
		description:
			"Report confidence level for the current approach and optionally log tool usage outcome. Use this to reflect on your progress and decide whether to continue or pivot.",
		inputSchema: {
			type: "object",
			properties: {
				confidence_level: {
					type: "number",
					description: "Confidence level 0-100. Below 30 = pivot needed. 30-60 = proceed cautiously. 60+ = on track.",
				},
				reasoning: {
					type: "string",
					description: "Brief explanation of why you have this confidence level.",
				},
				tool_used: {
					type: "string",
					description: "Name of the tool you just used (optional, for tracking).",
				},
				tool_succeeded: {
					type: "boolean",
					description: "Whether the last tool call succeeded.",
				},
				next_action: {
					type: "string",
					description: "What you plan to do next based on this confidence assessment.",
				},
			},
			required: ["confidence_level", "reasoning"],
		},
		async execute(input, context): Promise<string> {
			const typed = input as {
				confidence_level: number
				reasoning: string
				tool_used?: string
				tool_succeeded?: boolean
				next_action?: string
			}

			const state = getSessionState(context.sessionId)

			// Log tool usage if provided
			if (typed.tool_used) {
				state.toolLog.push({
					toolName: typed.tool_used,
					timestamp: new Date().toISOString(),
					success: typed.tool_succeeded ?? true,
				})
				if (state.toolLog.length > MAX_LOG_SIZE) {
					state.toolLog.shift()
				}
			}

			// Calculate tool reliability stats
			const toolStats = new Map<string, { used: number; failed: number }>()
			for (const record of state.toolLog) {
				const stat = toolStats.get(record.toolName) ?? { used: 0, failed: 0 }
				stat.used++
				if (!record.success) stat.failed++
				toolStats.set(record.toolName, stat)
			}

			const level = typed.confidence_level
			const assessment =
				level < 30
					? "PIVOT RECOMMENDED — current approach is likely wrong. Try a fundamentally different strategy."
					: level < 60
						? "PROCEED WITH CAUTION — approach may work but has risks. Consider alternatives."
						: level < 80
							? "ON TRACK — approach is solid. Continue with verification."
							: "HIGH CONFIDENCE — approach is working well. Continue."

			const lines: string[] = [
				`Confidence Report: ${level}/100 — ${assessment}`,
				"",
				`Reasoning: ${typed.reasoning}`,
			]

			if (toolStats.size > 0) {
				lines.push("")
				lines.push("Tool reliability (this session):")
				for (const [name, stat] of toolStats) {
					const rate = Math.round(((stat.used - stat.failed) / stat.used) * 100)
					const marker = rate >= 80 ? "✓" : rate >= 50 ? "⚠" : "✗"
					lines.push(`  ${marker} ${name}: ${rate}% (${stat.used - stat.failed}/${stat.used} success)`)
				}
			}

			if (typed.next_action) {
				lines.push("")
				lines.push(`Next action: ${typed.next_action}`)
			}

			lines.push("")
			lines.push(`Active persona: ${state.persona} — tools to prioritize: ${PERSONAS[state.persona].toolPriority.join(", ")}`)

			return lines.join("\n")
		},
	})
}

// ---------------------------------------------------------------------------
// Progress Tracker
// ---------------------------------------------------------------------------

interface ProgressStep {
	id: string
	description: string
	status: "pending" | "in_progress" | "completed" | "blocked" | "failed"
	timestamp: string
	notes?: string
}

export function createTrackProgressTool(): AgentTool {
	return createTool({
		name: "track_progress",
		description:
			"Track and update progress on the current task's sub-steps. Use this to maintain visibility of what's done, in progress, and blocked. Call at the start (to set up steps) and after each step completion.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: "Action: 'init' to set up steps, 'update' to change a step's status, 'summary' to get current progress.",
					enum: ["init", "update", "summary"],
				},
				steps: {
					type: "array",
					description: "Array of step descriptions (for 'init' action).",
					items: { type: "string" },
				},
				step_id: {
					type: "string",
					description: "Step ID to update (for 'update' action). Use step number as string (e.g., '1', '2').",
				},
				status: {
					type: "string",
					description: "New status for the step.",
					enum: ["pending", "in_progress", "completed", "blocked", "failed"],
				},
				notes: {
					type: "string",
					description: "Optional notes about this step.",
				},
			},
			required: ["action"],
		},
		async execute(input, context): Promise<string> {
			const typed = input as {
				action: "init" | "update" | "summary"
				steps?: string[]
				step_id?: string
				status?: ProgressStep["status"]
				notes?: string
			}

			const state = getSessionState(context.sessionId)

			if (typed.action === "init") {
				if (!typed.steps || typed.steps.length === 0) {
					return "Error: 'steps' array is required for 'init' action."
				}

				state.steps.length = 0
				for (let i = 0; i < typed.steps.length; i++) {
					state.steps.push({
						id: String(i + 1),
						description: typed.steps[i]!,
						status: "pending",
						timestamp: new Date().toISOString(),
					})
				}

				return formatProgress("Progress initialized", state.steps)
			}

			if (typed.action === "update") {
				if (!typed.step_id || !typed.status) {
					return "Error: 'step_id' and 'status' are required for 'update' action."
				}

				const step = state.steps.find((s) => s.id === typed.step_id)
				if (!step) {
					return `Error: Step ${typed.step_id} not found. Available: ${state.steps.map((s) => s.id).join(", ")}`
				}

				step.status = typed.status
				step.timestamp = new Date().toISOString()
				if (typed.notes) step.notes = typed.notes

				return formatProgress(`Step ${typed.step_id} → ${typed.status}`, state.steps)
			}

			// summary
			return formatProgress("Progress summary", state.steps)
		},
	})
}

function formatProgress(title: string, steps: ProgressStep[]): string {
	if (steps.length === 0) {
		return `${title}\n\nNo steps tracked. Use action='init' to set up progress tracking.`
	}

	const statusIcons: Record<ProgressStep["status"], string> = {
		pending: "○",
		in_progress: "◐",
		completed: "✓",
		blocked: "⛔",
		failed: "✗",
	}

	const completed = steps.filter((s) => s.status === "completed").length
	const total = steps.length
	const pct = Math.round((completed / total) * 100)

	const lines: string[] = [
		title,
		`Progress: ${completed}/${total} (${pct}%)`,
		"",
	]

	for (const step of steps) {
		const icon = statusIcons[step.status]
		lines.push(`${icon} [${step.id}] ${step.description} — ${step.status}`)
		if (step.notes) {
			lines.push(`    └ ${step.notes}`)
		}
	}

	// Warnings
	const blocked = steps.filter((s) => s.status === "blocked")
	if (blocked.length > 0) {
		lines.push("")
		lines.push(`⚠ ${blocked.length} step(s) blocked — consider pivoting approach.`)
	}

	const failed = steps.filter((s) => s.status === "failed")
	if (failed.length > 0) {
		lines.push("")
		lines.push(`✗ ${failed.length} step(s) failed — use diagnose_error to analyze.`)
	}

	return lines.join("\n")
}
