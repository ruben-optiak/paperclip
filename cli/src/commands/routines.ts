import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import {
  applyPendingMigrations,
  createDb,
  createEmbeddedPostgresLogBuffer,
  ensurePostgresDatabase,
  formatEmbeddedPostgresError,
  prepareEmbeddedPostgresNativeRuntime,
  routines,
} from "@paperclipai/db";
import { eq, inArray } from "drizzle-orm";
import { loadPaperclipEnvFile } from "../config/env.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import {
  addCommonClientOptions,
  apiPath,
  resolveCommandContext,
  type BaseClientOptions,
} from "./client/common.js";

type RoutinesDisableAllOptions = BaseClientOptions;

type DisableAllRoutinesResult = {
  companyId: string;
  totalRoutines: number;
  pausedCount: number;
  alreadyPausedCount: number;
  archivedCount: number;
  disabledTriggerCount?: number;
  alreadyDisabledTriggerCount?: number;
};

type RoutineApiRecord = {
  id: string;
  status: string;
  triggers?: Array<{ id: string; enabled: boolean }>;
};

type RoutineApiClient = {
  get<T>(path: string): Promise<T | null>;
  patch<T>(path: string, body?: unknown): Promise<T | null>;
};

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

type EmbeddedPostgresHandle = {
  port: number;
  startedByThisProcess: boolean;
  stop: () => Promise<void>;
};

type ClosableDb = ReturnType<typeof createDb> & {
  $client?: {
    end?: (options?: { timeout?: number }) => Promise<void>;
  };
};

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  let port = Math.max(1, Math.trunc(preferredPort));
  while (!(await isPortAvailable(port))) {
    port += 1;
  }
  return port;
}

