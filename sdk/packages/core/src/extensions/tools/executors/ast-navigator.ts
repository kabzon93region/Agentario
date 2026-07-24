/**
 * AST Navigator — Tree-sitter based code structure analysis.
 *
 * Agentario: Tier 3 of the 3-tier context protection system.
 * Uses web-tree-sitter (WASM) to extract function/class signatures
 * from source code files with high precision.
 *
 * Falls back gracefully if web-tree-sitter is not installed or
 * the language is not supported.
 */

/** Supported language IDs and their file extensions */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
	javascript: [".js", ".jsx", ".mjs", ".cjs"],
	typescript: [".ts", ".tsx", ".mts", ".cts"],
	python: [".py", ".pyi"],
	rust: [".rs"],
	go: [".go"],
	java: [".java"],
};

/** Map file extension to Tree-sitter language ID */
export function detectLanguage(filePath: string): string | null {
	const ext = filePath.toLowerCase().split(".").pop();
	if (!ext) return null;
	for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
		if (exts.includes(`.${ext}`)) return lang;
	}
	return null;
}

export interface AstOutlineEntry {
	line: number;
	kind: "func" | "method" | "class" | "struct" | "interface" | "type" | "enum" | "trait" | "module";
	name: string;
	signature: string;
	parentName?: string; // e.g. class name for methods
}

export interface AstOutlineResult {
	entries: AstOutlineEntry[];
	totalLines: number;
	language: string;
	success: boolean;
	error?: string;
}

// Tree-sitter types (minimal interface to avoid hard dependency)
interface TreeSitterNode {
	type: string;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	text: string;
	childCount: number;
	children: TreeSitterNode[];
	childForFieldName(name: string): TreeSitterNode | null;
}

interface TreeSitterTree {
	rootNode: TreeSitterNode;
	delete(): void;
}

interface TreeSitterParser {
	setLanguage(language: unknown): void;
	parse(input: string): TreeSitterTree;
	delete(): void;
}

/**
 * Try to load web-tree-sitter. Returns null if not installed.
 */
async function loadTreeSitter(): Promise<((new () => TreeSitterParser) & { Language: { load: (path: string) => Promise<unknown> } }) | null> {
	try {
		// Dynamic import to avoid hard dependency
		// @ts-ignore - web-tree-sitter may not be installed
		const mod = await import("web-tree-sitter");
		return mod.default as unknown as (new () => TreeSitterParser) & { Language: { load: (path: string) => Promise<unknown> } };
	} catch {
		return null;
	}
}

/**
 * Node types that represent "definitions" in various languages.
 */
const DEFINITION_NODE_TYPES: Record<string, string[]> = {
	javascript: [
		"function_declaration",
		"function_expression",
		"arrow_function",
		"class_declaration",
		"method_definition",
		"lexical_declaration", // const/let
		"variable_declaration", // var
	],
	typescript: [
		"function_declaration",
		"class_declaration",
		"method_definition",
		"interface_declaration",
		"type_alias_declaration",
		"enum_declaration",
		"abstract_class_declaration",
		"lexical_declaration",
		"variable_declaration",
	],
	python: [
		"function_definition",
		"class_definition",
		"decorated_definition",
	],
	rust: [
		"function_item",
		"struct_item",
		"enum_item",
		"trait_item",
		"impl_item",
		"mod_item",
	],
	go: [
		"function_declaration",
		"method_declaration",
		"type_declaration",
	],
	java: [
		"method_declaration",
		"class_declaration",
		"interface_declaration",
		"enum_declaration",
		"constructor_declaration",
	],
};

/**
 * Extract a readable name from a definition node.
 */
function extractNodeName(node: TreeSitterNode, language: string): string {
	// Try common field names
	const nameNode = node.childForFieldName("name");
	if (nameNode) return nameNode.text;

	// Language-specific fallbacks
	if (language === "python" && node.type === "decorated_definition") {
		const def = node.children.find((c: TreeSitterNode) =>
			c.type === "function_definition" || c.type === "class_definition"
		);
		if (def) return extractNodeName(def, language);
	}

	if (language === "typescript" || language === "javascript") {
		// const/let/var declarations
		if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
			const declarator = node.children.find((c: TreeSitterNode) => c.type === "variable_declarator");
			if (declarator) {
				const name = declarator.childForFieldName("name");
				if (name) return name.text;
			}
		}
	}

	return "<anonymous>";
}

/**
 * Classify a node into an outline entry kind.
 */
