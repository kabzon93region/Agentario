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
	/**
	 * Scale from prior provider usage / prior unscaled estimate (EMA).
	 * Aligns char-based totalEstimated with the provider tokenizer.
	 */
	providerScale?: number;
}

const MIN_PROVIDER_SCALE = 0.7;
const MAX_PROVIDER_SCALE = 2.2;

export function clampContextBudgetProviderScale(scale: number): number {
	if (!Number.isFinite(scale) || scale <= 0) {
		return 1;
	}
	return Math.min(MAX_PROVIDER_SCALE, Math.max(MIN_PROVIDER_SCALE, scale));
}

/**
 * Update EMA scale after a request: measured input tokens vs the unscaled
 * estimate that was posted for that same request.
 */
export function updateContextBudgetProviderScale(
	previousScale: number,
	measuredInputTokens: number,
	unscaledTotalEstimated: number,
): number {
	if (
		!(measuredInputTokens > 0) ||
		!(unscaledTotalEstimated > 0) ||
		!Number.isFinite(previousScale)
	) {
		return clampContextBudgetProviderScale(previousScale || 1);
	}
	const ratio = measuredInputTokens / unscaledTotalEstimated;
	const blended = previousScale * 0.55 + ratio * 0.45;
	return clampContextBudgetProviderScale(blended);
}

export function scaleContextBudgetBreakdown(
	breakdown: ContextBudgetBreakdown,
	scale: number,
): ContextBudgetBreakdown {
	const safe = clampContextBudgetProviderScale(scale);
	if (Math.abs(safe - 1) < 0.02) {
		return breakdown;
	}
	const s = (n: number) => Math.max(0, Math.round(n * safe));
	const categories = {
		system: s(breakdown.categories.system),
		rules: s(breakdown.categories.rules),
		tools: s(breakdown.categories.tools),
		mcp: s(breakdown.categories.mcp ?? 0),
		skills: s(breakdown.categories.skills ?? 0),
		chat: s(breakdown.categories.chat),
	};
	const pinnedEstimated =
		categories.system +
		categories.rules +
		categories.tools +
		categories.mcp +
		categories.skills;
	const compressibleEstimated = categories.chat;
	return {
		...breakdown,
		categories,
		pinnedEstimated,
		compressibleEstimated,
		totalEstimated: pinnedEstimated + compressibleEstimated,
		...(breakdown.rulesDetail
			? {
					rulesDetail: breakdown.rulesDetail.map((rule) => ({
						...rule,
						tokens: s(rule.tokens),
					})),
				}
			: {}),
	};
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

function isMcpTool(tool: AgentToolDefinition): boolean {
	return tool.name.includes("__");
}

function isSkillsTool(tool: AgentToolDefinition): boolean {
	return tool.name === "skills";
}

function estimateMcpAndToolsTokens(tools: readonly AgentToolDefinition[]): {
	mcp: number;
	tools: number;
	skills: number;
} {
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
	const estimateMessageTokens = createTokenEstimator("provider");
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

	const raw: ContextBudgetBreakdown = {
		contextWindow,
		totalEstimated,
		pinnedEstimated,
		compressibleEstimated,
		categories: { system, rules, tools, mcp, skills, chat },
		...(rulesDetail.length > 0 ? { rulesDetail } : {}),
		measuredAt: Date.now(),
	};

	if (input.providerScale != null && input.providerScale !== 1) {
		return scaleContextBudgetBreakdown(raw, input.providerScale);
	}
	return raw;
}