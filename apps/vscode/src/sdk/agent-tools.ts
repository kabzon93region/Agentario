import { type AgentTool, createTool } from "@agentario/shared"
import * as fs from "node:fs"
import * as path from "node:path"
import { homedir } from "node:os"
import { Logger } from "@shared/services/Logger"
import { getDependencyGraph } from "@/services/analysis/DependencyGraph"
import { createDiagnoseErrorTool, createSuggestTestsTool, createPredictRegressionTool } from "./debug-tools"
import { createSetPersonaTool, createReportConfidenceTool, createTrackProgressTool } from "./adaptive-tools"

// ---------------------------------------------------------------------------
// Decision Memory Tool
// ---------------------------------------------------------------------------

interface DecisionRecord {
	timestamp: string
	task: string
	decision: string
	rationale: string
}

function getDecisionsDir(): string {
	const dir = path.join(homedir(), ".agentario", "data", "decisions")
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
	return dir
}

function getDecisionsFile(): string {
	const today = new Date().toISOString().slice(0, 10)
	return path.join(getDecisionsDir(), `${today}.jsonl`)
}

function readDecisions(maxCount = 50): DecisionRecord[] {
	try {
		const dir = getDecisionsDir()
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort()
			.reverse()

		const records: DecisionRecord[] = []
		for (const file of files) {
			if (records.length >= maxCount) break
			const filePath = path.join(dir, file)
			const content = fs.readFileSync(filePath, "utf-8")
			for (const line of content.split("\n").filter(Boolean)) {
				try {
					records.push(JSON.parse(line) as DecisionRecord)
					if (records.length >= maxCount) break
				} catch {
					// skip malformed lines
				}
			}
		}
		return records
	} catch (error) {
		Logger.warn("[AgentTools] Failed to read decisions:", error)
		return []
	}
}

function appendDecision(record: DecisionRecord): void {
	try {
		const filePath = getDecisionsFile()
		fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8")
	} catch (error) {
		Logger.warn("[AgentTools] Failed to append decision:", error)
	}
}

/**
 * Creates the record_decision tool — lets the agent persist important
 * architectural or design decisions for recall later in the session.
 */
export function createRecordDecisionTool(): AgentTool {
	return createTool({
		name: "record_decision",
		description:
			"Record an important decision (architectural, design, trade-off) to persist it for recall later in the session. " +
			"Use this after making significant choices about approach, pattern selection, or trade-off resolution. " +
			"Only record decisions that affect multiple steps or files — not minor implementation details.",
		inputSchema: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: "Short description of the task or sub-goal this decision relates to.",
				},
				decision: {
					type: "string",
					description: "The decision made (e.g. 'Use Repository pattern for data layer', 'Refactor to use event emitter').",
				},
				rationale: {
					type: "string",
					description: "Why this decision was made — the reasoning behind it.",
				},
			},
			required: ["task", "decision", "rationale"],
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: { task: string; decision: string; rationale: string }) => {
			const record: DecisionRecord = {
				timestamp: new Date().toISOString(),
				task: input.task,
				decision: input.decision,
				rationale: input.rationale,
			}
			appendDecision(record)
			return `Decision recorded: ${input.decision}`
		},
	})
}

/**
 * Creates the recall_decisions tool — lets the agent retrieve previously
 * recorded decisions to maintain consistency across a multi-step session.
 */
export function createRecallDecisionsTool(): AgentTool {
	return createTool({
		name: "recall_decisions",
		description:
			"Retrieve previously recorded decisions to maintain consistency. " +
			"Call this at the start of a new sub-goal or when you need to check what was already decided. " +
			"Optionally filter by task keyword.",
		inputSchema: {
			type: "object",
			properties: {
				task_filter: {
					type: "string",
					description: "Optional keyword to filter decisions by task. If omitted, returns all recent decisions.",
				},
			},
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: { task_filter?: string }) => {
			const all = readDecisions(50)
			const filtered = input.task_filter
				? all.filter(
						(r) =>
							r.task.toLowerCase().includes(input.task_filter!.toLowerCase()) ||
							r.decision.toLowerCase().includes(input.task_filter!.toLowerCase()),
					)
				: all

			if (filtered.length === 0) {
				return "No decisions found."
			}

			const formatted = filtered
				.map(
					(r, i) =>
						`${i + 1}. [${r.timestamp}] Task: ${r.task}\n   Decision: ${r.decision}\n   Rationale: ${r.rationale}`,
				)
				.join("\n\n")

			return `Recent decisions (${filtered.length}):\n\n${formatted}`
		},
	})
}

