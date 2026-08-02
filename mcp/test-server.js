// Quick test for agentario-search MCP server
const { spawn } = require("child_process");
const path = require("path");

const server = spawn("node", ["--experimental-strip-types", path.join(__dirname, "agentario-search.ts")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, AGENTARIO_PROJECT_ROOT: "Z:\\T\\Agentario" },
});

server.stdout.on("data", (data) => {
  console.log("RESPONSE:", data.toString());
});

server.stderr.on("data", (data) => {
  console.log("STDERR:", data.toString());
});

// Send initialize request
const initRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

server.stdin.write(initRequest + "\n");

// Wait for response then send tools/list
setTimeout(() => {
  const listRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  server.stdin.write(listRequest + "\n");
}, 500);

// Wait for tools/list response then send a tool call
setTimeout(() => {
  const callRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "list_files",
      arguments: { path: "mcp" },
    },
  });
  server.stdin.write(callRequest + "\n");
}, 1000);

// Exit after collecting responses
setTimeout(() => {
  server.kill();
  process.exit(0);
}, 2000);
