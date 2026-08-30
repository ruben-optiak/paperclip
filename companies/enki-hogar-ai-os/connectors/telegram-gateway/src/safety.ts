import { MAX_OUTBOUND_TEXT_LENGTH } from "./config.js";

const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:^|\D)(?:\+?34[ .-]?)?(?:6|7|8|9)(?:[ .-]?\d){8}(?:\D|$)/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|secret|password|contrase(?:ñ|n)a|authorization)\s*[:=]/i,
  /\b(?:pedido|order)\s*(?:#|n(?:ú|u)m(?:ero)?\.?|id)?\s*[A-Z0-9-]{4,}\b/i,
];

export function containsSensitiveContent(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function safeIssueTitle(request: string): string {
  if (containsSensitiveContent(request)) return "Telegram: solicitud con datos sensibles";
  const compact = compactWhitespace(request);
  const body = compact.length > 86 ? `${compact.slice(0, 83)}…` : compact;
  return `Telegram: ${body || "nueva solicitud"}`;
}

export function safeOutboundBody(value: string): string {
  if (containsSensitiveContent(value)) {
    return "El resultado contiene información sensible y no se mostrará en Telegram. Revísalo en Paperclip.";
  }
  const trimmed = value.trim();
  if (trimmed.length <= MAX_OUTBOUND_TEXT_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_OUTBOUND_TEXT_LENGTH - 22)}\n\n[Contenido recortado]`;
}

export function safeTelegramError(): string {
  return "No he podido completar la operación. Revisa el estado del gateway en Paperclip y vuelve a intentarlo con un mensaje nuevo.";
}
