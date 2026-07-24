import { type AgentTool, createTool } from "@agentario/shared"
import * as fs from "node:fs"
import * as path from "node:path"
import { Logger } from "@shared/services/Logger"
import { getDependencyGraph } from "@/services/analysis/DependencyGraph"

// ---------------------------------------------------------------------------
// Error Stack Parser
// ---------------------------------------------------------------------------

interface StackFrame {
	file: string
	line: number | null
	column: number | null
	fn: string | null
}

function parseStack(stack: string): StackFrame[] {
	const frames: StackFrame[] = []
	const lines = stack.split("\n")

	// Patterns for different stack trace formats
	const patterns = [
		// JS/TS: at functionName (file:line:col)
		/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/,
		// JS/TS: at file:line:col (anonymous)
		/at\s+(.+?):(\d+):(\d+)/,
		// Python: File "path", line N, in function
		/File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(.+)/,
		// Go: function(file.go:line)
		/(\w[\w./-]+)\((.+?):(\d+)\)/,
		// Rust: function at file:line:col
		/\d+:\s+(?:\w+\s+)?at\s+(.+?):(\d+):(\d+)/,
	]

	for (const line of lines) {
		for (const pattern of patterns) {
			const match = line.match(pattern)
			if (match) {
				if (pattern.source.includes("File\\s")) {
					// Python format: File, line, function
					frames.push({
						file: match[1],
						line: parseInt(match[2], 10),
						column: null,
						fn: match[3]?.trim() ?? null,
					})
				} else if (match.length === 5) {
					// JS: fn, file, line, col
					frames.push({
						fn: match[1],
						file: match[2],
						line: parseInt(match[3], 10),
						column: parseInt(match[4], 10),
					})
				} else if (match.length === 4) {
					frames.push({
						fn: null,
						file: match[1],
						line: parseInt(match[2], 10),
						column: parseInt(match[3], 10),
					})
				}
				break
			}
		}
	}

	return frames
}

// ---------------------------------------------------------------------------
// Error Classifier
// ---------------------------------------------------------------------------

type ErrorCategory =
	| "null_reference"
	| "type_mismatch"
	| "import_error"
	| "syntax_error"
	| "runtime_crash"
	| "permission_denied"
	| "network_error"
	| "timeout"
	| "logic_error"
	| "resource_exhausted"
	| "unknown"

interface ErrorClassification {
	category: ErrorCategory
	description: string
	likelyCauses: string[]
	suggestedFixes: string[]
}

