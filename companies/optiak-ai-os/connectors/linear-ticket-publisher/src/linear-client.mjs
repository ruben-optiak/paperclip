import { PublisherError } from "./errors.mjs";
import { TEAM_KEY } from "./contract.mjs";

const GRAPHQL_URL = "https://api.linear.app/graphql";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const MAX_RESPONSE_BYTES = 262144;

async function boundedText(response, uncertain = false) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new PublisherError("provider_response_too_large", { uncertain });
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PublisherError("provider_response_too_large", { uncertain });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function jsonResponse(response, { uncertainOnMalformed = false } = {}) {
  const text = await boundedText(response, uncertainOnMalformed);
  try { return JSON.parse(text); } catch { throw new PublisherError("provider_invalid_response", { uncertain: uncertainOnMalformed }); }
}

function graphqlCode(body) {
  if (!Array.isArray(body?.errors)) return null;
  const codes = body.errors.map((entry) => entry?.extensions?.code).filter((value) => typeof value === "string");
  if (codes.includes("RATELIMITED")) return "provider_rate_limited";
  return "provider_rejected";
}

function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
}

export class LinearClient {
  constructor({ teamId, oauthClientId, oauthClientSecret, requestTimeoutMs = 10000, fetchImpl = fetch, now = () => Date.now() }) {
    this.teamId = teamId;
    this.oauthClientId = oauthClientId;
    this.oauthClientSecret = oauthClientSecret;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.verifiedToken = null;
  }

  async accessToken(forceRefresh = false) {
    if (!forceRefresh && this.token && this.tokenExpiresAt - 60000 > this.now()) return this.token;
    if (!this.oauthClientId || !this.oauthClientSecret) throw new PublisherError("provider_credentials_unavailable");
    let response;
    try {
      response = await this.fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.oauthClientId}:${this.oauthClientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "read,issues:create" }),
        redirect: "error",
        signal: timeoutSignal(this.requestTimeoutMs),
      });
    } catch {
      throw new PublisherError("provider_auth_unavailable");
    }
    const body = await jsonResponse(response);
    if (!response.ok || typeof body.access_token !== "string" || !Number.isInteger(body.expires_in)) {
      throw new PublisherError("provider_auth_rejected");
    }
    const scopes = new Set(String(body.scope ?? "").split(/[\s,]+/).filter(Boolean));
    if (!scopes.has("read") || !scopes.has("issues:create")) throw new PublisherError("provider_scope_mismatch");
    this.token = body.access_token;
    this.tokenExpiresAt = this.now() + body.expires_in * 1000;
    this.verifiedToken = null;
    return this.token;
  }

  async graphql(query, variables, { mutation = false, allowAuthRefresh = true } = {}) {
    const token = await this.accessToken();
    let response;
    try {
      response = await this.fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        signal: timeoutSignal(this.requestTimeoutMs),
      });
    } catch {
      throw new PublisherError("provider_transport_failure", { uncertain: mutation });
    }
    if (response.status === 401 && allowAuthRefresh) {
      await this.accessToken(true);
      return this.graphql(query, variables, { mutation, allowAuthRefresh: false });
    }
    const body = await jsonResponse(response, { uncertainOnMalformed: mutation });
    const code = graphqlCode(body);
    if (!response.ok || code) {
      const hasMutationData = mutation && body?.data?.issueCreate != null;
      throw new PublisherError(code ?? `provider_http_${response.status}`, { uncertain: hasMutationData || response.status >= 500 });
    }
    if (!body || typeof body !== "object" || !body.data) throw new PublisherError("provider_invalid_response", { uncertain: mutation });
    return body.data;
  }

  async verifyTeam() {
    const token = await this.accessToken();
    if (this.verifiedToken === token) return;
    const data = await this.graphql(
      "query VerifyTeam($id: String!) { team(id: $id) { id key } }",
      { id: this.teamId },
    );
    if (data.team?.id !== this.teamId || data.team?.key !== TEAM_KEY) throw new PublisherError("provider_team_mismatch");
    this.verifiedToken = token;
  }

  async createIssue(input) {
    const data = await this.graphql(
      "mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url team { key } } } }",
      { input: { teamId: this.teamId, title: input.title, description: input.description, priority: input.priority } },
      { mutation: true },
    );
    const result = data.issueCreate;
    if (result?.success !== true || result.issue?.team?.key !== TEAM_KEY || !/^OPT-[1-9][0-9]{0,8}$/.test(result.issue?.identifier ?? "")) {
      throw new PublisherError("provider_result_mismatch", { uncertain: true });
    }
    let url;
    try { url = new URL(result.issue.url); } catch { throw new PublisherError("provider_result_mismatch", { uncertain: true }); }
    const identifier = result.issue.identifier;
    if (url.origin !== "https://linear.app" || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/optiak/issue/${identifier}(?:/[^/?#]+)?/?$`).test(url.pathname)) {
      throw new PublisherError("provider_result_mismatch", { uncertain: true });
    }
    return { identifier, url: `https://linear.app/optiak/issue/${identifier}` };
  }
}
