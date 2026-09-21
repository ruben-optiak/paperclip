#!/usr/bin/env node
// Compatibility entrypoint; the implementation must also travel with the skill.
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {runCli} from "../skills/optiak-durable-completion/scripts/validate-result-envelopes.mjs";
export {validateResultEnvelope, validateResultEnvelopes} from "../skills/optiak-durable-completion/scripts/validate-result-envelopes.mjs";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch(() => { console.error("Invalid result envelope input."); process.exitCode = 1; });
}
