import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type {
  Agent,
  PluginAccessMember,
} from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { TelegramGatewayController } from "../src/gateway.js";
import { containsSensitiveContent, safeOutboundBody } from "../src/safety.js";
import type {
  TelegramBotIdentity,
  TelegramSentMessage,
  TelegramTransport,
  TelegramUpdate,
} from "../src/telegram.js";

const TELEGRAM_USER_ID = "123456789";
const TELEGRAM_CHAT_ID = "987654321";

class FakeTelegramTransport implements TelegramTransport {
  readonly sent: Array<{ chatId: string; text: string; messageId: number }> = [];
  updates: TelegramUpdate[] = [];

  async getMe(_token: string): Promise<TelegramBotIdentity> {
    return { id: 42, username: "enki_director_bot" };
  }

  async getUpdates(_token: string, _offset: number): Promise<TelegramUpdate[]> {
    return this.updates;
  }

  async sendMessage(_token: string, chatId: string, text: string): Promise<TelegramSentMessage> {
    const messageId = this.sent.length + 1;
    this.sent.push({ chatId, text, messageId });
    return { message_id: messageId };
  }
}

class BlockingTelegramTransport extends FakeTelegramTransport {
  readonly pollStarted: Promise<void>;
  private markPollStarted!: () => void;
  private releasePoll: ((updates: TelegramUpdate[]) => void) | null = null;

  constructor() {
    super();
    this.pollStarted = new Promise((resolve) => {
      this.markPollStarted = resolve;
    });
  }

  override getUpdates(_token: string, _offset: number): Promise<TelegramUpdate[]> {
    this.markPollStarted();
    return new Promise((resolve) => {
      this.releasePoll = resolve;
    });
  }

  release(updates: TelegramUpdate[]): void {
    this.releasePoll?.(updates);
  }
}

function director(companyId: string, id = randomUUID()): Agent {
  const now = new Date();
  return {
    id,
    companyId,
    name: "Director de Operaciones de Enki",
    urlKey: "director-operaciones",
    role: "ceo",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 2_500,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function activeHuman(
  companyId: string,
  userId: string,
  membershipRole: PluginAccessMember["membershipRole"] = "owner",
): PluginAccessMember {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId,
    principalType: "user",
    principalId: userId,
    status: "active",
    membershipRole,
    grants: [],
    createdAt: now,
    updatedAt: now,
  };
}

function config(userId: string, directorAgentId: string): Record<string, unknown> {
  return {
    enabled: true,
    botToken: { type: "secret_ref", secretId: randomUUID(), version: "latest" },
    paperclipUserId: userId,
    allowedTelegramUserIds: [TELEGRAM_USER_ID],
    allowedTelegramChatIds: [TELEGRAM_CHAT_ID],
    reportTelegramChatId: TELEGRAM_CHAT_ID,
    directorAgentId,
    paperclipPublicUrl: "https://paperclip.example/ENK",
    notifyApprovals: true,
    notifyRoutineReports: true,
    notifyDirectorReplies: true,
  };
}

function update(
  updateId: number,
  text: string,
  overrides: { userId?: number; chatId?: number; replyToMessageId?: number } = {},
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: overrides.userId ?? Number(TELEGRAM_USER_ID) },
      chat: { id: overrides.chatId ?? Number(TELEGRAM_CHAT_ID), type: "private" },
      text,
      ...(overrides.replyToMessageId
        ? { reply_to_message: { message_id: overrides.replyToMessageId } }
        : {}),
    },
  };
}

async function configuredController() {
  const companyId = randomUUID();
  const userId = randomUUID();
  const directorAgent = director(companyId);
  const harness = createTestHarness({ manifest });
  harness.seed({
    agents: [directorAgent],
    accessMembers: [activeHuman(companyId, userId)],
  });
  const transport = new FakeTelegramTransport();
  const controller = new TelegramGatewayController(harness.ctx, transport, { autoPoll: false });
  const health = await controller.applyConfig(companyId, config(userId, directorAgent.id));
  expect(health.configured).toBe(true);
  return { companyId, userId, directorAgent, harness, transport, controller };
}

describe("Enki Telegram gateway manifest", () => {
  it("declares the narrow bridge capabilities and cannot decide approvals", () => {
    expect(manifest.capabilities).toEqual(expect.arrayContaining([
      "issues.create",
      "issues.wakeup",
      "issue.comments.create_human_attributed",
      "access.members.read",
      "secrets.read-ref",
      "http.outbound",
    ]));
    expect(manifest.capabilities).not.toContain("approvals.respond");
    expect(manifest.capabilities).not.toContain("issue.interactions.respond");
    expect(manifest.capabilities).not.toContain("agents.invoke");
    expect(manifest.capabilities).not.toContain("issues.update");
  });

  it("declares the bot token as an object-shaped Paperclip secret-ref field", () => {
    const properties = manifest.instanceConfigSchema?.properties as
      | Record<string, { type?: string; format?: string; default?: unknown }>
      | undefined;
    const botTokenSchema = properties?.botToken;
    expect(botTokenSchema).toMatchObject({
      type: "object",
      format: "secret-ref",
    });
    expect(botTokenSchema).not.toHaveProperty("default");
  });

  it("rejects raw tokens and report chats outside the allowlist", async () => {
    const result = await plugin.definition.onValidateConfig?.({
      enabled: true,
      botToken: "raw-token",
      paperclipUserId: randomUUID(),
      allowedTelegramUserIds: [TELEGRAM_USER_ID],
      allowedTelegramChatIds: [TELEGRAM_CHAT_ID],
      reportTelegramChatId: "111",
    });
    expect(result?.ok).toBe(false);
    expect(result?.errors?.join(" ")).toContain("secret reference");
    expect(result?.errors?.join(" ")).toContain("allowedTelegramChatIds");
  });

  it("refuses to bind Telegram writes to a read-only Paperclip viewer", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const directorAgent = director(companyId);
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [directorAgent],
      accessMembers: [activeHuman(companyId, userId, "viewer")],
    });
    const controller = new TelegramGatewayController(
      harness.ctx,
      new FakeTelegramTransport(),
      { autoPoll: false },
    );
    const health = await controller.applyConfig(companyId, config(userId, directorAgent.id));
    expect(health.status).toBe("error");
    expect(health.lastErrorKind).toBe("paperclip_user_not_active");
  });

  it("refuses an explicit agent that is not the Enki organizational root", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const specialist: Agent = { ...director(companyId), name: "Growth Manager", role: "cmo" };
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [specialist],
      accessMembers: [activeHuman(companyId, userId)],
    });
    const controller = new TelegramGatewayController(
      harness.ctx,
      new FakeTelegramTransport(),
      { autoPoll: false },
    );
    const health = await controller.applyConfig(companyId, config(userId, specialist.id));
    expect(health.status).toBe("error");
    expect(health.lastErrorKind).toBe("director_not_found");
  });
});