// ---------------------------------------------------------------------------
// Plan Validation Tool
// ---------------------------------------------------------------------------

/**
 * Creates the validate_plan tool — lets the agent check its plan for
 * completeness, missing steps, and potential issues before executing.
 */
export function createValidatePlanTool(): AgentTool {
	return createTool({
		name: "validate_plan",
		description:
			"Validate your implementation plan for completeness and risks before executing. " +
			"Provide the steps and optionally the files you plan to modify. " +
			"Returns a completeness score (0-100) and a list of potential issues.",
		inputSchema: {
			type: "object",
			properties: {
				steps: {
					type: "array",
					items: { type: "string" },
					description: "The ordered steps of your plan.",
				},
				files_to_modify: {
					type: "array",
					items: { type: "string" },
					description: "Files you plan to create or modify.",
				},
				task_description: {
					type: "string",
					description: "A brief description of the overall task.",
				},
			},
			required: ["steps", "task_description"],
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: {
			steps: string[]
			files_to_modify?: string[]
			task_description: string
		}) => {
			const issues: string[] = []
			let score = 100

			// Check: at least 2 steps
			if (input.steps.length < 2) {
				issues.push("Plan has fewer than 2 steps — consider decomposing further.")
				score -= 15
			}

			// Check: no verification step
			const hasVerify = input.steps.some((s) =>
				/verif|test|check|lint|build|compile/i.test(s),
			)
			if (!hasVerify) {
				issues.push("No verification step found (test/lint/build). Add a step to verify the changes.")
				score -= 20
			}

			// Check: no analysis step
			const hasAnalysis = input.steps.some((s) =>
				/read|search|analy|understand|inspect/i.test(s),
			)
			if (!hasAnalysis) {
				issues.push("No analysis step found (read/search/understand). Add a step to understand existing code first.")
				score -= 15
			}

			// Check: files listed
			if (!input.files_to_modify || input.files_to_modify.length === 0) {
				issues.push("No files_to_modify specified — identify the files you will change.")
				score -= 10
			}

			// Check: too many files (risky)
			if (input.files_to_modify && input.files_to_modify.length > 10) {
				issues.push(`Plan modifies ${input.files_to_modify.length} files — consider breaking into smaller tasks.`)
				score -= 10
			}

			// Check: steps too vague
			const vagueSteps = input.steps.filter((s) => s.split(" ").length < 3)
			if (vagueSteps.length > 0) {
				issues.push(`${vagueSteps.length} step(s) are too vague (under 3 words). Make each step more specific.`)
				score -= 10
			}

			score = Math.max(0, score)

			const status = score >= 80 ? "GOOD" : score >= 50 ? "NEEDS REFINEMENT" : "HIGH RISK"

			const result = `Plan Validation: ${status} (score: ${score}/100)\n\nTask: ${input.task_description}\nSteps: ${input.steps.length}\nFiles: ${input.files_to_modify?.length ?? 0}\n\n${issues.length > 0 ? "Issues:\n" + issues.map((i) => "- " + i).join("\n") : "No issues found."}`

			return result
		},
	})
}

// ---------------------------------------------------------------------------
// Impact Analysis Tool
// ---------------------------------------------------------------------------

/**
 * Tool: analyze_impact
 *
 * Analyzes what files will be affected by modifying a given file.
 * Uses the dependency graph to find transitive dependents.
 */
