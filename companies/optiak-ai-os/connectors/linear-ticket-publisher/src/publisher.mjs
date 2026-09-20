import { prepareTicketPlans, RESULT_SCHEMA, TEAM_KEY } from "./contract.mjs";
import { PublisherError, errorCode } from "./errors.mjs";

function projected(row, key, replayed) {
  return {
    key,
    outcome: replayed ? "already_created" : "created",
    identifier: row.linear_identifier,
    url: row.linear_url,
  };
}

function publicationError(code, key = null, completed = []) {
  return {
    schema: RESULT_SCHEMA,
    outcome: "blocked",
    teamKey: TEAM_KEY,
    completed,
    error: {
      code,
      ticketKey: key,
      retryAutomatically: false,
      operatorReviewRequired: ["uncertain_previous_attempt", "provider_transport_failure", "provider_invalid_response", "provider_result_mismatch", "provider_response_too_large", "journal_state_conflict"].includes(code),
    },
  };
}

export class TicketPublisher {
  constructor({ journal, provider, writeMode = "disabled" }) {
    this.journal = journal;
    this.provider = provider;
    this.writeMode = writeMode;
  }

  async publish(input) {
    let prepared;
    try { prepared = prepareTicketPlans(input); } catch (error) { return publicationError(errorCode(error)); }
    if (this.writeMode !== "enabled") return publicationError("write_disabled");

    try { await this.provider.verifyTeam(); } catch (error) { return publicationError(errorCode(error, "provider_preflight_failed")); }

    let existing;
    try { existing = this.journal.prepareBatch(prepared.plans); } catch (error) { return publicationError(errorCode(error)); }
    const blocked = existing.find((row) => ["uncertain", "creating", "failed"].includes(row.status));
    if (blocked) {
      const code = blocked.status === "uncertain" || blocked.status === "creating" ? "uncertain_previous_attempt" : "failed_previous_attempt";
      return publicationError(code, blocked.draft_key);
    }

    const completed = [];
    for (let index = 0; index < prepared.plans.length; index += 1) {
      const plan = prepared.plans[index];
      const row = existing[index];
      if (row.status === "succeeded") {
        completed.push(projected(row, plan.key, true));
        continue;
      }
      try {
        this.journal.markCreating(plan.idempotencyKey);
        const result = await this.provider.createIssue(plan.providerInput);
        this.journal.markSucceeded(plan.idempotencyKey, result);
        completed.push({ key: plan.key, outcome: "created", ...result });
      } catch (error) {
        const code = errorCode(error);
        const uncertain = error instanceof PublisherError && error.uncertain;
        try { this.journal.markFailure(plan.idempotencyKey, code, uncertain); } catch { return publicationError("journal_state_conflict", plan.key, completed); }
        return publicationError(code, plan.key, completed);
      }
    }
    return {
      schema: RESULT_SCHEMA,
      outcome: "completed",
      teamKey: TEAM_KEY,
      sourceRevisionSha256: prepared.value.source.revisionSha256,
      batchHash: prepared.batchHash,
      tickets: completed,
    };
  }
}