function classifyError(message: string, _stackFrames: StackFrame[]): ErrorClassification {
	const lower = message.toLowerCase()

	if (lower.includes("cannot read propert") || lower.includes("is null") || lower.includes("is undefined") || lower.includes("nullpointer")) {
		return {
			category: "null_reference",
			description: "Null/undefined reference — accessing a property or method on a null/undefined value",
			likelyCauses: [
				"Variable not initialized before use",
				"Async value not awaited",
				"Optional chaining missing (?.)",
				"API response structure changed",
			],
			suggestedFixes: [
				"Add null check: if (!value) return",
				"Use optional chaining: value?.property",
				"Add default value: const x = data ?? defaultValue",
				"Check API response shape matches expectations",
			],
		}
	}

	if (lower.includes("cannot find module") || lower.includes("module not found") || lower.includes("import error") || lower.includes("no such file")) {
		return {
			category: "import_error",
			description: "Import/module resolution failure — a module or file cannot be found",
			likelyCauses: [
				"File path is incorrect or was moved",
				"Package not installed (npm/bun install missing)",
				"Case sensitivity mismatch on different OS",
				"Missing file extension in import",
			],
			suggestedFixes: [
				"Verify file exists at the expected path",
				"Run package manager install command",
				"Check import path case sensitivity",
				"Add file extension to import",
			],
		}
	}

	if (lower.includes("typeerror") || lower.includes("type mismatch") || lower.includes("argument of type") || lower.includes("expected") && lower.includes("got")) {
		return {
			category: "type_mismatch",
			description: "Type mismatch — wrong type passed to function or assigned",
			likelyCauses: [
				"Function receives unexpected argument type",
				"API response has different shape than expected",
				"Serialization/deserialization mismatch",
			],
			suggestedFixes: [
				"Add runtime type validation (typeof check)",
				"Use type guards or schema validation",
				"Add TypeScript interface for the data",
				"Log the actual value to see what's coming in",
			],
		}
	}

	if (lower.includes("syntaxerror") || lower.includes("unexpected token") || lower.includes("unexpected end")) {
		return {
			category: "syntax_error",
			description: "Syntax error — malformed code that cannot be parsed",
			likelyCauses: [
				"Missing bracket, parenthesis, or semicolon",
				"Incorrect string escaping",
				"Incomplete refactoring left broken code",
			],
			suggestedFixes: [
				"Check for unmatched brackets/parentheses",
				"Verify JSON/config file validity",
				"Review recent changes for incomplete edits",
			],
		}
	}

	if (lower.includes("permission") || lower.includes("eacces") || lower.includes("denied")) {
		return {
			category: "permission_denied",
			description: "Permission denied — insufficient privileges for the operation",
			likelyCauses: [
				"File or directory lacks read/write permissions",
				"Process running as wrong user",
				"Locked resource",
			],
			suggestedFixes: [
				"Check file permissions and ownership",
				"Try running with elevated privileges if appropriate",
				"Verify the path is accessible",
			],
		}
	}

	if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline exceeded")) {
		return {
			category: "timeout",
			description: "Timeout — operation did not complete in time",
			likelyCauses: [
				"Network or I/O operation too slow",
				"Deadlock or infinite loop",
				"Insufficient resources",
			],
			suggestedFixes: [
				"Increase timeout threshold",
				"Add retry logic with exponential backoff",
				"Check for deadlock conditions",
				"Profile to find the slow operation",
			],
		}
	}

	if (lower.includes("enotfound") || lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("network")) {
		return {
			category: "network_error",
			description: "Network error — connection failed",
			likelyCauses: [
				"Server not running or unreachable",
				"Wrong URL/port",
				"DNS resolution failure",
				"Firewall blocking connection",
			],
			suggestedFixes: [
				"Verify server is running on expected port",
				"Check URL correctness",
				"Test connectivity with ping/curl",
				"Check firewall/proxy settings",
			],
		}
	}

	if (lower.includes("out of memory") || lower.includes("heap") || lower.includes("stack overflow") || lower.includes("rangeerror")) {
		return {
			category: "resource_exhausted",
			description: "Resource exhaustion — memory or stack limits exceeded",
			likelyCauses: [
				"Memory leak or unbounded data structure",
				"Infinite recursion",
				"Processing too large a dataset at once",
			],
			suggestedFixes: [
				"Add pagination or streaming for large data",
				"Check for infinite loops/recursion",
				"Profile memory usage to find leaks",
				"Increase resource limits if appropriate",
			],
		}
	}

	if (lower.includes("errno") || lower.includes("uncaught") || lower.includes("panic") || lower.includes("fatal") || lower.includes("segfault")) {
		return {
			category: "runtime_crash",
			description: "Runtime crash — process terminated unexpectedly",
			likelyCauses: [
				"Uncaught exception in async code",
				"Native module failure",
				"Memory corruption or FFI issue",
			],
			suggestedFixes: [
				"Add global error handler (process.on('uncaughtException'))",
				"Wrap async operations in try/catch",
				"Check native module compatibility",
				"Review recent native dependency updates",
			],
		}
	}

	return {
		category: "logic_error",
		description: "Logic error — code runs but produces incorrect results",
		likelyCauses: [
			"Incorrect algorithm or calculation",
			"Edge case not handled",
			"Off-by-one error",
			"Race condition",
		],
		suggestedFixes: [
			"Add debug logging to trace values",
			"Write a failing test that captures the bug",
			"Check boundary conditions",
			"Review the algorithm step by step",
		],
	}
}

// ---------------------------------------------------------------------------
// Tool: diagnose_error (Root Cause Analyzer)
// ---------------------------------------------------------------------------

