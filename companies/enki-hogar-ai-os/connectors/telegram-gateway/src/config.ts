import type { EnvSecretRefBinding } from "@paperclipai/plugin-sdk";

export const DIRECTOR_NAME = "Director de Operaciones de Enki";
export const TELEGRAM_ORIGIN_KIND = "plugin:enki-hogar.telegram-gateway" as const;
export const MAX_INBOUND_TEXT_LENGTH = 3_500;
export const MAX_OUTBOUND_TEXT_LENGTH = 3_900;

export interface TelegramGatewayConfig {
  enabled: boolean;
  botToken: EnvSecretRefBinding;
  paperclipUserId: string;
  allowedTelegramUserIds: string[];
  allowedTelegramChatIds: string[];
  reportTelegramChatId: string;
  directorAgentId: string | null;
  paperclipPublicUrl: string | null;
  notifyApprovals: boolean;
  notifyRoutineReports: boolean;
  notifyDirectorReplies: boolean;
}

export interface ConfigValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  config: TelegramGatewayConfig | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, errors: string[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} is required.`);
    return "";
  }
  return value.trim();
}

function stringIdList(
  value: unknown,
  field: string,
  pattern: RegExp,
  errors: string[],
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field} must contain at least one ID.`);
    return [];
  }

  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (normalized.some((item) => !pattern.test(item))) {
    errors.push(`${field} must contain only numeric string IDs.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${field} must not contain duplicate IDs.`);
  }
  return normalized;
}

function parsePublicUrl(value: unknown, errors: string[], warnings: string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    errors.push("paperclipPublicUrl must be a URL string.");
    return null;
  }

  try {
    const url = new URL(value.trim());
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
      errors.push("paperclipPublicUrl must use HTTPS (HTTP is accepted only for localhost).");
      return null;
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    if (localHttp) {
      warnings.push("A localhost Paperclip URL will not open from a phone outside the host.");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    errors.push("paperclipPublicUrl is not a valid URL.");
    return null;
  }
}

export function validateGatewayConfig(raw: Record<string, unknown>): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawSecret = raw.botToken;
  const botToken = isRecord(rawSecret) && rawSecret.type === "secret_ref" &&
      typeof rawSecret.secretId === "string" && rawSecret.secretId.trim().length > 0
    ? rawSecret as unknown as EnvSecretRefBinding
    : null;
  if (!botToken) {
    errors.push("botToken must be a Paperclip secret reference.");
  }

  const paperclipUserId = requiredString(raw.paperclipUserId, "paperclipUserId", errors);
  const allowedTelegramUserIds = stringIdList(
    raw.allowedTelegramUserIds,
    "allowedTelegramUserIds",
    /^[0-9]+$/,
    errors,
  );
  const allowedTelegramChatIds = stringIdList(
    raw.allowedTelegramChatIds,
    "allowedTelegramChatIds",
    /^-?[0-9]+$/,
    errors,
  );
  const reportTelegramChatId = requiredString(
    raw.reportTelegramChatId,
    "reportTelegramChatId",
    errors,
  );
  if (reportTelegramChatId && !/^-?[0-9]+$/.test(reportTelegramChatId)) {
    errors.push("reportTelegramChatId must be a numeric string ID.");
  }
  if (reportTelegramChatId && !allowedTelegramChatIds.includes(reportTelegramChatId)) {
    errors.push("reportTelegramChatId must also appear in allowedTelegramChatIds.");
  }

  const directorAgentId = raw.directorAgentId === undefined || raw.directorAgentId === null || raw.directorAgentId === ""
    ? null
    : requiredString(raw.directorAgentId, "directorAgentId", errors);
  const paperclipPublicUrl = parsePublicUrl(raw.paperclipPublicUrl, errors, warnings);

  if (errors.length > 0 || !botToken) {
    return { ok: false, errors, warnings, config: null };
  }

  return {
    ok: true,
    errors,
    warnings,
    config: {
      enabled: raw.enabled === true,
      botToken,
      paperclipUserId,
      allowedTelegramUserIds,
      allowedTelegramChatIds,
      reportTelegramChatId,
      directorAgentId,
      paperclipPublicUrl,
      notifyApprovals: raw.notifyApprovals !== false,
      notifyRoutineReports: raw.notifyRoutineReports !== false,
      notifyDirectorReplies: raw.notifyDirectorReplies !== false,
    },
  };
}
