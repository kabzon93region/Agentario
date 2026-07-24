/**
 * Semantic Search Tool for VS Code Extension
 *
 * Creates the semantic_search tool using the executor from semantic-search-executor.
 */

import { createTool, type AgentTool } from "@agentario/shared"

const SEMANTIC_SEARCH_DESCRIPTION =
	"Search the codebase using semantic similarity (embeddings). " +
	"Unlike search_codebase (regex), this finds code by MEANING — " +
	"use it when you need to find conceptually related code, understand how something works, " +
	"or locate files related to a topic without knowing exact keywords. " +
	"Returns ranked results with file paths, relevance scores, and matching code chunks. " +
	"Best for: finding implementations of concepts, understanding architecture, " +
	"locating relevant code for a feature, or when regex search fails to find what you need."

export function createSemanticSearchTool(
	executor: (query: string, limit: number) => Promise<string>,
): AgentTool {
	return createTool({
		name: "semantic_search",
		description: SEMANTIC_SEARCH_DESCRIPTION,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural language description of what to find (e.g. 'how does context compaction work', 'authentication logic', 'error handling for API calls')",
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
