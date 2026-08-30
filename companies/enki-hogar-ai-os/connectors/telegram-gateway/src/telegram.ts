import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  reply_to_message?: Pick<TelegramMessage, "message_id">;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramSentMessage {
  message_id: number;
}

export interface TelegramBotIdentity {
  id: number;
  username?: string;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
}

export interface TelegramTransport {
  getMe(token: string): Promise<TelegramBotIdentity>;
  getUpdates(token: string, offset: number): Promise<TelegramUpdate[]>;
  sendMessage(token: string, chatId: string, text: string): Promise<TelegramSentMessage>;
}

export class TelegramTransportError extends Error {
  constructor(readonly kind: "auth" | "conflict" | "rate_limit" | "network" | "api") {
    super(`Telegram request failed (${kind})`);
    this.name = "TelegramTransportError";
  }
}

function classifyError(status: number, errorCode?: number): TelegramTransportError["kind"] {
  if (status === 401 || errorCode === 401) return "auth";
  if (status === 409 || errorCode === 409) return "conflict";
  if (status === 429 || errorCode === 429) return "rate_limit";
  if (status >= 500 || status === 0) return "network";
  return "api";
}

export class PaperclipTelegramTransport implements TelegramTransport {
  constructor(private readonly http: PluginContext["http"]) {}

  private async call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
    if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new TelegramTransportError("auth");
    }

    let response: Response;
    try {
      response = await this.http.fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new TelegramTransportError("network");
    }

    let envelope: TelegramEnvelope<T> | null = null;
    try {
      envelope = await response.json() as TelegramEnvelope<T>;
    } catch {
      // Deliberately discard response bodies: Telegram may echo request data.
    }
    if (!response.ok || !envelope?.ok || envelope.result === undefined) {
      throw new TelegramTransportError(classifyError(response.status, envelope?.error_code));
    }
    return envelope.result;
  }

  getMe(token: string): Promise<TelegramBotIdentity> {
    return this.call<TelegramBotIdentity>(token, "getMe", {});
  }

  getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(token, "getUpdates", {
      offset,
      limit: 25,
      timeout: 20,
      allowed_updates: ["message"],
    });
  }

  sendMessage(token: string, chatId: string, text: string): Promise<TelegramSentMessage> {
    return this.call<TelegramSentMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
    });
  }
}