export function createAnalyzeImpactTool(workspaceRoot: string): AgentTool {
	return createTool({
		name: "analyze_impact",
		description:
			"Analyze the blast radius of modifying a file. Shows all files that directly or transitively depend on the target file, so you can assess risk before making changes.",
		inputSchema: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "Path to the file that will be modified (relative to workspace root or absolute).",
				},
				depth: {
					type: "number",
					description: "Maximum traversal depth for transitive dependencies (default: 5).",
				},
			},
			required: ["file_path"],
		},
		async execute(input): Promise<string> {
			const typed = input as { file_path: string; depth?: number }
			const maxDepth = typed.depth ?? 5

			const graph = getDependencyGraph(workspaceRoot)

			if (!graph.isBuilt()) {
				const fileCount = await graph.build()
				if (fileCount === 0) {
					return "Impact Analysis: No scannable files found in workspace."
				}
			}

			const normalizedPath = typed.file_path.replace(/\\/g, "/")

			// Get direct dependents
			const directDeps = graph.getDirectDependents(normalizedPath)

			// Get transitive dependents
			const allDeps = graph.getDependents(normalizedPath)

			// Limit display
			const transitiveDeps = allDeps.filter((d) => !directDeps.includes(d)).slice(0, 50)

			// Get imports of the target file
			const imports = graph.getImports(normalizedPath)

			const stats = graph.getStats()

			const lines: string[] = [
				`Impact Analysis: ${normalizedPath}`,
				`Graph: ${stats.files} files, ${stats.edges} edges (${stats.buildTimeMs}ms)`,
				"",
				`Direct dependents (${directDeps.length}):`,
				...directDeps.slice(0, 20).map((d) => `  → ${d}`),
				...(directDeps.length > 20 ? [`  ... and ${directDeps.length - 20} more`] : []),
				"",
				`Transitive dependents (${transitiveDeps.length}):`,
				...transitiveDeps.slice(0, Math.max(0, maxDepth * 10)).map((d) => `  → ${d}`),
				"",
				`Imports in this file (${imports.length}):`,
				...imports.slice(0, 15).map((i) => `  ${i.resolvedPath ? "✓" : "✗"} ${i.specifier} (${i.type})`),
				...(imports.length > 15 ? [`  ... and ${imports.length - 15} more`] : []),
				"",
				directDeps.length === 0
					? "RISK: LOW — No other files depend on this file."
					: directDeps.length <= 3
						? "RISK: MEDIUM — Few direct dependents."
						: "RISK: HIGH — Many files depend on this file. Proceed carefully.",
			]

			return lines.join("\n")
		},
	})
}

// ---------------------------------------------------------------------------
// Architecture Pattern Detector Tool
// ---------------------------------------------------------------------------

interface PatternMatch {
	name: string
	confidence: number
	evidence: string[]
}

/**
 * Detect common architecture patterns by scanning file structure and content.
 */
function detectPatterns(rootDir: string, files: string[]): PatternMatch[] {
	const patterns: PatternMatch[] = []

	const allFiles = files.map((f) => f.replace(/\\/g, "/").toLowerCase())
	const hasDir = (dir: string) => allFiles.some((f) => f.includes(`/${dir}/`))

	// MVC pattern
	if (hasDir("models") && hasDir("views") && hasDir("controllers")) {
		patterns.push({
			name: "MVC (Model-View-Controller)",
			confidence: 0.9,
			evidence: ["Found models/ directory", "Found views/ directory", "Found controllers/ directory"],
		})
	}

	// Repository pattern
	if (hasDir("repositories") || allFiles.some((f) => /repository\.?(ts|js|py)$/.test(f))) {
		const evidence = hasDir("repositories") ? ["Found repositories/ directory"] : ["Found Repository files"]
		patterns.push({
			name: "Repository Pattern",
			confidence: 0.75,
			evidence,
		})
	}

	// CQRS pattern
	if ((hasDir("commands") || hasDir("handlers")) && (hasDir("queries") || hasDir("query"))) {
		patterns.push({
			name: "CQRS (Command Query Responsibility Segregation)",
			confidence: 0.7,
			evidence: ["Found commands/handlers directory", "Found queries directory"],
		})
	}

	// Monorepo / Multi-package
	if (hasDir("packages") && (hasDir("apps") || hasDir("examples"))) {
		patterns.push({
			name: "Monorepo (Multi-package)",
			confidence: 0.85,
			evidence: ["Found packages/ directory", "Found apps/ or examples/ directory"],
		})
	}

	// Microservices
	const serviceDirs = allFiles.filter((f) => /\/services\/[\w-]+\/(index|main|server)\./.test(f))
	if (serviceDirs.length >= 2) {
		patterns.push({
			name: "Microservices Architecture",
			confidence: 0.6,
			evidence: [`Found ${serviceDirs.length} service entry points`],
		})
	}

	// Component-based (React/Vue/Svelte)
	const componentFiles = allFiles.filter((f) => /\.(tsx|vue|svelte)$/.test(f))
	if (componentFiles.length >= 5) {
		patterns.push({
			name: "Component-Based UI (React/Vue/Svelte)",
			confidence: 0.8,
			evidence: [`Found ${componentFiles.length} component files (.tsx/.vue/.svelte)`],
		})
	}

	// Hexagonal / Ports & Adapters
	if (hasDir("ports") || hasDir("adapters")) {
		patterns.push({
			name: "Hexagonal Architecture (Ports & Adapters)",
			confidence: 0.7,
			evidence: ["Found ports/ or adapters/ directory"],
		})
	}

	// Event-driven
	if (hasDir("events") || hasDir("handlers") || hasDir("listeners")) {
		patterns.push({
			name: "Event-Driven Architecture",
			confidence: 0.55,
			evidence: ["Found events/handlers/listeners directory"],
		})
	}

	return patterns
}

