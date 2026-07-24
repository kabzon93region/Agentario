import type { AgentToolDefinition } from "@agentario/shared";
import {
	type ContextBudgetBreakdown,
	type ContextBudgetRuleDetail,
	CONTEXT_BUDGET_NOTICE_KIND,
} from "@agentario/shared";
import type { MessageWithMetadata } from "@agentario/shared";
import {
	createTokenEstimator,
	estimateTokens,
} from "./compaction-shared";

export { CONTEXT_BUDGET_NOTICE_KIND };
export type { ContextBudgetBreakdown, ContextBudgetRuleDetail };

export interface EstimateContextBudgetInput {
	contextWindow: number;
	systemPromptBase: string;
	rules: ReadonlyArray<{ name: string; content: string }>;
	tools: readonly AgentToolDefinition[];
	messages: readonly MessageWithMetadata[];
}

function estimateTextTokens(text: string): number {
	const trimmed = text.trim();
	return trimmed.length > 0 ? estimateTokens(trimmed.length) : 0;
}

function estimateToolsTokens(tools: readonly AgentToolDefinition[]): number {
	if (tools.length === 0) {
		return 0;
	}
	const payload = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
	try {
		return estimateTokens(JSON.stringify(payload).length);
	} catch {
		return tools.reduce(
			(total, tool) =>
				total +
				estimateTextTokens(
					`${tool.name}\n${tool.description ?? ""}\n${JSON.stringify(tool.inputSchema ?? {})}`,
				),
			0,
		);
	}
}

// Agentario: проверка, является ли инструмент MCP (имеет __ в имени)
function isMcpTool(tool: AgentToolDefinition): boolean {
	return tool.name.includes("__");
}

// Agentario: навыки (skills) регистрируются как инструмент с именем "skills"
function isSkillsTool(tool: AgentToolDefinition): boolean {
	return tool.name === "skills";
}

function estimateMcpAndToolsTokens(tools: readonly AgentToolDefinition[]): { mcp: number; tools: number; skills: number } {
	if (tools.length === 0) {
		return { mcp: 0, tools: 0, skills: 0 };
	}
	const mcpTools = tools.filter(isMcpTool);
	const skillsTools = tools.filter(isSkillsTool);
	const regularTools = tools.filter((t) => !isMcpTool(t) && !isSkillsTool(t));
	return {
		mcp: estimateToolsTokens(mcpTools),
		tools: estimateToolsTokens(regularTools),
		skills: estimateToolsTokens(skillsTools),
	};
}

export function estimateContextBudget(
	input: EstimateContextBudgetInput,
): ContextBudgetBreakdown {
	const estimateMessageTokens = createTokenEstimator();
	const system = estimateTextTokens(input.systemPromptBase);

	const rulesDetail: ContextBudgetRuleDetail[] = input.rules.map((rule) => ({
		name: rule.name,
		tokens: estimateTextTokens(rule.content),
	}));
	const rules = rulesDetail.reduce((total, entry) => total + entry.tokens, 0);
	const { mcp, tools, skills } = estimateMcpAndToolsTokens(input.tools);
	const chat = input.messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		0,
	);

	const pinnedEstimated = system + rules + tools + mcp + skills;
	const compressibleEstimated = chat;
	const totalEstimated = pinnedEstimated + compressibleEstimated;
	const contextWindow = Math.max(1, input.contextWindow);

	return {
		contextWindow,
		totalEstimated,
		pinnedEstimated,
		compressibleEstimated,
		categories: { system, rules, tools, mcp, skills, chat },
		...(rulesDetail.length > 0 ? { rulesDetail } : {}),
		measuredAt: Date.now(),
	};
}
