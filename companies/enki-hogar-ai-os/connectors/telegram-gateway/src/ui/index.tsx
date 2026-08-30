import { useState } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginBridgeError,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

interface HealthData {
  configured: boolean;
  enabled: boolean;
  polling: boolean;
  status: "disabled" | "starting" | "ok" | "degraded" | "error";
  botUsername: string | null;
  directorStatus: string | null;
  lastSuccessfulPollAt: string | null;
  lastErrorKind: string | null;
  message: string;
}

export function DashboardWidget({ context }: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<HealthData>("health", {
    companyId: context.companyId,
  });
  const testConnection = usePluginAction("test-connection");
  const [testing, setTesting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function test(): Promise<void> {
    setTesting(true);
    setActionError(null);
    try {
      await testConnection({});
      refresh();
    } catch (caught) {
      setActionError((caught as PluginBridgeError).message ?? "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <section><strong>Enki Telegram Gateway</strong><p>Cargando estado…</p></section>;
  if (error) return <section><strong>Enki Telegram Gateway</strong><p>Error: {error.message}</p></section>;

  return (
    <section>
      <strong>Enki Telegram Gateway</strong>
      <dl>
        <dt>Estado</dt><dd>{data?.status ?? "unknown"}</dd>
        <dt>Bot</dt><dd>{data?.botUsername ? `@${data.botUsername}` : "sin verificar"}</dd>
        <dt>Director</dt><dd>{data?.directorStatus ?? "sin resolver"}</dd>
        <dt>Último poll correcto</dt><dd>{data?.lastSuccessfulPollAt ?? "nunca"}</dd>
      </dl>
      <p>{data?.message}</p>
      {data?.lastErrorKind ? <p>Código seguro: {data.lastErrorKind}</p> : null}
      {actionError ? <p>{actionError}</p> : null}
      <button type="button" disabled={testing || !data?.configured || !data.enabled} onClick={() => void test()}>
        {testing ? "Probando…" : "Probar conexión"}
      </button>
      <p>Las aprobaciones se revisan y deciden únicamente en Paperclip.</p>
    </section>
  );
}