export function createDiagnoseErrorTool(workspaceRoot: string): AgentTool {
	return createTool({
		name: "diagnose_error",
		description:
			"Diagnose an error by classifying it, parsing the stack trace, and suggesting root causes and fixes. Use this when you encounter an error or unexpected behavior before attempting a fix.",
		inputSchema: {
			type: "object",
			properties: {
				error_message: {
					type: "string",
					description: "The error message or output from the terminal/logs.",
				},
				stack_trace: {
					type: "string",
					description: "Full stack trace if available. Include all lines.",
				},
				context: {
					type: "string",
					description: "What you were doing when the error occurred (e.g., 'running tests', 'building project', 'calling API').",
				},
			},
			required: ["error_message"],
		},
		async execute(input): Promise<string> {
			const typed = input as { error_message: string; stack_trace?: string; context?: string }

			const stack = typed.stack_trace ?? ""
			const frames = parseStack(stack)
			const classification = classifyError(typed.error_message, frames)

			// Find relevant files from stack frames
			const relevantFiles: string[] = []
			for (const frame of frames.slice(0, 10)) {
				if (frame.file && !frame.file.includes("node:")) {
					relevantFiles.push(`${frame.file}${frame.line ? `:${frame.line}` : ""}`)
				}
			}

			// Check dependency graph for impact
			let impactInfo = ""
			if (relevantFiles.length > 0) {
				try {
					const graph = getDependencyGraph(workspaceRoot)
					if (!graph.isBuilt()) {
						await graph.build()
					}
					if (relevantFiles[0]) {
						const deps = graph.getDirectDependents(relevantFiles[0])
						if (deps.length > 0) {
							impactInfo = `\nDependent files (${deps.length}): ${deps.slice(0, 5).join(", ")}${deps.length > 5 ? "..." : ""}`
						}
					}
				} catch {
					// Graph not available, skip
				}
			}

			const lines: string[] = [
				`Error Diagnosis: ${classification.category.toUpperCase()}`,
				"",
				classification.description,
				"",
				typed.context ? `Context: ${typed.context}` : "",
				"",
				"Likely causes:",
				...classification.likelyCauses.map((c) => `  • ${c}`),
				"",
				"Suggested fixes:",
				...classification.suggestedFixes.map((f) => `  → ${f}`),
				"",
			]

			if (relevantFiles.length > 0) {
				lines.push("Relevant files from stack:")
				for (const f of relevantFiles.slice(0, 8)) {
					lines.push(`  📄 ${f}`)
				}
				lines.push("")
			}

			if (impactInfo) {
				lines.push(impactInfo)
			}

			lines.push("Next steps:")
			lines.push("1. Read the most relevant file from the stack trace")
			lines.push("2. Look for the pattern described in 'Likely causes'")
			lines.push("3. Apply the suggested fix")
			lines.push("4. Test the fix")

			return lines.join("\n")
		},
	})
}

// ---------------------------------------------------------------------------
// Tool: suggest_tests (Auto-Test Generation)
// ---------------------------------------------------------------------------

interface TestSuggestion {
	type: "unit" | "integration" | "edge_case" | "regression"
	description: string
	scenario: string
}

function generateTestSuggestions(
	filePath: string,
	exports: string[],
	functionPattern: string,
): TestSuggestion[] {
	const suggestions: TestSuggestion[] = []
	const ext = path.extname(filePath)
	const baseName = path.basename(filePath, ext)

	// Basic tests for each export
	for (const exp of exports.slice(0, 5)) {
		suggestions.push({
			type: "unit",
			description: `Test ${exp} with valid input`,
			scenario: `Verify ${exp} returns correct result for standard input. Mock external dependencies.`,
		})
		suggestions.push({
			type: "edge_case",
			description: `Test ${exp} with empty/null input`,
			scenario: `Verify ${exp} handles null, undefined, empty string, and empty array gracefully without crashing.`,
		})
	}

	// Language-specific suggestions
	if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
		suggestions.push({
			type: "integration",
			description: `Integration test for ${baseName}`,
			scenario: `Test that ${baseName} works correctly when integrated with its real dependencies (not mocked).`,
		})
	}

	// Regression suggestion if we have function patterns
	if (functionPattern.includes("async") || functionPattern.includes("await")) {
		suggestions.push({
			type: "regression",
			description: "Test async error handling",
			scenario: `Verify that async functions properly propagate errors and don't leave resources hanging.`,
		})
	}

	return suggestions
}

