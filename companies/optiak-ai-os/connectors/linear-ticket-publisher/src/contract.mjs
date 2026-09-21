import { createHash } from "node:crypto";
import { z } from "zod";
import { PublisherError } from "./errors.mjs";

export const BATCH_SCHEMA = "optiak-linear-ticket-batch/v1";
export const RESULT_SCHEMA = "optiak-linear-ticket-publication/v1";
export const TEAM_KEY = "OPT";
export const TOOL_NAME = "optiak_linear_create_issue_batch";
export const MAX_SIGNED_ARGUMENT_BYTES = 3900;

const compactText = (maximum) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

const ticketSchema = z.object({
  key: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
  title: compactText(160).refine((value) => !/[\r\n]/.test(value)),
  problem: compactText(500),
  desiredOutcome: compactText(500),
  acceptanceCriteria: z.array(compactText(280)).min(1).max(10),
  nonGoals: z.array(compactText(280)).min(1).max(8),
  dependencies: z.array(compactText(180)).max(8),
  evidenceRefs: z.array(compactText(220)).min(1).max(8),
  priority: z.enum(["no_priority", "urgent", "high", "normal", "low"]),
}).strict();

export const ticketBatchSchema = z.object({
  schema: z.literal(BATCH_SCHEMA),
  source: z.object({
    ref: compactText(200).refine((value) => !/[\r\n]/.test(value)),
    revisionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  tickets: z.array(ticketSchema).min(1).max(5),
}).strict().superRefine((value, context) => {
  const keys = value.tickets.map((ticket) => ticket.key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "duplicate_ticket_key" });
  }
  const titles = value.tickets.map((ticket) => ticket.title.toLocaleLowerCase("en"));
  if (new Set(titles).size !== titles.length) {
    context.addIssue({ code: "custom", message: "duplicate_ticket_title" });
  }
});

const priorityValues = Object.freeze({
  no_priority: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function allStrings(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, found));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => allStrings(entry, found));
  return found;
}

function containsUnsafeContent(value) {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)) return true;
  if (/\b(?:authorization|api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]/i.test(value)) return true;
  if (/\bbearer\s+[A-Za-z0-9._~-]{12,}/i.test(value)) return true;
  for (const match of value.matchAll(/https?:\/\/[^\s)\]}]+/gi)) {
    try {
      const url = new URL(match[0]);
      if (url.username || url.password || url.search) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function parseTicketBatch(input) {
  const result = ticketBatchSchema.safeParse(input);
  if (!result.success) throw new PublisherError("invalid_batch");
  const serialized = canonical(result.data);
  if (Buffer.byteLength(serialized) > MAX_SIGNED_ARGUMENT_BYTES) {
    throw new PublisherError("batch_exceeds_approval_display_limit");
  }
  if (allStrings(result.data).some(containsUnsafeContent)) {
    throw new PublisherError("sensitive_content_denied");
  }
  return { value: result.data, canonical: serialized, batchHash: sha256(serialized) };
}

function bullets(values, empty = "- None declared") {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : empty;
}

export function prepareTicketPlans(input) {
  const parsed = parseTicketBatch(input);
  const plans = parsed.value.tickets.map((ticket) => {
    const idempotencyKey = `linear:${parsed.value.source.revisionSha256}:${ticket.key}`;
    const marker = sha256(idempotencyKey);
    const description = [
      "## Problem",
      ticket.problem,
      "",
      "## Desired outcome",
      ticket.desiredOutcome,
      "",
      "## Acceptance criteria",
      ...ticket.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
      "## Non-goals",
      bullets(ticket.nonGoals),
      "",
      "## Dependencies",
      bullets(ticket.dependencies),
      "",
      "## Evidence",
      bullets(ticket.evidenceRefs),
      "",
      "---",
      `Source: ${parsed.value.source.ref}`,
      `Immutable revision (SHA-256): ${parsed.value.source.revisionSha256}`,
      `Draft key: ${ticket.key}`,
      `<!-- optiak-linear-ticket-publisher:v1:${marker} -->`,
    ].join("\n");
    const providerInput = {
      teamKey: TEAM_KEY,
      title: ticket.title,
      description,
      priority: priorityValues[ticket.priority],
    };
    return {
      key: ticket.key,
      idempotencyKey,
      batchHash: parsed.batchHash,
      payloadHash: sha256(canonical(providerInput)),
      sourceRevisionSha256: parsed.value.source.revisionSha256,
      providerInput,
    };
  });
  return { ...parsed, plans };
}