function classifyNode(node: TreeSitterNode): AstOutlineEntry["kind"] {
	const type = node.type;
	if (type.includes("class") || type.includes("abstract_class")) return "class";
	if (type.includes("interface")) return "interface";
	if (type.includes("struct")) return "struct";
	if (type.includes("enum")) return "enum";
	if (type.includes("trait")) return "trait";
	if (type.includes("type_alias")) return "type";
	if (type.includes("module") || type.includes("mod_")) return "module";
	if (type.includes("method") || type.includes("constructor")) return "method";
	if (type.includes("function") || type.includes("arrow")) return "func";
	// Variable declarations (const/let/var) — only if they contain functions
	if (type.includes("lexical") || type.includes("variable")) {
		const text = node.text;
		if (text.includes("=>") || text.includes("function")) return "func";
	}
	return "func";
}

/**
 * Recursively walk the AST and collect definition nodes.
 */
function collectDefinitions(
	node: TreeSitterNode,
	language: string,
	entries: AstOutlineEntry[],
	maxEntries: number,
	depth: number = 0,
	parentName?: string,
): void {
	if (entries.length >= maxEntries) return;
	if (depth > 10) return; // prevent infinite recursion

	const defTypes = DEFINITION_NODE_TYPES[language];
	if (!defTypes) return;

	for (const child of node.children) {
		if (entries.length >= maxEntries) return;

		if (defTypes.includes(child.type)) {
			const name = extractNodeName(child, language);
			const kind = classifyNode(child);
			const line = child.startPosition.row + 1; // 1-indexed
			const sig = child.text.length > 120
				? child.text.slice(0, 120) + "..."
				: child.text;

			entries.push({
				line,
				kind,
				name,
				signature: sig.replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
				parentName,
			});

			// For classes/structs/interfaces, recurse into children to find methods
			if (kind === "class" || kind === "struct" || kind === "interface") {
				collectDefinitions(child, language, entries, maxEntries, depth + 1, name);
			}
		} else {
			// Recurse into non-definition nodes
			collectDefinitions(child, language, entries, maxEntries, depth + 1, parentName);
		}
	}
}

/**
 * Format AST outline entries into a readable string.
 */
export function formatAstOutline(result: AstOutlineResult): string {
	if (!result.success || result.entries.length === 0) return "";

	const lines: string[] = [];
	lines.push(`\n=== AST OUTLINE (${result.language}, ${result.entries.length} definitions, ${result.totalLines} lines) ===`);

	const classes = result.entries.filter((e) => ["class", "struct", "interface", "enum", "trait", "type", "module"].includes(e.kind));
	const funcs = result.entries.filter((e) => ["func", "method"].includes(e.kind));

	if (classes.length > 0) {
		lines.push("\nClasses/Types:");
		for (const e of classes) {
			const parent = e.parentName ? ` (${e.parentName})` : "";
			lines.push(`  L${e.line}: [${e.kind}] ${e.name}${parent}`);
		}
	}

	if (funcs.length > 0) {
		lines.push("\nFunctions/Methods:");
		for (const e of funcs) {
			const parent = e.parentName ? ` (${e.parentName})` : "";
			lines.push(`  L${e.line}: [${e.kind}] ${e.name}${parent}`);
		}
	}

	lines.push("\nUse start_line/end_line to read specific definitions. Use semantic_search to find code by meaning.");
	return lines.join("\n");
}

/**
 * Parse a file using Tree-sitter and extract its structure.
 * Returns null if web-tree-sitter is not installed or the language is not supported.
 */
export async function parseFileWithTreeSitter(
	filePath: string,
	maxEntries: number = 100,
): Promise<AstOutlineResult | null> {
	const language = detectLanguage(filePath);
	if (!language) {
		return null;
	}

	// Try to load Tree-sitter
	let Parser: ((new () => TreeSitterParser) & { Language: { load: (path: string) => Promise<unknown> } }) | null;
	try {
		Parser = await loadTreeSitter();
		if (!Parser) return null;
	} catch {
		return null;
	}

	// Try to load the language grammar
	// Note: In production, language WASM files should be bundled or downloaded
	// For now, we try to load from node_modules
	try {
		const wasmPath = `node_modules/web-tree-sitter/tree-sitter-${language}.wasm`;
		const langModule = await Parser.Language.load(wasmPath);

		const parser = new Parser();
		parser.setLanguage(langModule);

		// Read file content
		const fs = await import("node:fs/promises");
		const content = await fs.readFile(filePath, "utf-8");
		const totalLines = content.split("\n").length;

		const tree: TreeSitterTree = parser.parse(content);
		const entries: AstOutlineEntry[] = [];

		collectDefinitions(tree.rootNode, language, entries, maxEntries);

		tree.delete();
		parser.delete();

		return {
			entries,
			totalLines,
			language,
			success: true,
		};
	} catch (err) {
		return {
			entries: [],
			totalLines: 0,
			language,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
