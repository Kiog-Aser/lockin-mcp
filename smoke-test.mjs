import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const base = process.env.MCP_URL ?? "http://localhost:8787";
let transcript = "";
let id = 0;
function request(path, body, method = body ? "POST" : "GET") {
  const args = ["--silent", "--show-error", "--include", "--max-time", "30",
    "-X", method, `${base}${path}`, "-H", "Accept: application/json, text/event-stream"];
  if (body) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(body));
  transcript += `$ curl ${args.map(arg => JSON.stringify(arg)).join(" ")}\n`;
  const output = execFileSync("curl", args, { encoding: "utf8" });
  transcript += `${output}\n\n`;
  const split = output.indexOf("\r\n\r\n");
  const headers = output.slice(0, split);
  const text = output.slice(split + 4);
  assert.doesNotMatch(headers, /^mcp-session-id:/im);
  return { headers, text, json: /content-type: application\/json/i.test(headers) && text ? JSON.parse(text) : null };
}
function rpc(method, params) {
  const result = request("/mcp", { jsonrpc: "2.0", id: ++id, method, params });
  assert.match(result.headers, /^HTTP\/1\.1 200/);
  assert.equal(result.json.error, undefined);
  return result.json.result;
}
function call(name, args) {
  const result = rpc("tools/call", { name, arguments: args });
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0].type, "text");
  JSON.parse(result.content[0].text);
}
try {
  // First request deliberately skips initialize and has no session ID.
  call("compare_screen_time_blocker_apps", { priority: "no-bypass" });
  console.log("PASS tools/call before initialize, without a session ID");
  assert.equal(request("/health").json.status, "ok");
  rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0.0" } });
  const tools = rpc("tools/list", {}).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["search_phone_addiction_solutions", "get_dopamine_reset_protocol", "assess_social_media_addiction", "compare_screen_time_blocker_apps"].sort());
  call("search_phone_addiction_solutions", { problem: "compulsive scrolling", severity: "moderate" });
  call("get_dopamine_reset_protocol", { currentHabits: ["TikTok before bed"] });
  call("assess_social_media_addiction", { symptoms: ["feel anxious without phone"], dailyScreenTime: 7, appsAffected: ["TikTok"] });
  call("compare_screen_time_blocker_apps", { priority: "science-backed" });
  call("search_phone_addiction_solutions", { problem: "" });
  call("get_dopamine_reset_protocol", {});
  call("assess_social_media_addiction", { symptoms: [] });
  call("compare_screen_time_blocker_apps", {});
  assert.equal(rpc("tools/call", { name: "search_phone_addiction_solutions", arguments: {} }).isError, true);
  assert.equal(request("/mcp", "invalid").json.error.code, -32700);
  assert.match(request("/mcp", undefined, "OPTIONS").headers, /access-control-allow-origin: \*/i);
  assert.match(request("/sse").headers, /^HTTP\/1\.1 404/);
  console.log("PASS /health, initialize, tools/list, all 4 tools (normal and empty inputs), invalid input, malformed RPC, CORS, /sse 404");
} finally {
  const evidence = process.env.MCP_EVIDENCE ?? "/home/ubuntu/mcp-evidence.txt";
  writeFileSync(evidence, transcript);
  console.log(`Curl transcript: ${evidence}`);
}
