# Agentario Search MCP Server

Built-in MCP server for searching code within Agentario projects. No external services required — uses ripgrep (rg) internally.

## Tools

| Tool | Description |
|------|-------------|
| `search_code` | Search file contents by regex pattern (ripgrep) |
| `search_files` | Find files by name pattern (glob) |
| `read_file` | Read file contents with line numbers |
| `list_files` | List directory contents |
| `grep_types` | Find type/interface/class definitions by name |
| `find_references` | Find all references to a symbol |

## Usage

### As a standalone MCP server

```bash
cd mcp && npx tsx agentario-search.ts
```

### In MCP profile (Cursor)

Add to your MCP profile JSON:

```json
"agentario-search": {
  "command": "npx",
  "args": ["tsx", "mcp/agentario-search.ts"],
  "cwd": "Z:\\T\\Agentario",
  "env": {
    "AGENTARIO_PROJECT_ROOT": "Z:\\T\\Agentario"
  }
}
```

### Prerequisites

- `rg` (ripgrep) must be installed and in PATH
- Node.js 18+
