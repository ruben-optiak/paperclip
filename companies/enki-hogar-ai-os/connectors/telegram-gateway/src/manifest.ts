import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "enki-hogar.telegram-gateway",
  apiVersion: 1,
  version: "0.2.0",
  displayName: "Enki Telegram Gateway",
  description: "Audited Telegram bridge for Enki Hogar director tasks, reports, and approval notifications",
  author: "Enki Hogar",
  categories: ["connector"],
  capabilities: [
    "issues.read",
    "issues.create",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "issue.comments.create_human_attributed",
    "agents.read",
    "access.members.read",
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "secrets.read-ref",
    "http.outbound",
    "ui.dashboardWidget.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: [
      "botToken",
      "paperclipUserId",
      "allowedTelegramUserIds",
      "allowedTelegramChatIds",
      "reportTelegramChatId"
    ],
    properties: {
      enabled: {
        type: "boolean",
        title: "Enable Telegram gateway",
        description: "Starts one company-scoped long-polling worker.",
        default: false
      },
      botToken: {
        // Paperclip persists the picker selection as the shared object-shaped
        // secret_ref binding. Using object here also makes the API reject a
        // pasted raw token before it can reach company-scoped plugin config.
        type: "object",
        format: "secret-ref",
        title: "Telegram bot token",
        description: "Paperclip Secret created from the token issued by BotFather."
      },
      paperclipUserId: {
        type: "string",
        title: "Paperclip user ID",
        description: "Active non-viewer human company member used for audited Telegram attribution."
      },
      allowedTelegramUserIds: {
        type: "array",
        title: "Allowed Telegram user IDs",
        description: "Exact numeric sender IDs. Unauthorized senders are ignored.",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^[0-9]+$" }
      },
      allowedTelegramChatIds: {
        type: "array",
        title: "Allowed Telegram chat IDs",
        description: "Exact numeric private or group chat IDs, including a leading minus when applicable.",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^-?[0-9]+$" }
      },
      reportTelegramChatId: {
        type: "string",
        title: "Report destination chat ID",
        description: "Must also appear in the allowed chat list.",
        pattern: "^-?[0-9]+$"
      },
      directorAgentId: {
        type: "string",
        title: "Director agent ID",
        description: "Optional runtime UUID. When empty, the plugin resolves the unique Enki Director by name/CEO role."
      },
      paperclipPublicUrl: {
        type: "string",
        title: "Paperclip URL visible from your phone",
        description: "Optional HTTPS base URL used only for issue and approval links."
      },
      notifyApprovals: {
        type: "boolean",
        title: "Notify pending approvals",
        description: "Sends a link only. Telegram can never approve or reject.",
        default: true
      },
      notifyRoutineReports: {
        type: "boolean",
        title: "Send scheduled reports",
        description: "Relays completed daily and weekly Director reports after sensitive-content checks.",
        default: true
      },
      notifyDirectorReplies: {
        type: "boolean",
        title: "Send Director replies",
        description: "Relays Director comments for work originally requested through Telegram.",
        default: true
      }
    }
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: "Enki Telegram Gateway Health",
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;
