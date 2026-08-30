import type {
  Agent,
  Issue,
  PluginContext,
  PluginEvent,
} from "@paperclipai/plugin-sdk";
import {
  DIRECTOR_NAME,
  MAX_INBOUND_TEXT_LENGTH,
  TELEGRAM_ORIGIN_KIND,
  type TelegramGatewayConfig,
  validateGatewayConfig,
} from "./config.js";
import {
  containsSensitiveContent,
  safeIssueTitle,
  safeOutboundBody,
  safeTelegramError,
} from "./safety.js";
import {
  PaperclipTelegramTransport,
  TelegramTransportError,
  type TelegramMessage,
  type TelegramTransport,
  type TelegramUpdate,
} from "./telegram.js";

const UPDATE_LEDGER_LIMIT = 250;
const EVENT_LEDGER_LIMIT = 250;
const RATE_LIMIT_COUNT = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ROUTINE_TITLES = new Set(["Brief laboral diario", "Revisión operativa semanal"]);
const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

export type GatewayHealthStatus = "disabled" | "starting" | "ok" | "degraded" | "error";

export interface GatewayCompanyHealth {
  companyId: string;
  configured: boolean;
  enabled: boolean;
  polling: boolean;
  status: GatewayHealthStatus;
  botUsername: string | null;
  directorAgentId: string | null;
  directorStatus: string | null;
  lastPollAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastErrorKind: string | null;
  message: string;
}

interface CompanySession {
  companyId: string;
  config: TelegramGatewayConfig;
  director: Agent;
  generation: number;
  active: boolean;
  health: GatewayCompanyHealth;
}

interface ControllerOptions {
  autoPoll?: boolean;
  now?: () => number;
  retryDelayMs?: number;
  supervisorDelayMs?: number;
}

type ParsedCommand =
  | { kind: "help" }
  | { kind: "new-task"; body: string }
  | { kind: "brief"; body: string }
  | { kind: "reply"; identifier: string; body: string }
  | { kind: "status"; identifier: string }
  | { kind: "invalid"; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function messageId(value: number): string {
  return String(Math.trunc(value));
}

function issueLabel(issue: Issue): string {
  return issue.identifier ?? issue.id;
}

function isEnkiDirector(agent: Agent): boolean {
  return agent.name === DIRECTOR_NAME &&
    agent.role === "ceo" &&
    agent.reportsTo === null &&
    agent.status !== "terminated";
}

function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { kind: "new-task", body: trimmed };

  const firstSpace = trimmed.search(/\s/);
  const token = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace))
    .toLowerCase()
    .replace(/@[a-z0-9_]+$/i, "");
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace).trim();

  if (token === "/start" || token === "/help") return { kind: "help" };
  if (token === "/director") {
    return rest
      ? { kind: "new-task", body: rest }
      : { kind: "invalid", message: "Uso: /director <qué necesitas>" };
  }
  if (token === "/brief") return { kind: "brief", body: rest };
  if (token === "/status") {
    return rest && !/\s/.test(rest)
      ? { kind: "status", identifier: rest }
      : { kind: "invalid", message: "Uso: /status ENK-123" };
  }
  if (token === "/reply") {
    const match = /^(\S+)\s+([\s\S]+)$/.exec(rest);
    return match
      ? { kind: "reply", identifier: match[1]!, body: match[2]!.trim() }
      : { kind: "invalid", message: "Uso: /reply ENK-123 <mensaje>" };
  }
  return {
    kind: "invalid",
    message: "Comando no reconocido. Usa /help. Las aprobaciones se resuelven únicamente en Paperclip.",
  };
}

function helpText(): string {
  return [
    "Enki Director · comandos disponibles",
    "",
    "Escribe cualquier mensaje o usa /director <texto> para crear una tarea al Director.",
    "/brief [contexto] · solicita un brief manual",
    "/reply ENK-123 <texto> · comenta una tarea abierta del Director",
    "/status ENK-123 · consulta su estado",
    "/help · muestra esta ayuda",
    "",
    "Telegram nunca ejecuta aprobaciones. Los enlaces de aprobación se revisan y deciden en la UI de Paperclip.",
  ].join("\n");
}

