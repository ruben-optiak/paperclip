import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTicketBatch, prepareTicketPlans } from "../src/contract.mjs";
import { PublicationJournal } from "../src/journal.mjs";

const fixturePath = fileURLToPath(new URL("../fixtures/valid-batch.json", import.meta.url));
const fixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));

test("the signed fixture is bounded, deterministic, personal-data-free and renders one stable plan", () => {
  const input = fixture();
  const first = prepareTicketPlans(input);
  const second = prepareTicketPlans(structuredClone(input));
  assert.equal(Buffer.byteLength(first.canonical) <= 3900, true);
  assert.equal(first.batchHash, second.batchHash);
  assert.equal(first.plans.length, 1);
  assert.equal(first.plans[0].providerInput.teamKey, "OPT");
  assert.match(first.plans[0].providerInput.description, /## Acceptance criteria/);
  assert.match(first.plans[0].providerInput.description, /optiak-linear-ticket-publisher:v1/);
});

test("the contract rejects duplicates, email addresses, secrets and approval-card overflow", () => {
  const duplicate = fixture();
  duplicate.tickets.push(structuredClone(duplicate.tickets[0]));
  assert.throws(() => parseTicketBatch(duplicate), /invalid_batch/);

  const personal = fixture();
  personal.tickets[0].problem = "Contact person@example.test before creating this issue.";
  assert.throws(() => parseTicketBatch(personal), /sensitive_content_denied/);

  const secret = fixture();
  secret.tickets[0].problem = "Authorization: Bearer aaaaaaaaaaaaaaaaaaaa";
  assert.throws(() => parseTicketBatch(secret), /sensitive_content_denied/);

  const large = fixture();
  large.tickets = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(large.tickets[0]),
    key: `ticket-${index}`,
    title: `Bounded ticket ${index}`,
    acceptanceCriteria: Array.from({ length: 10 }, () => "x".repeat(250)),
  }));
  assert.throws(() => parseTicketBatch(large), /batch_exceeds_approval_display_limit/);
});

test("the journal is idempotent, detects payload drift and marks interrupted writes uncertain", () => {
  const directory = mkdtempSync(join(tmpdir(), "optiak-linear-journal-"));
  const path = join(directory, "journal.sqlite");
  const plan = prepareTicketPlans(fixture()).plans[0];
  let journal = new PublicationJournal(path, { now: () => "2026-09-19T10:00:00.000Z" });
  try {
    assert.equal(journal.prepareBatch([plan])[0].status, "prepared");
    assert.equal(journal.prepareBatch([plan])[0].status, "prepared");
    journal.markCreating(plan.idempotencyKey);
  } finally {
    journal.close();
  }

  journal = new PublicationJournal(path, { now: () => "2026-09-19T10:01:00.000Z", recoverInterrupted: true });
  try {
    assert.equal(journal.get(plan.idempotencyKey).status, "uncertain");
    assert.equal(journal.get(plan.idempotencyKey).error_code, "restart_during_create");
    const changed = { ...plan, payloadHash: "b".repeat(64) };
    assert.throws(() => journal.prepareBatch([changed]), /idempotency_conflict/);
    journal.resolveNotCreated(plan.idempotencyKey, "Board checked Linear and found no matching issue.");
    assert.equal(journal.get(plan.idempotencyKey).status, "prepared");
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manual success resolution accepts only canonical OPT evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "optiak-linear-resolution-"));
  const path = join(directory, "journal.sqlite");
  const plan = prepareTicketPlans(fixture()).plans[0];
  let journal = new PublicationJournal(path);
  journal.prepareBatch([plan]);
  journal.markCreating(plan.idempotencyKey);
  journal.close();
  journal = new PublicationJournal(path, { recoverInterrupted: true });
  try {
    assert.throws(() => journal.resolveSucceeded(plan.idempotencyKey, "OTHER-1", "https://linear.app/optiak/issue/OTHER-1", "manual check"));
    journal.resolveSucceeded(plan.idempotencyKey, "OPT-123", "https://linear.app/optiak/issue/OPT-123/example", "Board inspected the issue in Linear.");
    const row = journal.get(plan.idempotencyKey);
    assert.equal(row.status, "succeeded");
    assert.equal(row.linear_url, "https://linear.app/optiak/issue/OPT-123");
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opening the journal for operator inspection does not rewrite an in-flight entry", () => {
  const directory = mkdtempSync(join(tmpdir(), "optiak-linear-admin-"));
  const path = join(directory, "journal.sqlite");
  const plan = prepareTicketPlans(fixture()).plans[0];
  let journal = new PublicationJournal(path);
  journal.prepareBatch([plan]);
  journal.markCreating(plan.idempotencyKey);
  journal.close();

  journal = new PublicationJournal(path);
  try {
    assert.equal(journal.get(plan.idempotencyKey).status, "creating");
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
