import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PublisherError } from "./errors.mjs";

const migrationPath = fileURLToPath(new URL("../migrations/001_init.sql", import.meta.url));

function utcNow() {
  return new Date().toISOString();
}

function validEvidenceRef(value) {
  return typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 300
    && !/[\r\n]/.test(value);
}

export class PublicationJournal {
  constructor(path, { now = utcNow, recoverInterrupted = false } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    if (recoverInterrupted) {
      const timestamp = this.now();
      this.db.prepare("UPDATE ticket_publications SET status = 'uncertain', error_code = 'restart_during_create', updated_at = ? WHERE status = 'creating'").run(timestamp);
    }
  }

  migrate() {
    this.db.exec(readFileSync(migrationPath, "utf8"));
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(this.now());
  }

  close() {
    this.db.close();
  }

  prepareBatch(plans) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const select = this.db.prepare("SELECT * FROM ticket_publications WHERE idempotency_key = ?");
      const insert = this.db.prepare(`
        INSERT INTO ticket_publications(
          idempotency_key, batch_hash, payload_hash, source_revision_sha256,
          draft_key, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?)
      `);
      const timestamp = this.now();
      const rows = [];
      for (const plan of plans) {
        let row = select.get(plan.idempotencyKey);
        if (!row) {
          insert.run(plan.idempotencyKey, plan.batchHash, plan.payloadHash, plan.sourceRevisionSha256, plan.key, timestamp, timestamp);
          row = select.get(plan.idempotencyKey);
        }
        if (row.payload_hash !== plan.payloadHash || row.source_revision_sha256 !== plan.sourceRevisionSha256 || row.draft_key !== plan.key) {
          throw new PublisherError("idempotency_conflict");
        }
        rows.push(row);
      }
      this.db.exec("COMMIT");
      return rows;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(idempotencyKey) {
    return this.db.prepare("SELECT * FROM ticket_publications WHERE idempotency_key = ?").get(idempotencyKey) ?? null;
  }

  markCreating(idempotencyKey) {
    const result = this.db.prepare(`
      UPDATE ticket_publications
      SET status = 'creating', attempt_count = attempt_count + 1, error_code = NULL, updated_at = ?
      WHERE idempotency_key = ? AND status = 'prepared'
    `).run(this.now(), idempotencyKey);
    if (result.changes !== 1) throw new PublisherError("journal_state_conflict");
  }

  markSucceeded(idempotencyKey, result) {
    const updated = this.db.prepare(`
      UPDATE ticket_publications
      SET status = 'succeeded', linear_identifier = ?, linear_url = ?, error_code = NULL, updated_at = ?
      WHERE idempotency_key = ? AND status = 'creating'
    `).run(result.identifier, result.url, this.now(), idempotencyKey);
    if (updated.changes !== 1) throw new PublisherError("journal_state_conflict", { uncertain: true });
  }

  markFailure(idempotencyKey, code, uncertain) {
    const status = uncertain ? "uncertain" : "failed";
    const result = this.db.prepare(`
      UPDATE ticket_publications SET status = ?, error_code = ?, updated_at = ?
      WHERE idempotency_key = ? AND status = 'creating'
    `).run(status, code, this.now(), idempotencyKey);
    if (result.changes !== 1) throw new PublisherError("journal_state_conflict", { uncertain: true });
  }

  list(status = null) {
    if (status) return this.db.prepare("SELECT * FROM ticket_publications WHERE status = ? ORDER BY updated_at, idempotency_key").all(status);
    return this.db.prepare("SELECT * FROM ticket_publications ORDER BY updated_at, idempotency_key").all();
  }

  resolveSucceeded(idempotencyKey, identifier, url, evidenceRef) {
    if (!/^OPT-[1-9][0-9]{0,8}$/.test(identifier) || !validEvidenceRef(evidenceRef)) throw new PublisherError("invalid_operator_resolution");
    let parsed;
    try { parsed = new URL(url); } catch { throw new PublisherError("invalid_operator_resolution"); }
    if (parsed.origin !== "https://linear.app" || !new RegExp(`^/optiak/issue/${identifier}(?:/[^/?#]+)?/?$`).test(parsed.pathname) || parsed.search || parsed.hash) {
      throw new PublisherError("invalid_operator_resolution");
    }
    const result = this.db.prepare(`
      UPDATE ticket_publications
      SET status = 'succeeded', linear_identifier = ?, linear_url = ?, error_code = NULL,
          operator_evidence_ref = ?, updated_at = ?
      WHERE idempotency_key = ? AND status = 'uncertain'
    `).run(identifier, `https://linear.app/optiak/issue/${identifier}`, evidenceRef.trim(), this.now(), idempotencyKey);
    if (result.changes !== 1) throw new PublisherError("invalid_operator_resolution");
  }

  resolveNotCreated(idempotencyKey, evidenceRef) {
    if (!validEvidenceRef(evidenceRef)) throw new PublisherError("invalid_operator_resolution");
    const result = this.db.prepare(`
      UPDATE ticket_publications
      SET status = 'prepared', error_code = NULL, operator_evidence_ref = ?, updated_at = ?
      WHERE idempotency_key = ? AND status IN ('uncertain', 'failed')
    `).run(evidenceRef.trim(), this.now(), idempotencyKey);
    if (result.changes !== 1) throw new PublisherError("invalid_operator_resolution");
  }

  async backupTo(destination) {
    await backup(this.db, destination);
  }
}