function buildTaskDescription(body: string): string {
  return [
    "Solicitud del Board recibida mediante el gateway auditado de Telegram.",
    "",
    "## Solicitud",
    body,
    "",
    "## Contrato de ejecución",
    "- Trátala como una tarea del Board dirigida al Director de Operaciones.",
    "- Coordina especialistas mediante issues e handoffs de Paperclip cuando sea necesario.",
    "- Mantén la v1 en lectura y generación de borradores.",
    "- No publiques, envíes mensajes, cambies campañas, precios, stock, pedidos ni la web.",
    "- Si hace falta una acción gobernada, solicita aprobación en Paperclip; Telegram no puede aprobarla.",
    "- Deja una respuesta final concisa y con fuentes en este issue.",
  ].join("\n");
}

function buildBriefDescription(context: string): string {
  return [
    "Genera un brief manual para el Board usando la skill enki-daily-brief.",
    context ? `Contexto adicional: ${context}` : "Contexto adicional: ninguno.",
    "",
    "Incluye fuente, periodo, frescura y calidad de cada dato; separa hechos, alertas, decisiones pendientes y propuestas.",
    "No presentes datos del snapshot como actuales. Si una fuente está caída o incompleta, decláralo sin estimar cifras.",
    "Mantén la ejecución en lectura y borradores. Cualquier aprobación se solicita y resuelve en Paperclip.",
  ].join("\n");
}

export class TelegramGatewayController {
  private readonly sessions = new Map<string, CompanySession>();
  private readonly healthByCompany = new Map<string, GatewayCompanyHealth>();
  private readonly rateWindows = new Map<string, number[]>();
  private readonly rateLimitNotifiedAt = new Map<string, number>();
  private readonly pollingCompanies = new Set<string>();
  private generation = 0;
  private shutdownRequested = false;
  private readonly autoPoll: boolean;
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private readonly supervisorDelayMs: number;

  constructor(
    private readonly ctx: PluginContext,
    private readonly transport: TelegramTransport = new PaperclipTelegramTransport(ctx.http),
    options: ControllerOptions = {},
  ) {
    this.autoPoll = options.autoPoll !== false;
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? 1_500;
    this.supervisorDelayMs = options.supervisorDelayMs ?? 250;
    // setup() creates the controller outside a company invocation. Keeping the
    // supervisor rooted there makes its network/state calls proactive and lets
    // Paperclip authorize them against the configured-company scope. Starting
    // the loop from onConfigChanged would retain an expired RPC invocation ID.
    if (this.autoPoll) void this.supervisePollers();
  }

