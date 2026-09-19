#!/usr/bin/env node
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {validateResultEnvelope} from "./validate-result-envelopes.mjs";

const dispositions = new Set(["reject", "needs discovery", "candidate", "scheduled", "urgent defect", "Board decision"]);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function requireValue(ok, code) { if (!ok) throw new Error(code); }
function exactKeys(value, keys) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "expected_object");
  requireValue(Object.keys(value).every(key => keys.includes(key)), "unexpected_field");
}
function instant(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value), "invalid_utc_timestamp");
  const time = Date.parse(value);
  requireValue(Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z"), "invalid_utc_timestamp");
  return time;
}
export function completionRef(context) {
  for (const key of ["runId", "issueId", "companyId", "agentId"]) requireValue(idPattern.test(context?.[key] ?? ""), "invalid_context");
  return `run:${context.runId}/issue:${context.issueId}/final`;
}

// Format/freshness validation, not independent proof that a provider was queried.
export function validateProductSample(sample, {now = Date.now(), evidenceScope, enforceFreshness = true} = {}) {
  exactKeys(sample, ["schema", "teamKey", "retrievedAt", "coverage", "items", "detailIds"]);
  requireValue(sample.schema === "optiak-product-sample/v1" && sample.teamKey === "OPT", "invalid_product_sample");
  requireValue(sample.coverage === "bounded_recent_sample_not_global_ranking", "invalid_coverage");
  requireValue(["fixture_only", "connected_non_production"].includes(evidenceScope), "backlog_is_not_release_evidence");
  const retrieved = instant(sample.retrievedAt);
  requireValue(Number.isFinite(now), "invalid_comparison_time");
  if (enforceFreshness && evidenceScope !== "fixture_only") requireValue(now >= retrieved && now - retrieved <= 900000, "stale_or_future_sample");
  requireValue(Array.isArray(sample.items) && sample.items.length > 0 && sample.items.length <= 10, "invalid_sample_size");
  const ids = new Set();
  for (const item of sample.items) {
    exactKeys(item, ["id", "url", "updatedAt", "observedStatus", "observedPriority", "disposition", "rationale", "nextRole", "decisionRef"]);
    requireValue(/^OPT-[1-9]\d*$/.test(item.id) && !ids.has(item.id), "invalid_or_duplicate_item");
    ids.add(item.id);
    const url = new URL(item.url);
    requireValue(url.origin === "https://linear.app" && !url.username && !url.password && !url.search && !url.hash && new RegExp(`^/optiak/issue/${item.id}(?:/[a-z0-9-]+)?/?$`).test(url.pathname), "invalid_source_url");
    requireValue(item.updatedAt === null || instant(item.updatedAt) <= retrieved, "future_source_update");
    for (const key of ["observedStatus", "rationale", "nextRole"]) requireValue(typeof item[key] === "string" && item[key].trim().length > 0 && item[key].length <= 1200, "missing_item_field");
    requireValue(Number.isInteger(item.observedPriority) && item.observedPriority >= 0 && item.observedPriority <= 4, "invalid_observed_priority");
    requireValue(dispositions.has(item.disposition), "invalid_item_disposition");
    if (item.disposition === "scheduled") requireValue(typeof item.decisionRef === "string" && item.decisionRef.trim().length > 0, "scheduled_requires_authority_reference");
  }
  requireValue(Array.isArray(sample.detailIds) && sample.detailIds.length <= 3 && new Set(sample.detailIds).size === sample.detailIds.length && sample.detailIds.every(id => ids.has(id)), "invalid_detail_selection");
  requireValue(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(JSON.stringify(sample)), "personal_email_not_allowed");
  return sample;
}

