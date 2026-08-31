import {parseArgs} from "node:util";
import {readConfig} from "./config.mjs";
import {PublicationLedger} from "./ledger.mjs";

function usage() {
  return "Usage: node src/admin.mjs list | reconcile --provider <name> --operation <name> --key <key> --outcome applied|not-applied [--external-id <id> --status draft|pending|future|publish|published] [--url <url>]";
}

async function main() {
  const command = process.argv[2];
  const config = readConfig(process.env);
  const ledger = new PublicationLedger(config.ledgerPath);
  if (command === "list") {
    console.log(JSON.stringify(await ledger.list(), null, 2));
    return;
  }
  if (command !== "reconcile") throw new Error(usage());
  const {values} = parseArgs({
    args: process.argv.slice(3),
    options: {
      provider: {type: "string"},
      operation: {type: "string"},
      key: {type: "string"},
      outcome: {type: "string"},
      "external-id": {type: "string"},
      status: {type: "string"},
      url: {type: "string"},
    },
  });
  for (const key of ["provider", "operation", "key", "outcome"]) if (!values[key]) throw new Error(usage());
  const result = await ledger.reconcile({
    provider: values.provider,
    operation: values.operation,
    idempotencyKey: values.key,
    outcome: values.outcome,
    externalId: values["external-id"] || null,
    canonicalUrl: values.url || null,
    status: values.status || null,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Publication journal administration failed");
  process.exitCode = 1;
});
