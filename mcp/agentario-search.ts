#!/usr/bin/env node
/**
 * Agentario Code Search MCP Server (zero dependencies)
 *
 * Built-in MCP server for searching code within the Agentario project.
 * Implements raw MCP protocol (JSON-RPC 2.0 over stdio).
 * No external packages required — only Node.js built-ins.
 *
 * Tools: search_code, search_files, read_file, list_files, grep_types, find_references
 *
 * Usage: node --experimental-strip-types mcp/agentario-search.ts
 *   or:  npx tsx mcp/agentario-search.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";

// --- Config ---
const ROOT = process.env.AGENTARIO_PROJECT_ROOT || process.cwd();
const SERVER_INFO = { name: "agentario-search", version: "1.0.0" };

// --- Helpers ---
function ripgrep(pattern: string, target: string, maxResults = 50): string {
  try {
    const cmd = `rg -n --max-count ${maxResults} --glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!out" --glob "!*.vsix" "${pattern}" "${target}"`;
    return execSync(cmd, { encoding: "utf-8", timeout: 10000, cwd: ROOT });
  } catch (e: any) {
    return e.stdout || e.message || "No results";
  }
}

function globFiles(pattern: string, maxResults = 100): string {
  try {
    const cmd = `rg --files --glob "${pattern}" --glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!out" "${ROOT}" | head -${maxResults}`;
    return execSync(cmd, { encoding: "utf-8", timeout: 10000, cwd: ROOT });
  } catch (e: any) {
    return e.stdout || e.message || "No results";
  }
}

function readFileContent(filePath: string, offset = 0, limit = 200): string {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) return "Error: path traversal not allowed";
  if (!fs.existsSync(fullPath)) return "Error: file not found: " + filePath;
  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");
  const slice = lines.slice(offset, offset + limit);
  return slice.map((line, i) => (offset + i + 1) + "| " + line).join("\n");
}

function listDir(dirPath: string): string {
  const fullPath = path.resolve(ROOT, dirPath);
  if (!fullPath.startsWith(ROOT)) return "Error: path traversal not allowed";
  if (!fs.existsSync(fullPath)) return "Error: directory not found: " + dirPath;
  const items = fs.readdirSync(fullPath, { withFileTypes: true });
  return items
    .map((item) => (item.isDirectory() ? "[DIR] " : "      ") + item.name)
    .join("\n");
}

// --- Tool definitions ---
const TOOLS = [
  {
    name: "search_code",
    description: "Search code by regex pattern using ripgrep. Returns matching lines with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Subdirectory or file to search in (relative to project root). Defaults to whole project." },
        max_results: { type: "number", description: "Maximum number of results. Default: 50" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_files",
    description: "Find files by name pattern (glob). Returns list of matching file paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern for filenames (e.g. '*.ts', '**/compaction*.ts')" },
        max_results: { type: "number", description: "Maximum number of results. Default: 100" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_file",
    description: "Read a file's contents with line numbers. Supports optional offset and limit for large files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        offset: { type: "number", description: "Line number to start from (0-based). Default: 0" },
        limit: { type: "number", description: "Number of lines to read. Default: 200" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List files and directories at a given path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to project root. Defaults to root." },
      },
    },
  },
  {
    name: "grep_types",
    description: "Search for type/interface/class definitions by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the type, interface, or class to find" },
        max_results: { type: "number", description: "Maximum results. Default: 20" },
      },
      required: ["name"],
    },
  },
  {
    name: "find_references",
    description: "Find all references to a symbol (function, class, variable) across the codebase.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol name to find references for" },
        max_results: { type: "number", description: "Maximum results. Default: 30" },
      },
      required: ["symbol"],
    },
  },
];

// --- Tool execution ---
function callTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "search_code": {
      const target = args.path ? path.join(ROOT, String(args.path)) : ROOT;
      return ripgrep(String(args.pattern), target, Number(args.max_results) || 50);
    }
    case "search_files":
      return globFiles(String(args.pattern), Number(args.max_results) || 100);
    case "read_file":
      return readFileContent(String(args.path), Number(args.offset) || 0, Number(args.limit) || 200);
    case "list_files":
      return listDir(String(args.path) || ".");
    case "grep_types": {
      const pattern = "(type|interface|class)\\s+" + args.name + "\\b";
      return ripgrep(pattern, ROOT, Number(args.max_results) || 20);
    }
    case "find_references":
      return ripgrep("\\b" + args.symbol + "\\b", ROOT, Number(args.max_results) || 30);
    default:
      return "Unknown tool: " + name;
  }
}

// --- MCP JSON-RPC server ---
function sendResponse(id: number | string | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function sendError(id: number | string | null, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

function handleRequest(msg: any): void {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      break;

    case "notifications/initialized":
      break;

    case "tools/list":
      sendResponse(id, { tools: TOOLS });
      break;

    case "tools/call": {
      const { name, arguments: args } = params;
      try {
        const text = callTool(name, args || {});
        sendResponse(id, { content: [{ type: "text", text }] });
      } catch (err: any) {
        sendResponse(id, {
          content: [{ type: "text", text: "Error: " + err.message }],
          isError: true,
        });
      }
      break;
    }

    case "ping":
      sendResponse(id, {});
      break;

    default:
      if (id !== null && id !== undefined) {
        sendError(id, -32601, "Method not found: " + method);
      }
  }
}

// --- Main ---
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    handleRequest(msg);
  } catch {
    // Ignore malformed JSON
  }
});

rl.on("close", () => process.exit(0));

process.stderr.write("Agentario Search MCP server v" + SERVER_INFO.version + " running on stdio (root: " + ROOT + ")\n");
