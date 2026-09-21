#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { PublicationJournal } from "./journal.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`missing_${name.replace(/^--/, "")}`);
  return value;
}

function safeRows(rows) {
  return rows.map((row) => ({
    idempotencyKey: row.idempotency_key,
    draftKey: row.draft_key,
    status: row.status,
    attempts: row.attempt_count,
    identifier: row.linear_identifier,
    url: row.linear_url,
    errorCode: row.error_code,
    operatorEvidenceRef: row.operator_evidence_ref,
    updatedAt: row.updated_at,
  }));
}

async function main() {
  const command = process.argv[2];
  if (command === "restore") {
    const input = resolve(required("--input"));
    const output = resolve(required("--output"));
    if (!existsSync(input) || existsSync(output)) throw new Error("restore_requires_existing_input_and_new_output");
    const source = new DatabaseSync(input, { readOnly: true });
    await backup(source, output);
    source.close();
    console.log(JSON.stringify({ outcome: "restored_to_new_file", output }));
    return;
  }
  const path = resolve(required("--journal"));
  const journal = new PublicationJournal(path);
  try {
    if (command === "migrate" || command === "doctor") {
      console.log(JSON.stringify({ outcome: "ready", journal: path, entries: journal.list().length }));
    } else if (command === "list") {
      const status = option("--status");
      console.log(JSON.stringify({ entries: safeRows(journal.list(status)) }, null, 2));
    } else if (command === "resolve-succeeded") {
      journal.resolveSucceeded(required("--key"), required("--identifier"), required("--url"), required("--evidence"));
      console.log(JSON.stringify({ outcome: "resolved_succeeded", key: required("--key") }));
    } else if (command === "resolve-not-created") {
      journal.resolveNotCreated(required("--key"), required("--evidence"));
      console.log(JSON.stringify({ outcome: "resolved_not_created", key: required("--key") }));
    } else if (command === "backup") {
      const output = resolve(required("--output"));
      if (existsSync(output)) throw new Error("backup_output_exists");
      await journal.backupTo(output);
      console.log(JSON.stringify({ outcome: "backup_created", output }));
    } else {
      throw new Error("unknown_command");
    }
  } finally {
    journal.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "admin_failure");
  process.exit(1);
});
