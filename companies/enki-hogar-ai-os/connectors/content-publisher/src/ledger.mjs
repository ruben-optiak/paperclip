import {createHash} from "node:crypto";
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function emptyLedger() {
  return {schema: "enki-publication-journal/v1", entries: {}};
}

function journalKey(provider, operation, idempotencyKey) {
  return `${provider}:${operation}:${idempotencyKey}`;
}

export class PublicationLedger {
  constructor(path, {now = () => new Date()} = {}) {
    this.path = path;
    this.now = now;
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      if (parsed?.schema !== "enki-publication-journal/v1" || !parsed.entries || typeof parsed.entries !== "object") {
        throw new Error("Publication journal has an unsupported schema");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyLedger();
      throw error;
    }
  }

  async save(ledger) {
    await mkdir(dirname(this.path), {recursive: true, mode: 0o700});
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {mode: 0o600});
    await rename(temporary, this.path);
  }

  serial(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async execute({provider, operation, idempotencyKey, request}, effect) {
    return this.serial(async () => {
      const ledger = await this.load();
      const key = journalKey(provider, operation, idempotencyKey);
      const hash = requestHash(request);
      const existing = ledger.entries[key];
      if (existing) {
        if (existing.request_hash !== hash) throw new Error("Idempotency key already belongs to different publication arguments");
        if (existing.state === "succeeded") return {...existing.result, idempotent_replay: true};
        throw new Error("Previous publication outcome is uncertain; reconcile the operator journal before retrying");
      }

      const startedAt = this.now().toISOString();
      ledger.entries[key] = {
        provider,
        operation,
        idempotency_key: idempotencyKey,
        request_hash: hash,
        state: "inflight",
        started_at: startedAt,
        updated_at: startedAt,
      };
      await this.save(ledger);

      try {
        const result = await effect();
        const completedAt = this.now().toISOString();
        ledger.entries[key] = {
          ...ledger.entries[key],
          state: "succeeded",
          updated_at: completedAt,
          result,
        };
        await this.save(ledger);
        return {...result, idempotent_replay: false};
      } catch (error) {
        const failedAt = this.now().toISOString();
        ledger.entries[key] = {
          ...ledger.entries[key],
          state: "uncertain",
          updated_at: failedAt,
          failure: "provider_call_failed_or_outcome_unknown",
        };
        await this.save(ledger);
        throw error;
      }
    });
  }

  async list() {
    const ledger = await this.load();
    return Object.values(ledger.entries).map(({result, ...entry}) => ({
      ...entry,
      external_id: result?.external_id ?? null,
      canonical_url: result?.canonical_url ?? null,
    }));
  }

  async reconcile({provider, operation, idempotencyKey, outcome, externalId = null, canonicalUrl = null, status = null}) {
    return this.serial(async () => {
      const ledger = await this.load();
      const key = journalKey(provider, operation, idempotencyKey);
      const existing = ledger.entries[key];
      if (!existing) throw new Error("Publication journal entry not found");
      if (existing.state === "succeeded") throw new Error("Succeeded publication journal entries cannot be rewritten");
      if (outcome === "not-applied") {
        delete ledger.entries[key];
        await this.save(ledger);
        return {outcome, retry_allowed: true};
      }
      const allowedStatuses = new Set(["draft", "pending", "future", "publish", "published"]);
      if (outcome !== "applied" || !externalId || !allowedStatuses.has(status)) throw new Error("Applied reconciliation requires an external ID and verified status");
      existing.state = "succeeded";
      existing.updated_at = this.now().toISOString();
      existing.result = {
        provider,
        operation,
        external_id: externalId,
        canonical_url: canonicalUrl,
        status,
        reconciled_by_operator: true,
      };
      delete existing.failure;
      await this.save(ledger);
      return {outcome, retry_allowed: false, external_id: externalId};
    });
  }

  async resetForTests() {
    await unlink(this.path).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
