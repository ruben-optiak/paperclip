#!/usr/bin/env node
import {databaseConfig, embeddingConfig} from "./config.mjs";
import {createDatabase, closeDatabase} from "./db.mjs";
import {createEmbeddingClient} from "./embeddings.mjs";
import {importSupportPack} from "./import-pack.mjs";
import {applyPurge, createPurgePreview, listPacks} from "./lifecycle.mjs";
import {migrate} from "./migrations.mjs";
import {assertSlug} from "./normalization.mjs";
import {reindexEmbeddings} from "./reindex.mjs";
import {loadSupportPack} from "./support-pack.mjs";

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const separator = token.indexOf("=");
    if (separator > 2) {
      options[token.slice(2, separator)] = token.slice(separator + 1);
      continue;
    }
    const key = token.slice(2);
    if (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      options[key] = tokens[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return {command, options};
}

function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === "") throw new Error(`--${name} is required`);
  return String(value).trim();
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

async function readStdin(maxBytes = 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Input exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readConfirmationToken(options) {
  if (options.token !== undefined) throw new Error("--token is deliberately unsupported; use --token-stdin so the value does not enter process arguments");
  if (options["token-stdin"] !== true) throw new Error("--token-stdin is required");
  const token = (await readStdin()).trim();
  if (!token) throw new Error("Confirmation token is empty");
  return token;
}

function summary(pack) {
  return {
    valid: true,
    schema: pack.manifest.schema,
    pack_key: pack.manifest.packKey,
    version: pack.manifest.version,
    brand: pack.manifest.brand.slug,
    domain: pack.manifest.domain.slug,
    snapshot_date: pack.manifest.snapshotDate,
    approval_state: pack.manifest.approval.state,
    source_revision_kind: pack.manifest.sourceRepository.revisionKind,
    source_revision: pack.manifest.sourceRepository.revision,
    manifest_sha256: pack.manifestSha256,
    counts: {
      sources: pack.manifest.sources.length,
      entities: pack.entities.length,
      facts: pack.facts.length,
      relations: pack.relations.length,
      configuration_rules: pack.rules.length,
      sku_crosswalks: pack.crosswalk.length,
      support_chunks: pack.chunks.length,
    },
    commercial_fields_persisted: false,
  };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function withAdminDatabase(run) {
  const sql = createDatabase(databaseConfig(process.env, {admin: true}));
  try { return await run(sql); } finally { await closeDatabase(sql); }
}

async function main() {
  const {command, options} = parseArgs(process.argv.slice(2));
  if (!command) throw new Error("Command required: review-pack, validate-pack, migrate, import-pack, pack-list, purge-preview, purge-apply or reindex-embeddings");
  const actor = typeof options.actor === "string" ? options.actor.trim() : "local-operator";

  if (command === "review-pack") {
    output(summary(await loadSupportPack(requireOption(options, "dir"), {requireApproval: false})));
    return;
  }
  if (command === "validate-pack") {
    output(summary(await loadSupportPack(requireOption(options, "dir"))));
    return;
  }
  if (command === "migrate") {
    output(await withAdminDatabase(async (sql) => {
      await migrate(sql, {readerPassword: process.env.SUPPORT_DB_READER_PASSWORD});
      return {status: "ok", schema_version: 1, reader_role: "enki_support_reader"};
    }));
    return;
  }
  if (command === "import-pack") {
    const pack = await loadSupportPack(requireOption(options, "dir"));
    output(await withAdminDatabase((sql) => importSupportPack(sql, pack, {actor})));
    return;
  }
  if (command === "pack-list") {
    output({packs: await withAdminDatabase((sql) => listPacks(sql, {
      brand: options.brand ? assertSlug(options.brand, "brand") : null,
      domain: options.domain ? assertSlug(options.domain, "domain") : null,
    }))});
    return;
  }
  if (command === "purge-preview") {
    output(await withAdminDatabase((sql) => createPurgePreview(sql, {
      packKey: requireOption(options, "pack-key"),
      version: requireOption(options, "version"),
    }, actor)));
    return;
  }
  if (command === "purge-apply") {
    const token = await readConfirmationToken(options);
    output(await withAdminDatabase((sql) => applyPurge(sql, token, actor)));
    return;
  }
  if (command === "reindex-embeddings") {
    output(await withAdminDatabase((sql) => reindexEmbeddings(sql, createEmbeddingClient(embeddingConfig()), {
      brand: options.brand ? assertSlug(options.brand, "brand") : null,
      domain: options.domain ? assertSlug(options.domain, "domain") : null,
      limit: boundedInteger(options.limit, 1000, 1, 100000, "limit"),
      batchSize: boundedInteger(options["batch-size"], 32, 1, 100, "batch-size"),
    })));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`support-admin: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