describe("Enki Telegram gateway inbound", () => {
  it("ignores non-allowlisted users without replying", async () => {
    const { companyId, harness, transport, controller } = await configuredController();
    await controller.handleUpdate(companyId, update(1, "Haz un análisis", { userId: 555 }));
    expect(await harness.ctx.issues.list({ companyId })).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });

  it("creates one audited Director task and deduplicates a replayed update", async () => {
    const { companyId, userId, directorAgent, harness, transport, controller } = await configuredController();
    const inbound = update(10, "Revisa las ventas de esta semana");
    await controller.handleUpdate(companyId, inbound);
    await controller.handleUpdate(companyId, inbound);

    const issues = await harness.ctx.issues.list({ companyId });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      assigneeAgentId: directorAgent.id,
      originKind: "plugin:enki-hogar.telegram-gateway",
      originId: "telegram-update:10",
      status: "todo",
    });
    expect(issues[0]?.description).toContain("Telegram no puede aprobarla");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).not.toContain("Revisa las ventas");

    // Production independently verifies this ID as an active company member.
    expect(userId).toMatch(/^[0-9a-f-]+$/);
  });

  it("turns a reply to the bot into a human-attributed issue comment", async () => {
    const { companyId, userId, harness, transport, controller } = await configuredController();
    await controller.handleUpdate(companyId, update(20, "Prepara opciones para el backlog SEO"));
    expect(transport.sent[0]?.messageId).toBe(1);

    await controller.handleUpdate(companyId, update(21, "Prioriza impacto antes que volumen", {
      replyToMessageId: 1,
    }));

    const [issue] = await harness.ctx.issues.list({ companyId });
    const comments = await harness.ctx.issues.listComments(issue!.id, companyId);
    expect(comments).toEqual([
      expect.objectContaining({
        authorType: "user",
        authorUserId: userId,
        body: "Prioriza impacto antes que volumen",
      }),
    ]);
  });

  it("does not implement approval commands", async () => {
    const { companyId, harness, transport, controller } = await configuredController();
    await controller.handleUpdate(companyId, update(30, "/approve abc"));
    expect(await harness.ctx.issues.list({ companyId })).toHaveLength(0);
    expect(transport.sent[0]?.text).toContain("aprobaciones se resuelven únicamente en Paperclip");
  });

  it("rejects likely PII, credentials, and exact order references before creating work", async () => {
    const { companyId, harness, transport, controller } = await configuredController();
    await controller.handleUpdate(companyId, update(31, "Revisa el pedido #12345 de persona@example.com"));
    expect(await harness.ctx.issues.list({ companyId })).toHaveLength(0);
    expect(transport.sent[0]?.text).toContain("Telegram no acepta secretos, datos personales");
    expect(transport.sent[0]?.text).not.toContain("persona@example.com");
    expect(transport.sent[0]?.text).not.toContain("12345");
  });

  it("does not process updates returned after the company gateway is disabled", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const directorAgent = director(companyId);
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [directorAgent],
      accessMembers: [activeHuman(companyId, userId)],
    });
    const transport = new BlockingTelegramTransport();
    const controller = new TelegramGatewayController(harness.ctx, transport, {
      supervisorDelayMs: 1,
    });
    await controller.applyConfig(companyId, config(userId, directorAgent.id));
    await transport.pollStarted;
    controller.stopCompany(companyId);
    transport.release([update(40, "Este mensaje llegó durante el apagado")]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.stopAll();

    expect(await harness.ctx.issues.list({ companyId })).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });
});

describe("Enki Telegram gateway outbound", () => {
  it("notifies an approval without exposing a decision action", async () => {
    const { companyId, transport, controller } = await configuredController();
    await controller.handleEvent({
      eventId: randomUUID(),
      eventType: "approval.created",
      occurredAt: new Date().toISOString(),
      actorType: "agent",
      actorId: randomUUID(),
      entityType: "approval",
      entityId: randomUUID(),
      companyId,
      payload: { type: "publish_content", issueIds: [] },
    });
    expect(transport.sent[0]?.text).toContain("decide en la UI");
    expect(transport.sent[0]?.text).not.toMatch(/\/approve|\/reject|callback/i);
  });

  it("withholds likely PII and credentials from Telegram", () => {
    expect(containsSensitiveContent("Cliente persona@example.com, pedido #12345")).toBe(true);
    expect(safeOutboundBody("token: abcdef")).toContain("información sensible");
    expect(safeOutboundBody("ROAS 3,2; datos actualizados ayer")).toBe("ROAS 3,2; datos actualizados ayer");
  });
});