  async applyConfig(companyId: string, raw: Record<string, unknown>): Promise<GatewayCompanyHealth> {
    this.stopCompany(companyId);
    const validation = validateGatewayConfig(raw);
    if (!validation.ok || !validation.config) {
      const health = this.makeHealth(companyId, {
        configured: false,
        enabled: raw.enabled === true,
        status: "error",
        lastErrorKind: "invalid_config",
        message: validation.errors.join(" "),
      });
      this.healthByCompany.set(companyId, health);
      return health;
    }

    const config = validation.config;
    if (!config.enabled) {
      const health = this.makeHealth(companyId, {
        configured: true,
        enabled: false,
        status: "disabled",
        message: "Gateway configured but disabled.",
      });
      this.healthByCompany.set(companyId, health);
      return health;
    }

    const members = await this.ctx.access.members.list({ companyId });
    const activeHuman = members.some((member) =>
      member.principalType === "user" &&
      member.principalId === config.paperclipUserId &&
      member.status === "active" &&
      member.membershipRole !== "viewer"
    );
    if (!activeHuman) {
      const health = this.makeHealth(companyId, {
        configured: true,
        enabled: true,
        status: "error",
        lastErrorKind: "paperclip_user_not_active",
        message: "The configured Paperclip user is not an active writable human member of this company.",
      });
      this.healthByCompany.set(companyId, health);
      return health;
    }

    const director = await this.resolveDirector(companyId, config.directorAgentId);
    if (!director) {
      const health = this.makeHealth(companyId, {
        configured: true,
        enabled: true,
        status: "error",
        lastErrorKind: "director_not_found",
        message: `Could not resolve one ${DIRECTOR_NAME} agent.`,
      });
      this.healthByCompany.set(companyId, health);
      return health;
    }

    const generation = ++this.generation;
    const health = this.makeHealth(companyId, {
      configured: true,
      enabled: true,
      polling: this.autoPoll,
      status: director.status === "paused" ? "degraded" : "starting",
      directorAgentId: director.id,
      directorStatus: director.status,
      message: director.status === "paused"
        ? "Gateway ready; the Director is paused, so new tasks will be registered but not started."
        : "Gateway is starting.",
    });
    const session: CompanySession = {
      companyId,
      config: { ...config, directorAgentId: director.id },
      director,
      generation,
      active: true,
      health,
    };
    this.sessions.set(companyId, session);
    this.healthByCompany.set(companyId, health);
    return health;
  }

  stopCompany(companyId: string): void {
    const existing = this.sessions.get(companyId);
    if (existing) existing.active = false;
    this.sessions.delete(companyId);
  }

  stopAll(): void {
    this.shutdownRequested = true;
    for (const session of this.sessions.values()) session.active = false;
    this.sessions.clear();
  }

  getHealth(companyId: string): GatewayCompanyHealth {
    return this.healthByCompany.get(companyId) ?? this.makeHealth(companyId, {
      message: "No company-scoped configuration has been delivered to the worker yet.",
    });
  }

  getAllHealth(): GatewayCompanyHealth[] {
    return [...this.healthByCompany.values()];
  }

  async testConnection(companyId: string): Promise<GatewayCompanyHealth> {
    const session = this.sessions.get(companyId);
    if (!session) return this.getHealth(companyId);
    if (!(await this.hasCurrentAuthority(session))) return session.health;
    try {
      const token = await this.resolveToken(session);
      const identity = await this.transport.getMe(token);
      this.updateHealth(session, {
        botUsername: identity.username ?? null,
        status: session.director.status === "paused" ? "degraded" : "ok",
        lastErrorKind: null,
        message: session.director.status === "paused"
          ? "Telegram connection is valid; the Director remains paused."
          : "Telegram connection is valid.",
      });
    } catch (error) {
      this.recordTransportError(session, error);
    }
    return session.health;
  }

  async handleUpdate(companyId: string, update: TelegramUpdate): Promise<void> {
    const session = this.sessions.get(companyId);
    if (!session?.active) return;
    await this.processUpdate(session, update);
  }

  async handleEvent(event: PluginEvent): Promise<void> {
    const session = this.sessions.get(event.companyId);
    if (!session?.active) return;
    if (!(await this.hasCurrentAuthority(session))) return;
    if (!this.isCurrentSession(session)) return;

    if (event.eventType === "approval.created" && session.config.notifyApprovals) {
      if (!(await this.claimEvent(session, event.eventId))) return;
      const payload = asRecord(event.payload);
      const rawApprovalType = stringValue(payload.type);
      const approvalType = rawApprovalType && /^[a-z0-9_.-]{1,80}$/i.test(rawApprovalType)
        ? rawApprovalType
        : "acción gobernada";
      const link = this.link(session, `/approvals/${event.entityId ?? ""}`);
      await this.send(
        session,
        session.config.reportTelegramChatId,
        [
          "Aprobación pendiente en Paperclip",
          `Tipo: ${approvalType}`,
          "Telegram solo avisa: revisa el contexto y decide en la UI.",
          link,
        ].filter(Boolean).join("\n"),
      );
      return;
    }

    if (event.eventType === "issue.comment.created" && session.config.notifyDirectorReplies) {
      await this.relayDirectorComment(session, event);
      return;
    }

    if (event.eventType === "issue.updated") {
      await this.relayCompletedIssue(session, event);
      return;
    }

    if (event.eventType === "agent.run.failed") {
      await this.relayRunFailure(session, event);
    }
  }