// Paperclip's multilineTextSchema expands literal backslash-n/r sequences.
// Encode string escapes so embedded JSON survives that transform unchanged.
export function transportJson(value) {
  return JSON.stringify(value, null, 2).replace(/\\\\/g, "\\u005c").replace(/\\n/g, "\\u000a").replace(/\\r/g, "\\u000d");
}
export function assertStableMarkdown(value) {
  requireValue(value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n") === value, "literal_escaped_linebreak_not_supported");
}
export function prepareCompletion(input, context, {now = Date.now(), enforceFreshness = true} = {}) {
  exactKeys(input, ["envelope", "body", "productSample"]);
  const ref = completionRef(context);
  const envelope = validateResultEnvelope(input.envelope);
  requireValue(envelope.paperclip.issueDisposition === "done" && envelope.report.state === "final", "helper_only_closes_completed_reports");
  requireValue(envelope.report.runRef === context.runId && envelope.report.reportRef === ref, "result_binding_mismatch");
  requireValue(typeof input.body === "string" && input.body.trim().length > 0 && Buffer.byteLength(input.body) <= 24000, "invalid_report_body");
  requireValue(!input.body.includes("optiak-result-envelope/v1") && !input.body.includes("<!-- optiak-completion:"), "duplicate_envelope_in_body");
  assertStableMarkdown(input.body);
  const isSample = envelope.object.type === "linear_backlog_sample";
  if (isSample) {
    requireValue(envelope.object.reviewKind === "product_triage" && envelope.object.verdictVocabulary === "optiak-product-sample/v1" && envelope.object.verdict === "review_complete", "invalid_sample_verdict");
    requireValue(envelope.operations.readiness === "not_assessed", "backlog_is_not_release_evidence");
    validateProductSample(input.productSample, {now, evidenceScope: envelope.evidence.scope, enforceFreshness});
    requireValue(envelope.object.revision === `OPT-sample@${input.productSample.retrievedAt}`, "sample_revision_mismatch");
  } else requireValue(input.productSample === undefined, "unexpected_product_sample");
  const marker = `<!-- optiak-completion:${ref} -->`;
  const details = isSample ? `\n\n### Bounded source ledger\n\n\`\`\`json\n${transportJson(input.productSample)}\n\`\`\`` : "";
  return {status: "done", comment: `${marker}\n${input.body.trim()}${details}\n\n### Result envelope\n\n\`\`\`json\n${transportJson(envelope)}\n\`\`\``};
}

export function createApi({baseUrl, token, runId}, fetchImpl = fetch) {
  const base = new URL(baseUrl);
  requireValue(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash, "invalid_api_url");
  requireValue(typeof token === "string" && token.length > 0, "missing_api_credential");
  // Preserve a run bridge's prefix instead of substituting the host origin.
  const prefix = base.href.replace(/\/$/, "").replace(/\/api$/, "");
  return async (path, method = "GET", body) => {
    requireValue(path.startsWith("/") && !path.includes(".."), "invalid_api_path");
    const response = await fetchImpl(`${prefix}/api${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(runId ? {"X-Paperclip-Run-Id": runId} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) { const error = new Error(`http_${response.status}`); error.status = response.status; throw error; }
    return response.json();
  };
}

export async function completeIssue(input, context, api, options = {}) {
  const payload = prepareCompletion(input, context, {...options, enforceFreshness: false});
  const path = `/issues/${context.issueId}`;
  const marker = `<!-- optiak-completion:${completionRef(context)} -->`;
  async function inspect() {
    const [issue, comments] = await Promise.all([api(path), api(`${path}/comments`)]);
    requireValue(issue.id === context.issueId && issue.companyId === context.companyId && issue.assigneeAgentId === context.agentId, "issue_scope_changed");
    requireValue(Array.isArray(comments), "invalid_comment_response");
    const final = comments.filter(c => c.createdByRunId === context.runId && (c.body.includes("optiak-result-envelope/v1") || c.body.includes("<!-- optiak-completion:")));
    requireValue(final.length <= 1, "duplicate_run_reports");
    if (final.length) requireValue(final[0].body === payload.comment && final[0].body.includes(marker), "existing_report_differs");
    return {issue, final};
  }
  let state = await inspect();
  if (state.final.length && state.issue.status === "done") return {status: "verified", wrote: false, commentId: state.final[0].id};
  requireValue(!state.final.length && state.issue.status === "in_progress" && state.issue.checkoutRunId === context.runId, "requires_owned_active_checkout");
  // An old exact persisted report can be reconciled; a new live claim must be fresh.
  prepareCompletion(input, context, {...options, enforceFreshness: true});
  let ambiguous = false;
  try {
    const response = await api(path, "PATCH", payload);
    requireValue(response.id === context.issueId && response.status === "done", "unexpected_disposition_response");
  } catch (error) {
    // Never replay a write, including 409, authorization denials and timeouts.
    if (error.status && error.status < 500) throw error;
    ambiguous = true;
  }
  state = await inspect();
  requireValue(state.final.length === 1 && state.issue.status === "done", "write_unconfirmed_no_retry");
  return {status: "verified", wrote: true, reconciled: ambiguous, commentId: state.final[0].id};
}

export async function readJsonInput(stream = process.stdin) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    requireValue(bytes <= 262144, "input_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks)));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    requireValue(process.argv.slice(2).every(arg => arg === "--submit") && process.argv.length <= 3, "unsupported_arguments");
    const input = await readJsonInput();
    const context = {runId: process.env.PAPERCLIP_RUN_ID, issueId: process.env.PAPERCLIP_TASK_ID, companyId: process.env.PAPERCLIP_COMPANY_ID, agentId: process.env.PAPERCLIP_AGENT_ID};
    if (process.argv.includes("--submit")) {
      const api = createApi({baseUrl: process.env.PAPERCLIP_API_URL, token: process.env.PAPERCLIP_API_KEY, runId: context.runId});
      console.log(JSON.stringify(await completeIssue(input, context, api)));
    } else {
      const prepared = prepareCompletion(input, context);
      console.log(JSON.stringify({status: "validated", bytes: Buffer.byteLength(prepared.comment), writes: 0}));
    }
  } catch { console.error("Completion rejected or unconfirmed. No automatic write retry; reconcile the current issue before further action."); process.exitCode = 1; }
}