/**
 * Tool: detect_patterns
 *
 * Scans the workspace to identify architecture patterns in use.
 */
export function createDetectPatternsTool(workspaceRoot: string): AgentTool {
	return createTool({
		name: "detect_patterns",
		description:
			"Detect architecture patterns used in the codebase (MVC, Repository, CQRS, Monorepo, Microservices, Component-based, etc.). Helps understand project conventions before making changes.",
		inputSchema: {
			type: "object",
			properties: {
				scope: {
					type: "string",
					description: "Directory to scan (relative to workspace root, or empty for full workspace).",
				},
			},
			required: [],
		},
		async execute(input): Promise<string> {
			const typed = input as { scope?: string }

			const graph = getDependencyGraph(workspaceRoot)
			if (!graph.isBuilt()) {
				await graph.build()
			}

			const data = graph.getData()
			if (!data) {
				return "Pattern Detection: No files found to analyze."
			}

			// Collect all file paths
			let files: string[] = []
			for (const node of data.nodes.values()) {
				files.push(node.relativePath)
			}

			// Filter by scope if provided
			if (typed.scope) {
				const scopeLower = typed.scope.toLowerCase().replace(/\\/g, "/")
				files = files.filter((f) => f.toLowerCase().includes(scopeLower))
			}

			const patterns = detectPatterns(workspaceRoot, files)

			const stats = graph.getStats()

			const lines: string[] = [
				"Architecture Pattern Detection",
				`Scanned ${files.length} files (${stats.files} total in graph)`,
				"",
			]

			if (patterns.length === 0) {
				lines.push("No recognized architecture patterns detected.")
				lines.push("")
				lines.push("This may indicate:")
				lines.push("- A simple script or utility project")
				lines.push("- A non-standard folder structure")
				lines.push("- A new project with minimal structure")
			} else {
				lines.push("Detected patterns:")
				lines.push("")
				for (const p of patterns.sort((a, b) => b.confidence - a.confidence)) {
					const pct = Math.round(p.confidence * 100)
					lines.push(`■ ${p.name} (${pct}% confidence)`)
					for (const e of p.evidence) {
						lines.push(`  • ${e}`)
					}
					lines.push("")
				}
			}

			// Additional insights
			const dirCounts = new Map<string, number>()
			for (const f of files) {
				const parts = f.split("/")
				if (parts.length > 1) {
					const topDir = parts[0]
					dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1)
				}
			}

			const topDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
			if (topDirs.length > 0) {
				lines.push("Top-level directory distribution:")
				for (const [dir, count] of topDirs) {
					lines.push(`  ${dir}/ — ${count} files`)
				}
			}

			return lines.join("\n")
		},
	})
}

/**
 * Returns all agent-mode tools. Called by the session config builder when
 * the mode is "agent".
 */
export function createAgentModeTools(workspaceRoot: string): AgentTool[] {
	return [
		createRecordDecisionTool(),
		createRecallDecisionsTool(),
		createValidatePlanTool(),
		createAnalyzeImpactTool(workspaceRoot),
		createDetectPatternsTool(workspaceRoot),
		createDiagnoseErrorTool(workspaceRoot),
		createSuggestTestsTool(workspaceRoot),
		createPredictRegressionTool(workspaceRoot),
		createSetPersonaTool(),
		createReportConfidenceTool(),
		createTrackProgressTool(),
	]
}
