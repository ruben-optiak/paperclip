#!/usr/bin/env node
import { readConfig } from "./config.mjs";
import { PublicationJournal } from "./journal.mjs";
import { LinearClient } from "./linear-client.mjs";
import { TicketPublisher } from "./publisher.mjs";
import { createHttpServer } from "./http.mjs";

async function main() {
  const config = readConfig();
  const journal = new PublicationJournal(config.journalPath, { recoverInterrupted: true });
  const provider = new LinearClient(config);
  const publisher = new TicketPublisher({ journal, provider, writeMode: config.writeMode });
  const http = createHttpServer({ publisher, journal, token: config.mcpToken, writeMode: config.writeMode });
  await http.listen(config.port, config.host);
  console.error(`Optiak Linear ticket publisher listening on ${config.host}:${config.port}; write_mode=${config.writeMode}; tools=1`);

  const shutdown = async () => {
    await http.close();
    journal.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

void main().catch(() => {
  console.error("Optiak Linear ticket publisher failed to start: safe_startup_failure");
  process.exit(1);
});
