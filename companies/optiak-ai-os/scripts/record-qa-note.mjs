#!/usr/bin/env node
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createApi, readJsonInput, assertStableMarkdown} from "../skills/optiak-durable-completion/scripts/complete-issue.mjs";

export async function recordQaNote({companyId, issueId, reportId, body}, api) {
  if (![companyId, issueId, reportId].every(v => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v ?? ""))) throw new Error("invalid_identity");
  if (typeof body !== "string" || !body.trim() || Buffer.byteLength(body) > 16000) throw new Error("invalid_note");
  assertStableMarkdown(body);
  const path = `/issues/${issueId}`;
  const [issue, comments, live] = await Promise.all([api(path), api(`${path}/comments`), api(`${path}/live-runs`)]);
  if (issue.id !== issueId || issue.companyId !== companyId || issue.status !== "done" || live.length !== 0) throw new Error("requires_closed_idle_issue");
  const report = comments.find(c => c.id === reportId && c.createdByRunId);
  if (!report || !/^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(issue.identifier)) throw new Error("run_linked_report_required");
  const digest = createHash("sha256").update(JSON.stringify({reportId, body: body.trim()})).digest("hex").slice(0, 24);
  const key = `qa-${digest}`;
  const url = `/${issue.identifier.split("-")[0]}/issues/${issue.identifier}#comment-${reportId}`;
  const content = `# Operator QA annotation\n\nSource: [original agent report](${url}).\n\nThis is an annotation, not a new canonical review, approval or request to resume. The original comment and issue disposition are preserved.\n\n${body.trim()}`;
  let existing;
  try { existing = await api(`${path}/documents/${key}`); } catch (error) { if (error.status !== 404) throw error; }
  if (existing && existing.body !== content) throw new Error("immutable_note_conflict");
  let wrote = false;
  if (!existing) {
    // New immutable document only: never POST a comment, edit a decision target,
    // change status/assignee or activate an agent. No automatic write retries.
    try {
      existing = await api(`${path}/documents/${key}`, "PUT", {title: "Operator QA annotation", format: "markdown", body: content, baseRevisionId: null, changeSummary: "QA annotation; no continuation requested"});
      wrote = true;
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      existing = await api(`${path}/documents/${key}`);
      wrote = true;
    }
  }
  const [after, afterLive, afterComments] = await Promise.all([api(path), api(`${path}/live-runs`), api(`${path}/comments`)]);
  if (existing.body !== content || after.status !== "done" || after.assigneeAgentId !== issue.assigneeAgentId || after.assigneeUserId !== issue.assigneeUserId || afterLive.length || afterComments.length !== comments.length) throw new Error("qa_postcondition_failed_no_repair_attempted");
  return {status: "verified", wrote, key, issueIdentifier: issue.identifier, newComments: 0, activeRuns: 0};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--submit" || process.env.PAPERCLIP_RUN_ID) throw new Error("operator_only_explicit_submit");
    const input = await readJsonInput();
    if (Object.keys(input).some(key => !["reportId", "body"].includes(key))) throw new Error("unexpected_input");
    console.log(JSON.stringify(await recordQaNote({...input, companyId: process.env.OPTIAK_COMPANY_ID, issueId: process.env.OPTIAK_ISSUE_ID}, createApi({baseUrl: process.env.OPTIAK_PAPERCLIP_URL, token: process.env.OPTIAK_BOARD_TOKEN})), null, 2));
  } catch { console.error("QA note not confirmed. Do not retry through comments or change the issue disposition."); process.exitCode = 1; }
}