function readPidFilePort(postmasterPidFile: string): number | null {
  if (!fs.existsSync(postmasterPidFile)) return null;
  try {
    const lines = fs.readFileSync(postmasterPidFile, "utf8").split("\n");
    const port = Number(lines[3]?.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readRunningPostmasterPid(postmasterPidFile: string): number | null {
  if (!fs.existsSync(postmasterPidFile)) return null;
  try {
    const pid = Number(fs.readFileSync(postmasterPidFile, "utf8").split("\n")[0]?.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

async function ensureEmbeddedPostgres(dataDir: string, preferredPort: number): Promise<EmbeddedPostgresHandle> {
  const moduleName = "embedded-postgres";
  let EmbeddedPostgres: EmbeddedPostgresCtor;
  try {
    const mod = await import(moduleName);
    EmbeddedPostgres = mod.default as EmbeddedPostgresCtor;
  } catch {
    throw new Error(
      "Embedded PostgreSQL support requires dependency `embedded-postgres`. Reinstall dependencies and try again.",
    );
  }
  await prepareEmbeddedPostgresNativeRuntime();

  const postmasterPidFile = path.resolve(dataDir, "postmaster.pid");
  const runningPid = readRunningPostmasterPid(postmasterPidFile);
  if (runningPid) {
    return {
      port: readPidFilePort(postmasterPidFile) ?? preferredPort,
      startedByThisProcess: false,
      stop: async () => {},
    };
  }

  const port = await findAvailablePort(preferredPort);
  const logBuffer = createEmbeddedPostgresLogBuffer();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    onLog: logBuffer.append,
    onError: logBuffer.append,
  });

  if (!fs.existsSync(path.resolve(dataDir, "PG_VERSION"))) {
    try {
      await instance.initialise();
    } catch (error) {
      throw formatEmbeddedPostgresError(error, {
        fallbackMessage: `Failed to initialize embedded PostgreSQL cluster in ${dataDir} on port ${port}`,
        recentLogs: logBuffer.getRecentLogs(),
      });
    }
  }

  if (fs.existsSync(postmasterPidFile)) {
    fs.rmSync(postmasterPidFile, { force: true });
  }

  try {
    await instance.start();
  } catch (error) {
    throw formatEmbeddedPostgresError(error, {
      fallbackMessage: `Failed to start embedded PostgreSQL on port ${port}`,
      recentLogs: logBuffer.getRecentLogs(),
    });
  }

  return {
    port,
    startedByThisProcess: true,
    stop: async () => {
      await instance.stop();
    },
  };
}

async function closeDb(db: ClosableDb): Promise<void> {
  await db.$client?.end?.({ timeout: 5 }).catch(() => undefined);
}

async function openConfiguredDb(configPath: string): Promise<{
  db: ClosableDb;
  stop: () => Promise<void>;
}> {
  const config = readConfig(configPath);
  if (!config) {
    throw new Error(`Config not found at ${configPath}.`);
  }

  let embeddedHandle: EmbeddedPostgresHandle | null = null;
  try {
    if (config.database.mode === "embedded-postgres") {
      embeddedHandle = await ensureEmbeddedPostgres(
        config.database.embeddedPostgresDataDir,
        config.database.embeddedPostgresPort,
      );
      const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${embeddedHandle.port}/postgres`;
      await ensurePostgresDatabase(adminConnectionString, "paperclip");
      const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${embeddedHandle.port}/paperclip`;
      await applyPendingMigrations(connectionString);
      const db = createDb(connectionString) as ClosableDb;
      return {
        db,
        stop: async () => {
          await closeDb(db);
          if (embeddedHandle?.startedByThisProcess) {
            await embeddedHandle.stop().catch(() => undefined);
          }
        },
      };
    }

    const connectionString = nonEmpty(config.database.connectionString);
    if (!connectionString) {
      throw new Error(`Config at ${configPath} does not define a database connection string.`);
    }

    await applyPendingMigrations(connectionString);
    const db = createDb(connectionString) as ClosableDb;
    return {
      db,
      stop: async () => {
        await closeDb(db);
      },
    };
  } catch (error) {
    if (embeddedHandle?.startedByThisProcess) {
      await embeddedHandle.stop().catch(() => undefined);
    }
    throw error;
  }
}

export async function disableAllRoutinesInConfig(
  options: Pick<RoutinesDisableAllOptions, "config" | "companyId">,
): Promise<DisableAllRoutinesResult> {
  const configPath = resolveConfigPath(options.config);
  loadPaperclipEnvFile(configPath);
  const companyId =
    nonEmpty(options.companyId)
    ?? nonEmpty(process.env.PAPERCLIP_COMPANY_ID)
    ?? null;
  if (!companyId) {
    throw new Error("Company ID is required. Pass --company-id or set PAPERCLIP_COMPANY_ID.");
  }

  const config = readConfig(configPath);
  if (!config) {
    throw new Error(`Config not found at ${configPath}.`);
  }

  let embeddedHandle: EmbeddedPostgresHandle | null = null;
  let db: ClosableDb | null = null;
  try {
    if (config.database.mode === "embedded-postgres") {
      embeddedHandle = await ensureEmbeddedPostgres(
        config.database.embeddedPostgresDataDir,
        config.database.embeddedPostgresPort,
      );
      const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${embeddedHandle.port}/postgres`;
      await ensurePostgresDatabase(adminConnectionString, "paperclip");
      const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${embeddedHandle.port}/paperclip`;
      await applyPendingMigrations(connectionString);
      db = createDb(connectionString) as ClosableDb;
    } else {
      const connectionString = nonEmpty(config.database.connectionString);
      if (!connectionString) {
        throw new Error(`Config at ${configPath} does not define a database connection string.`);
      }
      await applyPendingMigrations(connectionString);
      db = createDb(connectionString) as ClosableDb;
    }

    const existing = await db
      .select({
        id: routines.id,
        status: routines.status,
      })
      .from(routines)
      .where(eq(routines.companyId, companyId));

    const alreadyPausedCount = existing.filter((routine) => routine.status === "paused").length;
    const archivedCount = existing.filter((routine) => routine.status === "archived").length;
    const idsToPause = existing
      .filter((routine) => routine.status !== "paused" && routine.status !== "archived")
      .map((routine) => routine.id);

    if (idsToPause.length > 0) {
      await db
        .update(routines)
        .set({
          status: "paused",
          updatedAt: new Date(),
        })
        .where(inArray(routines.id, idsToPause));
    }

    return {
      companyId,
      totalRoutines: existing.length,
      pausedCount: idsToPause.length,
      alreadyPausedCount,
      archivedCount,
    };
  } finally {
    if (db) {
      await closeDb(db);
    }
    if (embeddedHandle?.startedByThisProcess) {
      await embeddedHandle.stop().catch(() => undefined);
    }
  }
}

export async function disableAllRoutinesViaApi(
  api: RoutineApiClient,
  companyId: string,
): Promise<DisableAllRoutinesResult> {
  const existing = await api.get<RoutineApiRecord[]>(apiPath`/api/companies/${companyId}/routines`);
  if (!Array.isArray(existing)) {
    throw new Error("Routine API returned an unexpected response.");
  }

  const activeRoutines = existing.filter((routine) => routine.status !== "archived");
  const routinesToPause = activeRoutines.filter((routine) => routine.status !== "paused");
  const triggersToDisable = activeRoutines.flatMap((routine) => routine.triggers ?? []).filter((trigger) => trigger.enabled);
  const alreadyDisabledTriggerCount = activeRoutines
    .flatMap((routine) => routine.triggers ?? [])
    .filter((trigger) => !trigger.enabled)
    .length;

  for (const routine of routinesToPause) {
    await api.patch(apiPath`/api/routines/${routine.id}`, { status: "paused" });
  }
  for (const trigger of triggersToDisable) {
    await api.patch(apiPath`/api/routine-triggers/${trigger.id}`, { enabled: false });
  }

  return {
    companyId,
    totalRoutines: existing.length,
    pausedCount: routinesToPause.length,
    alreadyPausedCount: activeRoutines.length - routinesToPause.length,
    archivedCount: existing.length - activeRoutines.length,
    disabledTriggerCount: triggersToDisable.length,
    alreadyDisabledTriggerCount,
  };
}

export async function disableAllRoutinesCommand(options: RoutinesDisableAllOptions): Promise<void> {
  const result = options.apiBase?.trim()
    ? await (() => {
        const context = resolveCommandContext(options, { requireCompany: true });
        return disableAllRoutinesViaApi(context.api, context.companyId!);
      })()
    : await disableAllRoutinesInConfig(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.totalRoutines === 0) {
    console.log(pc.dim(`No routines found for company ${result.companyId}.`));
    return;
  }

  console.log(
    `Paused ${result.pausedCount} routine(s) for company ${result.companyId} ` +
      `(${result.alreadyPausedCount} already paused, ${result.archivedCount} archived).`,
  );
}

export function registerRoutineCommands(program: Command): void {
  const routinesCommand = program.command("routines").description("Routine maintenance commands");

  addCommonClientOptions(
    routinesCommand
      .command("disable-all")
      .description("Pause routines and, in API mode, disable their triggers for one company")
      .action(async (opts: RoutinesDisableAllOptions) => {
      try {
        await disableAllRoutinesCommand(opts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(pc.red(message));
        process.exit(1);
      }
      }),
    { includeCompany: true },
  );
}
