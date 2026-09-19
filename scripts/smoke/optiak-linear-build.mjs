#!/usr/bin/env node
// Build only a disposable candidate. Never deploy, overwrite an active tag,
// mount the workspace/credentials, or send ignored instance files to Docker.
import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, readFileSync, mkdtempSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// The checked-in npm config is deliberately tiny; refuse local auth additions.
if (readFileSync(join(root, '.npmrc'), 'utf8').trim() !== 'auto-install-peers=false') {
  throw Error('Review npm configuration before preparing a credential-free context');
}
const roots = new Set(['cli', 'server', 'ui', 'packages', 'patches', 'scripts', 'skills']);
const rootFiles = new Set(['Dockerfile', '.dockerignore', '.npmrc', 'package.json', 'pnpm-workspace.yaml',
  'pnpm-lock.yaml', 'tsconfig.base.json', 'tsconfig.json', 'vitest.config.ts']);
if (process.argv.length > 2) throw Error('This isolated build accepts no deployment or credential arguments');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', maxBuffer: 20e6 }).split('\0').filter(Boolean))]
  .filter(p => rootFiles.has(p) || roots.has(p.split('/')[0]))
  .filter(p => !p.split('/').some(s => ['node_modules', 'dist', 'target', '.git', '.paperclip', 'data', 'tmp'].includes(s)))
  .filter(p => !/(^|\/)(\.env(?:\..*)?|auth[^/]*\.json|credentials[^/]*|google-ads\.yaml|[^/]*\.(pem|key))$/.test(p))
  .sort();
const digest = createHash('sha256');
for (const p of files) {
  if (p.startsWith('/') || p.split('/').includes('..') || !lstatSync(join(root, p)).isFile()) {
    throw Error('Unsafe or non-regular source entry refused');
  }
  digest.update(p + '\0'); digest.update(readFileSync(join(root, p)));
}
const context = mkdtempSync(join(tmpdir(), 'optiak-linear-build-'));
const archive = execFileSync('tar', ['-cf', '-', '--no-recursion', '--null', '-T', '-'], {
  cwd: root, input: files.join('\0') + '\0', maxBuffer: 300e6, env: { ...process.env, COPYFILE_DISABLE: '1' },
});
execFileSync('tar', ['-xf', '-', '-C', context], { input: archive });
const tag = `paperclip-optiak-linear-build:local-${Date.now()}`;
const logPath = `${context}.log`; // Outside COPY context; preserve failure output.
console.log(JSON.stringify({ tag, files: files.length, sourceDigest: digest.digest('hex'), context, logPath,
  scope: 'build stage only; no companies, ignored state, env or symlinks; not a deployed production image' }));
const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
const build = spawn('docker', ['build', '--progress=plain', '--target', 'build', '-t', tag, context], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [build.stdout, build.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
build.on('error', () => { console.error('Docker candidate build could not start'); process.exitCode = 1; });
build.on('close', code => { log.end(); process.exitCode = code ?? 1; });
