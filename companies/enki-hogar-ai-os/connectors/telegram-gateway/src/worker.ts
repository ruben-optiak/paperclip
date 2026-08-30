import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginHealthDiagnostics,
} from "@paperclipai/plugin-sdk";
import { validateGatewayConfig } from "./config.js";
import { TelegramGatewayController } from "./gateway.js";

let controller: TelegramGatewayController | null = null;
let pluginContext: PluginContext | null = null;
const subscribedCompanies = new Set<string>();

function subscribeToCompanyEvents(companyId: string): void {
  if (!pluginContext || subscribedCompanies.has(companyId)) return;
  subscribedCompanies.add(companyId);
  for (const eventType of [
    "issue.comment.created",
    "issue.updated",
    "agent.run.failed",
    "approval.created",
  ] as const) {
    pluginContext.events.on(eventType, { companyId }, async (event) => {
      await controller?.handleEvent(event);
    });
  }
}

const plugin = definePlugin({
  multiCompanyConfig: true,

  async setup(ctx) {
    pluginContext = ctx;
    controller = new TelegramGatewayController(ctx);

    ctx.data.register("health", async ({ companyId }) => {
      if (typeof companyId !== "string" || companyId.length === 0) {
        throw new Error("A company context is required.");
      }
      return controller?.getHealth(companyId) ?? null;
    });

    ctx.actions.register("test-connection", async (_params, context) => {
      if (context.actor.type !== "user" || !context.companyId) {
        throw new Error("Only an authenticated board user can test this connection.");
      }
      return controller?.testConnection(context.companyId) ?? null;
    });
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const health = controller?.getAllHealth() ?? [];
    if (health.length === 0) {
      return {
        status: "degraded",
        message: "Worker is running and waiting for company configuration.",
      };
    }
    const hasError = health.some((item) => item.status === "error");
    const hasDegraded = health.some((item) => item.status === "degraded" || item.status === "starting");
    return {
      status: hasError ? "error" : hasDegraded ? "degraded" : "ok",
      message: hasError
        ? "At least one company Telegram connection needs attention."
        : hasDegraded
          ? "Telegram gateway is running with a degraded or starting company connection."
          : "Telegram gateway is healthy.",
      details: {
        configuredCompanies: health.length,
        activePollers: health.filter((item) => item.polling).length,
        errorCompanies: health.filter((item) => item.status === "error").length,
      },
    };
  },

  async onConfigChanged(newConfig, context) {
    if (!context?.companyId) return;
    const health = await controller?.applyConfig(context.companyId, newConfig);
    if (health?.directorAgentId) subscribeToCompanyEvents(context.companyId);
  },

  async onValidateConfig(config) {
    const result = validateGatewayConfig(config);
    return {
      ok: result.ok,
      errors: result.errors,
      warnings: [
        ...result.warnings,
        "This check validates structure only. Use the dashboard widget after saving to test Telegram and Paperclip identities.",
      ],
    };
  },

  async onShutdown() {
    controller?.stopAll();
    controller = null;
    pluginContext = null;
    subscribedCompanies.clear();
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
