/**
 * Semantic Search Tool for VS Code Extension
 *
 * Creates the semantic_search tool using the executor from semantic-search-executor.
 */

import { createTool, type AgentTool } from "@agentario/shared"

const SEMANTIC_SEARCH_DESCRIPTION =
	"Search the already-built workspace index by meaning (embeddings). Do not list dirs via shell. " +
	"query must be a SHORT topic (2–8 words), e.g. 'README documentation', 'project rules', 'CHANGELOG'. " +
	"For project overview prefer git status + root read_files first; semantic_search fills gaps — do not open with 2–3 README/CHANGELOG queries. Prefer ROOT files (rules.md, convert.py, README.md at cwd); vendor trees like llama-cpp-src are lower priority. " +
	"If useful .md docs are missing at root, read root source and attempt_completion — do not loop the same query. " +
	"NEVER paste the user's full task into query."

const REPEATED_SEMANTIC_QUERY_ERROR =
	"Repeated the same semantic_search query. Do NOT retry it. " +
	"Next: read_files on a concrete ROOT path (rules.md, convert.py, *.md / *.py in cwd), " +
	"or attempt_completion. Nested vendor docs (llama-cpp-src) are not the project overview."

export function createSemanticSearchTool(
	executor: (query: string, limit: number) => Promise<string>,
): AgentTool {
	let lastNormalizedQuery = ""
	let identicalQueryStreak = 0

	return createTool({
		name: "semantic_search",
		description: SEMANTIC_SEARCH_DESCRIPTION,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Short topic (2–8 words), e.g. 'README documentation', 'project rules'. Not the user's full task.",
				},
				limit: {
					type: "number",
					description: "Maximum number of results to return (default: 10, max: 20)",
					default: 10,
				},
			},
			required: ["query"],
		},
		execute: async (input: unknown) => {
			const { query, limit = 10 } = input as { query: string; limit?: number }
			if (!query?.trim()) {
				return { query: "", result: "Error: query is empty", success: false }
			}
			const normalized = query.trim().toLowerCase()
			if (normalized === lastNormalizedQuery) {
				identicalQueryStreak += 1
			} else {
				lastNormalizedQuery = normalized
				identicalQueryStreak = 1
			}
			if (identicalQueryStreak >= 2) {
				return {
					query,
					result: "",
					error: REPEATED_SEMANTIC_QUERY_ERROR,
					success: false,
				}
			}
			const clampedLimit = Math.min(Math.max(1, limit), 20)
			try {
				const result = await executor(query.trim(), clampedLimit)
				return { query, result, success: true }
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				return { query, result: "", error: `Semantic search failed: ${msg}`, success: false }
			}
		},
	})
}
