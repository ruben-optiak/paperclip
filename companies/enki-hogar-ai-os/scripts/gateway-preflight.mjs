#!/usr/bin/env node

import {pathToFileURL} from "node:url";

const exampleId = "safe-read-only-todo-kv";
const requiredChecks = ["allow_read_tool", "deny_write_tool", "audit_written"];

export function validateGatewaySmoke(payload) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  const byName = new Map(checks.map((check) => [check?.name, check]));
  const failures = [];
  if (payload?.ok !== true) failures.push("smoke response did not report ok=true");
  for (const name of requiredChecks) {
    const check = byName.get(name);
    if (!check) failures.push(`missing check ${name}`);
    else if (check.ok !== true) failures.push(`${name} failed${check.reasonCode ? ` (${check.reasonCode})` : ""}`);
  }
  return {ok: failures.length === 0, failures, checks: checks.map((check) => ({name: check.name, ok: check.ok, decision: check.decision ?? null, reasonCode: check.reasonCode ?? null}))};
}

async function callApi(request, url, token) {
  const response = await request(url, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json"},
    body: "{}",
  });
  if (!response.ok) throw new Error(`Gateway preflight endpoint returned HTTP ${response.status}`);
  return response.json();
}

export async function runGatewayPreflight({apiUrl, companyId, token, install = false, request = fetch}) {
  const base = apiUrl.replace(/\/+$/, "");
  const root = `${base}/api/companies/${encodeURIComponent(companyId)}/tools/examples/${exampleId}`;
  if (install) await callApi(request, `${root}/install`, token);
  return validateGatewaySmoke(await callApi(request, `${root}/smoke`, token));
}

function usage() {
  return [
    "Usage: gateway-preflight.mjs [--install] [--json]",
    "",
    "Requires PAPERCLIP_COMPANY_ID and PAPERCLIP_BOARD_TOKEN.",
    "PAPERCLIP_API_URL defaults to http://localhost:3100.",
    "--install explicitly installs the bundled safe fixture before smoke testing it.",
  ].join("\n");
}

async function main() {
  const values = new Set(process.argv.slice(2));
  if (values.has("--help")) {
    console.log(usage());
    return;
  }
  for (const value of values) if (!new Set(["--install", "--json"]).has(value)) throw new Error(`Unknown argument: ${value}`);
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const token = process.env.PAPERCLIP_BOARD_TOKEN;
  if (!companyId || !token) throw new Error("PAPERCLIP_COMPANY_ID and PAPERCLIP_BOARD_TOKEN are required");
  const result = await runGatewayPreflight({
    apiUrl: process.env.PAPERCLIP_API_URL || "http://localhost:3100",
    companyId,
    token,
    install: values.has("--install"),
  });
  if (values.has("--json")) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log("PAPERCLIP GATEWAY PREFLIGHT: PASS (read allowed, write denied, audit visible)");
  else for (const failure of result.failures) console.error(`PAPERCLIP GATEWAY PREFLIGHT: FAIL - ${failure}`);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`Gateway preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