export function createSuggestTestsTool(workspaceRoot: string): AgentTool {
	return createTool({
		name: "suggest_tests",
		description:
			"Generate test suggestions for a file or function. Analyzes exports, async patterns, and generates test scenarios (unit, edge_case, integration, regression) to guide test creation.",
		inputSchema: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "Path to the file to generate test suggestions for.",
				},
				focus: {
					type: "string",
					description: "Specific function or feature to focus tests on (optional).",
				},
			},
			required: ["file_path"],
		},
		async execute(input): Promise<string> {
			const typed = input as { file_path: string; focus?: string }

			let content = ""
			try {
				content = fs.readFileSync(typed.file_path, "utf-8")
			} catch {
				return `Test Suggestions: Cannot read file ${typed.file_path}. Check the path.`
			}

			// Extract exports
			const exportPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+)/g
			const exports: string[] = []
			let match: RegExpExecArray | null
			while ((match = exportPattern.exec(content)) !== null) {
				exports.push(match[1])
			}

			// Detect patterns
			const hasAsync = /\basync\s|await\s/.test(content)
			const hasErrorHandling = /\btry\s*\{|catch\s*\(/.test(content)
			const hasClasses = /\bclass\s+\w+/.test(content)
			const hasSwitch = /\bswitch\s*\(/.test(content)
			const hasLoops = /\bfor\s*\(|while\s*\(|\.map\s*\(|\.forEach\s*\(/.test(content)

			const functionPattern = [
				hasAsync ? "async/await" : null,
				hasErrorHandling ? "try/catch" : null,
				hasClasses ? "classes" : null,
				hasSwitch ? "switch/case" : null,
				hasLoops ? "iteration" : null,
			].filter(Boolean).join(", ")

			const suggestions = generateTestSuggestions(typed.file_path, exports, functionPattern)

			const ext = path.extname(typed.file_path)
			const testExt = ext === ".ts" ? ".test.ts" : ext === ".tsx" ? ".test.tsx" : ext === ".js" ? ".test.js" : ".test.js"
			const testPath = typed.file_path.replace(ext, testExt)

			const lines: string[] = [
				`Test Suggestions: ${typed.file_path}`,
				`Suggested test file: ${testPath}`,
				`Exports found: ${exports.length > 0 ? exports.join(", ") : "(none — default export)"}`,
				`Patterns detected: ${functionPattern || "none"}`,
				"",
				"Recommended tests:",
				"",
			]

			for (let i = 0; i < suggestions.length; i++) {
				const s = suggestions[i]!
				lines.push(`${i + 1}. [${s.type.toUpperCase()}] ${s.description}`)
				lines.push(`   ${s.scenario}`)
				lines.push("")
			}

			if (typed.focus) {
				lines.push(`Focus area: ${typed.focus}`)
				lines.push("→ Generate detailed test cases for this specific function/feature.")
			}

			lines.push("")
			lines.push("Testing framework: detect from package.json (vitest, jest, mocha, pytest, etc.)")

			return lines.join("\n")
		},
	})
}

// ---------------------------------------------------------------------------
// Tool: predict_regression (Regression Predictor)
// ---------------------------------------------------------------------------

export function createPredictRegressionTool(workspaceRoot: string): AgentTool {
	return createTool({
		name: "predict_regression",
		description:
			"Predict potential regressions from a planned change. Analyzes which files depend on the target, what exports are affected, and identifies risk areas. Use before making changes to shared modules.",
		inputSchema: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "The file that will be modified.",
				},
				change_type: {
					type: "string",
					description: "Type of change: 'modify_function', 'rename', 'remove_export', 'change_signature', 'add_export', 'other'.",
				},
				export_name: {
					type: "string",
					description: "Name of the specific export/function being changed (if applicable).",
				},
			},
			required: ["file_path", "change_type"],
		},
		async execute(input): Promise<string> {
			const typed = input as { file_path: string; change_type: string; export_name?: string }

			const graph = getDependencyGraph(workspaceRoot)

			const normalized = typed.file_path.replace(/\\/g, "/")

			// Get all dependents
			const directDeps = graph.getDirectDependents(normalized)
			const allDeps = graph.getDependents(normalized)
			const imports = graph.getImports(normalized)

			// Read file content to find the specific export
			let exportUsedIn: string[] = []
			if (typed.export_name) {
				const data = graph.getData()
				if (data) {
					for (const [filePath, node] of data.nodes) {
						if (filePath === normalized) continue
						// Check if this file imports the specific export
						for (const imp of node.imports) {
							if (imp.resolvedPath && imp.resolvedPath.includes(normalized)) {
								// Heuristic: check if export name appears in specifier or file content
								try {
									const content = fs.readFileSync(node.filePath, "utf-8")
									if (content.includes(typed.export_name)) {
										exportUsedIn.push(filePath)
									}
								} catch {
									// Skip unreadable files
								}
							}
						}
					}
				}
			}

			// Risk assessment based on change type
			const riskMap: Record<string, { level: string; reason: string }> = {
				modify_function: { level: "MEDIUM", reason: "Function behavior changes may break callers expecting old behavior." },
				rename: { level: "HIGH", reason: "All references to the old name must be updated. Compile-time errors likely." },
				remove_export: { level: "CRITICAL", reason: "All files importing this export will break. Search and update all imports." },
				change_signature: { level: "HIGH", reason: "All callers must update their arguments. Type errors at compile time." },
				add_export: { level: "LOW", reason: "Adding new export is safe — no existing code depends on it yet." },
				other: { level: "UNKNOWN", reason: "Impact depends on the specific change. Review dependents manually." },
			}

			const risk = riskMap[typed.change_type] ?? riskMap["other"]!

			const lines: string[] = [
				`Regression Prediction: ${normalized}`,
				`Change: ${typed.change_type}${typed.export_name ? ` (${typed.export_name})` : ""}`,
				"",
				`Risk Level: ${risk.level}`,
				`Reason: ${risk.reason}`,
				"",
				`Direct dependents: ${directDeps.length}`,
			]

			if (directDeps.length > 0) {
				lines.push(...directDeps.slice(0, 10).map((d) => `  ⚠ ${d}`))
				if (directDeps.length > 10) {
					lines.push(`  ... and ${directDeps.length - 10} more`)
				}
			}

			lines.push("")
			lines.push(`Total transitive dependents: ${allDeps.length}`)

			if (exportUsedIn.length > 0) {
				lines.push("")
				lines.push(`Files using '${typed.export_name}': ${exportUsedIn.length}`)
				lines.push(...exportUsedIn.slice(0, 10).map((f) => `  ◆ ${f}`))
			}

			lines.push("")
			lines.push("Imports in this file:")
			if (imports.length > 0) {
				lines.push(...imports.slice(0, 10).map((i) => `  ${i.resolvedPath ? "✓" : "✗"} ${i.specifier}`))
			} else {
				lines.push("  (none)")
			}

			lines.push("")
			lines.push("Recommendations:")
			if (directDeps.length === 0) {
				lines.push("  ✓ Safe to change — no files depend on this.")
			} else {
				if (typed.change_type === "remove_export" || typed.change_type === "rename") {
					lines.push("  → Search for all imports of this file and update them")
					lines.push("  → Run full test suite after the change")
				}
				if (typed.change_type === "change_signature") {
					lines.push("  → Update all callers with new arguments")
					lines.push("  → TypeScript will catch most issues at compile time")
				}
				if (typed.change_type === "modify_function") {
					lines.push("  → Check if any tests cover this function")
					lines.push("  → Run dependent tests after the change")
				}
				lines.push(`  → Check ${exportUsedIn.length} files that reference '${typed.export_name ?? "this file"}'`)
			}

			return lines.join("\n")
		},
	})
}
