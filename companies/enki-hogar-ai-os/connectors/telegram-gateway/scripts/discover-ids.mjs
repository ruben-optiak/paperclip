#!/usr/bin/env node
import process from "node:process";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const token = await readStdin();
if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
  console.error("Expected one Telegram bot token on stdin.");
  process.exit(2);
}

let response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({limit: 100, timeout: 0, allowed_updates: ["message"]}),
  });
} catch {
  console.error("Could not reach Telegram.");
  process.exit(3);
}

let envelope;
try {
  envelope = await response.json();
} catch {
  console.error("Telegram returned an unreadable response.");
  process.exit(3);
}
if (!response.ok || envelope?.ok !== true || !Array.isArray(envelope.result)) {
  console.error("Telegram rejected the request. Check the bot token and webhook/poller state.");
  process.exit(4);
}

const identities = new Map();
for (const update of envelope.result) {
  const message = update?.message;
  if (!message?.from?.id || !message?.chat?.id) continue;
  const key = `${message.from.id}:${message.chat.id}`;
  identities.set(key, {
    userId: String(message.from.id),
    chatId: String(message.chat.id),
    chatType: String(message.chat.type ?? "unknown"),
  });
}

if (identities.size === 0) {
  console.error("No message updates found. Send /start to the bot, then run this command again.");
  process.exit(5);
}
console.log(JSON.stringify([...identities.values()], null, 2));