  private makeHealth(
    companyId: string,
    patch: Partial<GatewayCompanyHealth> = {},
  ): GatewayCompanyHealth {
    return {
      companyId,
      configured: false,
      enabled: false,
      polling: false,
      status: "disabled",
      botUsername: null,
      directorAgentId: null,
      directorStatus: null,
      lastPollAt: null,
      lastSuccessfulPollAt: null,
      lastErrorKind: null,
      message: "Gateway is not configured.",
      ...patch,
    };
  }

  private updateHealth(session: CompanySession, patch: Partial<GatewayCompanyHealth>): void {
    session.health = { ...session.health, ...patch };
    this.healthByCompany.set(session.companyId, session.health);
  }

  private async resolveDirector(companyId: string, explicitId: string | null): Promise<Agent | null> {
    if (explicitId) {
      const agent = await this.ctx.agents.get(explicitId, companyId);
      return agent && isEnkiDirector(agent) ? agent : null;
    }

    const agents: Agent[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await this.ctx.agents.list({ companyId, limit: 100, offset });
      agents.push(...page);
      if (page.length < 100) break;
    }
    const directors = agents.filter((agent) => isEnkiDirector(agent));
    return directors.length === 1 ? directors[0]! : null;
  }

  private async resolveToken(session: CompanySession): Promise<string> {
    return this.ctx.secrets.resolve(session.config.botToken, {
      companyId: session.companyId,
      configPath: "botToken",
    });
  }

