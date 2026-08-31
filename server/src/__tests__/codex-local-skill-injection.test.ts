import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCodexSkillsInjected,
  pruneManagedCodexSkillCopies,
  resolveRunScopedCodexUserHome,
} from "@paperclipai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createPaperclipRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"paperclip"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const createAgentKey = "paperclipai/paperclip/paperclip-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Paperclip skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const oldRepo = await makeTempDir("paperclip-codex-old-");
    const skillsHome = await makeTempDir("paperclip-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createPaperclipRepoSkill(currentRepo, "paperclip-create-agent");
    await createPaperclipRepoSkill(oldRepo, "paperclip");
    await fs.symlink(path.join(oldRepo, "skills", "paperclip"), path.join(skillsHome, "paperclip"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: paperclipKey,
            runtimeName: "paperclip",
            source: path.join(currentRepo, "skills", "paperclip"),
          },
          {
            key: createAgentKey,
            runtimeName: "paperclip-create-agent",
            source: path.join(currentRepo, "skills", "paperclip-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "paperclip"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "paperclip")),
    );
    expect(await fs.realpath(path.join(skillsHome, "paperclip-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "paperclip-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "paperclip"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "paperclip-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Paperclip repo checkouts", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const customRoot = await makeTempDir("paperclip-codex-custom-");
    const skillsHome = await makeTempDir("paperclip-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createCustomSkill(customRoot, "paperclip");
    await fs.symlink(path.join(customRoot, "custom", "paperclip"), path.join(skillsHome, "paperclip"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: paperclipKey,
        runtimeName: "paperclip",
        source: path.join(currentRepo, "skills", "paperclip"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "paperclip"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "paperclip")),
    );
  });

  it("prunes broken symlinks for unavailable Paperclip repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const oldRepo = await makeTempDir("paperclip-codex-old-");
    const skillsHome = await makeTempDir("paperclip-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createPaperclipRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: paperclipKey,
          runtimeName: "paperclip",
          source: path.join(currentRepo, "skills", "paperclip"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Paperclip skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const skillsHome = await makeTempDir("paperclip-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createPaperclipRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: paperclipKey,
        runtimeName: "paperclip",
        source: path.join(currentRepo, "skills", "paperclip"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "paperclip"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });

  it("materializes managed-home skills so a filesystem sandbox never follows catalog symlinks", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const skillsHome = await makeTempDir("paperclip-codex-managed-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    const source = path.join(currentRepo, "skills", "paperclip");
    const target = path.join(skillsHome, "paperclip");
    await fs.symlink(source, target);

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{ key: paperclipKey, runtimeName: "paperclip", source }],
        materializeSkills: true,
      },
    );

    expect((await fs.lstat(target)).isDirectory()).toBe(true);
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(false);
    await expect(fs.readFile(path.join(target, "SKILL.md"), "utf8")).resolves.toContain("name: paperclip");
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Materialized Codex skill "paperclip"'),
      }),
    );
  });

  it("removes stale Paperclip-owned materializations from managed homes", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const skillsHome = await makeTempDir("paperclip-codex-managed-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createPaperclipRepoSkill(currentRepo, "agent-browser");
    const paperclipSource = path.join(currentRepo, "skills", "paperclip");
    const staleSource = path.join(currentRepo, "skills", "agent-browser");

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [
        { key: paperclipKey, runtimeName: "paperclip", source: paperclipSource },
        { key: "paperclipai/paperclip/agent-browser", runtimeName: "agent-browser", source: staleSource },
      ],
      materializeSkills: true,
    });

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{ key: paperclipKey, runtimeName: "paperclip", source: paperclipSource }],
      materializeSkills: true,
    });

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(skillsHome, "paperclip", "SKILL.md"), "utf8")).resolves.toContain(
      "name: paperclip",
    );
  });

  it("resolves a run-scoped user home only from matching heartbeat scratch metadata", async () => {
    const tmpRoot = await makeTempDir("paperclip-codex-scratch-root-");
    const scratchDir = path.join(tmpRoot, "paperclip-run-ENK-21-run-id");
    cleanupDirs.add(tmpRoot);
    await fs.mkdir(scratchDir, { recursive: true });

    const resolved = resolveRunScopedCodexUserHome({
      managedCodexHome: true,
      executionTargetIsRemote: false,
      paperclipScratch: {
        type: "heartbeat_run",
        dir: scratchDir,
        cleanupPolicy: "terminal_run",
      },
      configuredScratchDir: scratchDir,
      tmpDir: tmpRoot,
    });

    expect(resolved).toBe(path.join(scratchDir, "codex-user-home"));
    expect(resolveRunScopedCodexUserHome({
      managedCodexHome: true,
      executionTargetIsRemote: false,
      paperclipScratch: {
        type: "heartbeat_run",
        dir: scratchDir,
        cleanupPolicy: "terminal_run",
      },
      configuredScratchDir: path.join(tmpRoot, "different-run"),
      tmpDir: tmpRoot,
    })).toBeNull();
    expect(resolveRunScopedCodexUserHome({
      managedCodexHome: true,
      executionTargetIsRemote: true,
      paperclipScratch: {
        type: "heartbeat_run",
        dir: scratchDir,
        cleanupPolicy: "terminal_run",
      },
      configuredScratchDir: scratchDir,
      tmpDir: tmpRoot,
    })).toBeNull();
  });

  it("prunes Paperclip-owned managed-home copies while preserving unrelated skills", async () => {
    const currentRepo = await makeTempDir("paperclip-codex-current-");
    const skillsHome = await makeTempDir("paperclip-codex-managed-home-");
    const customRoot = await makeTempDir("paperclip-codex-custom-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);
    cleanupDirs.add(customRoot);

    await createPaperclipRepoSkill(currentRepo, "paperclip");
    await createCustomSkill(customRoot, "custom-skill");
    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: paperclipKey,
        runtimeName: "paperclip",
        source: path.join(currentRepo, "skills", "paperclip"),
      }],
      materializeSkills: true,
    });
    await fs.symlink(
      path.join(customRoot, "custom", "custom-skill"),
      path.join(skillsHome, "custom-skill"),
    );

    await pruneManagedCodexSkillCopies(skillsHome, async () => {});

    await expect(fs.lstat(path.join(skillsHome, "paperclip"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.lstat(path.join(skillsHome, "custom-skill"))).isSymbolicLink()).toBe(true);
  });
});