  private async poll(session: CompanySession): Promise<void> {
    let offset = await this.readOffset(session.companyId);
    while (this.isCurrentSession(session)) {
      this.updateHealth(session, { polling: true, lastPollAt: new Date(this.now()).toISOString() });
      try {
        const token = await this.resolveToken(session);
        const updates = await this.transport.getUpdates(token, offset);
        if (!this.isCurrentSession(session)) break;
        for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
          if (!this.isCurrentSession(session)) break;
          await this.processUpdate(session, update);
          offset = Math.max(offset, update.update_id + 1);
          await this.writeOffset(session.companyId, offset);
        }
        this.updateHealth(session, {
          status: session.director.status === "paused" ? "degraded" : "ok",
          lastSuccessfulPollAt: new Date(this.now()).toISOString(),
          lastErrorKind: null,
          message: session.director.status === "paused"
            ? "Connected; the Director is paused."
            : "Connected and polling Telegram.",
        });
      } catch (error) {
        this.recordTransportError(session, error);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
  }

  private async supervisePollers(): Promise<void> {
    while (!this.shutdownRequested) {
      for (const [companyId, session] of this.sessions) {
        if (!session.active || this.pollingCompanies.has(companyId)) continue;
        this.pollingCompanies.add(companyId);
        void this.poll(session).finally(() => {
          this.pollingCompanies.delete(companyId);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.supervisorDelayMs));
    }
  }

  private isCurrentSession(session: CompanySession): boolean {
    return session.active && this.sessions.get(session.companyId)?.generation === session.generation;
  }

  private recordTransportError(session: CompanySession, error: unknown): void {
    const kind = error instanceof TelegramTransportError ? error.kind : "network";
    this.updateHealth(session, {
      status: kind === "rate_limit" || kind === "network" ? "degraded" : "error",
      lastErrorKind: kind,
      message: kind === "conflict"
        ? "Telegram rejected long polling because this bot has an active webhook or another poller."
        : `Telegram connection error (${kind}).`,
    });
    this.ctx.logger.warn("Telegram gateway transport error", {
      companyId: session.companyId,
      errorKind: kind,
    });
  }

  private async hasCurrentAuthority(session: CompanySession): Promise<boolean> {
    try {
      const members = await this.ctx.access.members.list({ companyId: session.companyId });
      const authorized = members.some((member) =>
        member.principalType === "user" &&
        member.principalId === session.config.paperclipUserId &&
        member.status === "active" &&
        member.membershipRole !== "viewer"
      );
      if (!authorized) {
        this.updateHealth(session, {
          status: "error",
          lastErrorKind: "paperclip_user_not_active",
          message: "Telegram writes are blocked because the configured Paperclip user is no longer an active writable member.",
        });
        return false;
      }
      const director = await this.ctx.agents.get(session.director.id, session.companyId);
      if (!director || !isEnkiDirector(director)) {
        this.updateHealth(session, {
          status: "error",
          directorStatus: director?.status ?? null,
          lastErrorKind: "director_not_available",
          message: "Telegram writes are blocked because the configured Enki Director is no longer the active organizational root.",
        });
        return false;
      }
      session.director = director;
      this.updateHealth(session, { directorStatus: director.status });
      return true;
    } catch {
      this.updateHealth(session, {
        status: "degraded",
        lastErrorKind: "paperclip_membership_unavailable",
        message: "Telegram writes are blocked while Paperclip membership cannot be verified.",
      });
    }
    return false;
  }

  private async processUpdate(session: CompanySession, update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || !message.from || message.from.is_bot) return;
    const userId = messageId(message.from.id);
    const chatId = messageId(message.chat.id);
    if (!session.config.allowedTelegramUserIds.includes(userId) ||
        !session.config.allowedTelegramChatIds.includes(chatId)) {
      return;
    }
    if (!(await this.hasCurrentAuthority(session))) return;
    if (!this.isCurrentSession(session)) return;
    if (!(await this.claimUpdate(session, update.update_id))) return;
    if (this.isRateLimited(session.companyId, chatId)) {
      if (this.shouldNotifyRateLimit(session.companyId, chatId)) {
        await this.send(session, chatId, "Demasiados mensajes seguidos. Espera un minuto y vuelve a intentarlo.");
      }
      return;
    }

    const text = message.text.trim();
    if (!text) return;
    if (text.length > MAX_INBOUND_TEXT_LENGTH) {
      await this.send(session, chatId, "El mensaje es demasiado largo. Redúcelo o crea la tarea directamente en Paperclip.");
      return;
    }
    if (containsSensitiveContent(text)) {
      await this.send(
        session,
        chatId,
        "Por seguridad, Telegram no acepta secretos, datos personales ni referencias exactas de pedidos. Usa la UI autenticada de Paperclip.",
      );
      return;
    }

    try {
      if (!text.startsWith("/") && message.reply_to_message) {
        const linkedIssueId = await this.issueForTelegramMessage(
          session.companyId,
          chatId,
          message.reply_to_message.message_id,
        );
        if (linkedIssueId) {
          const issue = await this.ctx.issues.get(linkedIssueId, session.companyId);
          if (issue) {
            await this.replyToIssue(session, chatId, issue, text);
            return;
          }
        }
      }

      const command = parseCommand(text);
      switch (command.kind) {
        case "help":
          await this.send(session, chatId, helpText());
          break;
        case "invalid":
          await this.send(session, chatId, command.message);
          break;
        case "new-task":
          await this.createDirectorTask(session, chatId, update.update_id, command.body, false);
          break;
        case "brief":
          await this.createDirectorTask(session, chatId, update.update_id, command.body, true);
          break;
        case "reply": {
          const issue = await this.findIssue(session.companyId, command.identifier);
          if (!issue) {
            await this.send(session, chatId, "No encuentro esa tarea en esta compañía.");
            break;
          }
          await this.replyToIssue(session, chatId, issue, command.body);
          break;
        }
        case "status": {
          const issue = await this.findIssue(session.companyId, command.identifier);
          if (!issue) {
            await this.send(session, chatId, "No encuentro esa tarea en esta compañía.");
            break;
          }
          const title = containsSensitiveContent(issue.title) ? "contenido protegido" : issue.title;
          await this.send(
            session,
            chatId,
            [
              `${issueLabel(issue)} · ${issue.status}`,
              title,
              this.link(session, `/issues/${issue.id}`),
            ].filter(Boolean).join("\n"),
            issue.id,
          );
          break;
        }
      }
    } catch {
      await this.send(session, chatId, safeTelegramError()).catch(() => {});
    }
  }

  private async createDirectorTask(
    session: CompanySession,
    chatId: string,
    updateId: number,
    body: string,
    brief: boolean,
  ): Promise<void> {
    const originId = `telegram-update:${updateId}`;
    const existing = await this.ctx.issues.list({
      companyId: session.companyId,
      originKind: TELEGRAM_ORIGIN_KIND,
      originId,
      limit: 2,
    });
    if (existing[0]) {
      await this.rememberIssueChat(existing[0].id, chatId);
      await this.send(
        session,
        chatId,
        `La solicitud ya estaba registrada como ${issueLabel(existing[0])}.`,
        existing[0].id,
      );
      return;
    }

    const issue = await this.ctx.issues.create({
      companyId: session.companyId,
      title: brief ? "Brief manual solicitado por Telegram" : safeIssueTitle(body),
      description: brief ? buildBriefDescription(body) : buildTaskDescription(body),
      status: "todo",
      priority: brief ? "high" : "medium",
      assigneeAgentId: session.director.id,
      originKind: TELEGRAM_ORIGIN_KIND,
      originId,
      actor: { actorUserId: session.config.paperclipUserId },
    });
    await this.rememberIssueChat(issue.id, chatId);

    let started = false;
    try {
      const wakeup = await this.ctx.issues.requestWakeup(issue.id, session.companyId, {
        reason: "Authorized Telegram request for the Enki Director",
        contextSource: "telegram-gateway",
        idempotencyKey: `telegram:${updateId}`,
        actorUserId: session.config.paperclipUserId,
      });
      started = wakeup.queued;
    } catch {
      // The issue is safely registered even when the Director is paused or budget-blocked.
    }

    await this.send(
      session,
      chatId,
      [
        `Solicitud registrada como ${issueLabel(issue)}.`,
        started ? "El Director ha sido avisado." : "No se ha podido iniciar ahora; revisa el estado del Director en Paperclip.",
        this.link(session, `/issues/${issue.id}`),
      ].filter(Boolean).join("\n"),
      issue.id,
    );
  }

  private async replyToIssue(
    session: CompanySession,
    chatId: string,
    issue: Issue,
    body: string,
  ): Promise<void> {
    if (TERMINAL_ISSUE_STATUSES.has(issue.status)) {
      await this.send(session, chatId, "Esa tarea está cerrada. Crea una nueva solicitud para conservar el historial.");
      return;
    }
    if (issue.assigneeAgentId !== session.director.id && issue.originKind !== TELEGRAM_ORIGIN_KIND) {
      await this.send(session, chatId, "Telegram solo comenta tareas del Director. Usa Paperclip para hablar con un especialista.");
      return;
    }
    await this.ctx.issues.createComment(issue.id, body, session.companyId, {
      actorUserId: session.config.paperclipUserId,
    });
    await this.rememberIssueChat(issue.id, chatId);
    await this.send(
      session,
      chatId,
      [`Comentario añadido a ${issueLabel(issue)}.`, this.link(session, `/issues/${issue.id}`)]
        .filter(Boolean)
        .join("\n"),
      issue.id,
    );
  }

  private async findIssue(companyId: string, identifierOrId: string): Promise<Issue | null> {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(identifierOrId)) {
      return this.ctx.issues.get(identifierOrId, companyId);
    }
    const wanted = identifierOrId.toUpperCase();
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await this.ctx.issues.list({ companyId, limit: 100, offset });
      const found = page.find((issue) => issue.identifier?.toUpperCase() === wanted);
      if (found) return found;
      if (page.length < 100) break;
    }
    return null;
  }

  private async relayDirectorComment(session: CompanySession, event: PluginEvent): Promise<void> {
    if (!event.entityId || event.actorType !== "agent" || event.actorId !== session.director.id) return;
    const issue = await this.ctx.issues.get(event.entityId, session.companyId);
    if (!issue || issue.originKind !== TELEGRAM_ORIGIN_KIND) return;
    if (!(await this.claimEvent(session, event.eventId))) return;

    const commentId = stringValue(asRecord(event.payload).commentId);
    const comments = await this.ctx.issues.listComments(issue.id, session.companyId);
    const comment = commentId
      ? comments.find((item) => item.id === commentId)
      : [...comments].reverse().find((item) => item.authorAgentId === session.director.id);
    if (!comment || comment.authorAgentId !== session.director.id) return;
    const chatId = await this.chatForIssue(issue.id);
    if (!chatId || !session.config.allowedTelegramChatIds.includes(chatId)) return;

    await this.send(
      session,
      chatId,
      [
        `Director · ${issueLabel(issue)}`,
        safeOutboundBody(comment.body),
        this.link(session, `/issues/${issue.id}`),
      ].filter(Boolean).join("\n\n"),
      issue.id,
    );
  }

  private async relayCompletedIssue(session: CompanySession, event: PluginEvent): Promise<void> {
    if (!event.entityId) return;
    const payload = asRecord(event.payload);
    const status = stringValue(payload.status) ?? stringValue(asRecord(payload.patch).status);
    if (status !== "done") return;
    const issue = await this.ctx.issues.get(event.entityId, session.companyId);
    if (!issue) return;

    if (issue.originKind === TELEGRAM_ORIGIN_KIND) {
      if (!(await this.claimEvent(session, event.eventId))) return;
      const chatId = await this.chatForIssue(issue.id);
      if (!chatId) return;
      await this.send(
        session,
        chatId,
        [`${issueLabel(issue)} ha finalizado.`, this.link(session, `/issues/${issue.id}`)]
          .filter(Boolean)
          .join("\n"),
        issue.id,
      );
      return;
    }

    if (!session.config.notifyRoutineReports || !ROUTINE_TITLES.has(issue.title)) return;
    if (!(await this.claimEvent(session, event.eventId))) return;
    const comments = await this.ctx.issues.listComments(issue.id, session.companyId);
    const finalComment = [...comments]
      .reverse()
      .find((comment) => comment.authorAgentId === session.director.id && comment.body.trim().length > 0);
    const body = finalComment
      ? safeOutboundBody(finalComment.body)
      : "La rutina ha finalizado sin un comentario final del Director. Revisa el issue en Paperclip.";
    await this.send(
      session,
      session.config.reportTelegramChatId,
      [issue.title, body, this.link(session, `/issues/${issue.id}`)].filter(Boolean).join("\n\n"),
      issue.id,
    );
  }

  private async relayRunFailure(session: CompanySession, event: PluginEvent): Promise<void> {
    const payload = asRecord(event.payload);
    const issueId = stringValue(payload.issueId);
    const agentId = stringValue(payload.agentId);
    if (!issueId || agentId !== session.director.id) return;
    const issue = await this.ctx.issues.get(issueId, session.companyId);
    if (!issue || issue.originKind !== TELEGRAM_ORIGIN_KIND) return;
    if (!(await this.claimEvent(session, event.eventId))) return;
    const chatId = await this.chatForIssue(issue.id);
    if (!chatId) return;
    await this.send(
      session,
      chatId,
      [
        `${issueLabel(issue)} no ha podido completarse.`,
        "El detalle técnico queda protegido en Paperclip.",
        this.link(session, `/issues/${issue.id}`),
      ].filter(Boolean).join("\n"),
      issue.id,
    );
  }

  private async send(
    session: CompanySession,
    chatId: string,
    text: string,
    issueId?: string,
  ): Promise<void> {
    if (!session.config.allowedTelegramChatIds.includes(chatId)) return;
    const token = await this.resolveToken(session);
    const sent = await this.transport.sendMessage(token, chatId, text.slice(0, 4_096));
    if (issueId) await this.rememberTelegramMessage(session.companyId, chatId, sent.message_id, issueId);
  }

  private link(session: CompanySession, path: string): string {
    return session.config.paperclipPublicUrl ? `${session.config.paperclipPublicUrl}${path}` : "";
  }

  private isRateLimited(companyId: string, chatId: string): boolean {
    const key = `${companyId}:${chatId}`;
    const cutoff = this.now() - RATE_LIMIT_WINDOW_MS;
    const recent = (this.rateWindows.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    recent.push(this.now());
    this.rateWindows.set(key, recent);
    return recent.length > RATE_LIMIT_COUNT;
  }

  private shouldNotifyRateLimit(companyId: string, chatId: string): boolean {
    const key = `${companyId}:${chatId}`;
    const previous = this.rateLimitNotifiedAt.get(key) ?? 0;
    if (this.now() - previous < RATE_LIMIT_WINDOW_MS) return false;
    this.rateLimitNotifiedAt.set(key, this.now());
    return true;
  }

  private async readOffset(companyId: string): Promise<number> {
    const value = await this.ctx.state.get({
      scopeKind: "company",
      scopeId: companyId,
      namespace: "telegram",
      stateKey: "poll-offset",
    });
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private writeOffset(companyId: string, offset: number): Promise<void> {
    return this.ctx.state.set({
      scopeKind: "company",
      scopeId: companyId,
      namespace: "telegram",
      stateKey: "poll-offset",
    }, offset);
  }

  private async claimUpdate(session: CompanySession, updateId: number): Promise<boolean> {
    return this.claimLedger(session.companyId, "processed-updates", String(updateId), UPDATE_LEDGER_LIMIT);
  }

  private async claimEvent(session: CompanySession, eventId: string): Promise<boolean> {
    return this.claimLedger(session.companyId, "sent-events", eventId, EVENT_LEDGER_LIMIT);
  }

  private async claimLedger(
    companyId: string,
    stateKey: string,
    value: string,
    limit: number,
  ): Promise<boolean> {
    const key = { scopeKind: "company" as const, scopeId: companyId, namespace: "telegram", stateKey };
    const current = await this.ctx.state.get(key);
    const ledger = Array.isArray(current)
      ? current.filter((item): item is string => typeof item === "string")
      : [];
    if (ledger.includes(value)) return false;
    ledger.push(value);
    await this.ctx.state.set(key, ledger.slice(-limit));
    return true;
  }

  private rememberIssueChat(issueId: string, chatId: string): Promise<void> {
    return this.ctx.state.set({
      scopeKind: "issue",
      scopeId: issueId,
      namespace: "telegram",
      stateKey: "chat-id",
    }, chatId);
  }

  private async chatForIssue(issueId: string): Promise<string | null> {
    const value = await this.ctx.state.get({
      scopeKind: "issue",
      scopeId: issueId,
      namespace: "telegram",
      stateKey: "chat-id",
    });
    return typeof value === "string" ? value : null;
  }

  private rememberTelegramMessage(
    companyId: string,
    chatId: string,
    telegramMessageId: number,
    issueId: string,
  ): Promise<void> {
    return this.ctx.state.set({
      scopeKind: "company",
      scopeId: companyId,
      namespace: "telegram-message-links",
      stateKey: `${chatId}:${telegramMessageId}`,
    }, issueId);
  }

  private async issueForTelegramMessage(
    companyId: string,
    chatId: string,
    telegramMessageId: number,
  ): Promise<string | null> {
    const value = await this.ctx.state.get({
      scopeKind: "company",
      scopeId: companyId,
      namespace: "telegram-message-links",
      stateKey: `${chatId}:${telegramMessageId}`,
    });
    return typeof value === "string" ? value : null;
  }
}
