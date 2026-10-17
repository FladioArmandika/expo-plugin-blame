import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface BaseCheckout {
  /** The project folder inside the checkout of the base ref. */
  projectRoot: string;
  /** The resolved commit, short form. */
  commit: string;
  /** How the checkout got its dependencies. */
  deps: 'linked' | 'installed';
  dispose(): void;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`Couldn't run git: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

// Files that decide what ends up in node_modules.
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'];
const DEP_FILES = ['package.json', ...LOCKFILES];

const INSTALL: Record<string, string[]> = {
  'package-lock.json': ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  'yarn.lock': ['yarn', 'install', '--ignore-scripts'],
  'pnpm-lock.yaml': ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'],
  'bun.lock': ['bun', 'install', '--frozen-lockfile', '--ignore-scripts'],
  'bun.lockb': ['bun', 'install', '--frozen-lockfile', '--ignore-scripts'],
};

const read = (file: string) => (existsSync(file) ? readFileSync(file) : undefined);

/**
 * Checks out `ref` of the repository that contains `projectRoot` into a temp
 * folder, and gives it dependencies: the current node_modules when package.json
 * and the lockfile are unchanged, otherwise a fresh install.
 */
export async function checkoutBase(
  projectRoot: string,
  ref: string,
  onInstall?: () => void,
): Promise<BaseCheckout> {
  let repoRoot: string;
  try {
    repoRoot = git(projectRoot, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`--base needs a git repository, and ${projectRoot} isn't in one.`);
  }
  let commit: string;
  try {
    commit = git(repoRoot, ['rev-parse', '--verify', '--quiet', '--short', `${ref}^{commit}`]);
  } catch {
    throw new Error(`Couldn't find ${ref} in this repository. In CI, fetch it first (for actions/checkout, set fetch-depth: 0).`);
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'expo-plugin-blame-base-'));
  const checkout = path.join(tmp, 'repo');
  git(repoRoot, ['worktree', 'add', '--detach', '--quiet', checkout, commit]);
  const dispose = () => {
    spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: repoRoot });
    rmSync(tmp, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot });
  };

  try {
    const rel = path.relative(repoRoot, path.resolve(projectRoot));
    const baseProject = path.join(checkout, rel);
    if (!existsSync(baseProject)) throw new Error(`${rel || 'The project'} doesn't exist at ${ref}.`);

    // The folders from the project up to the repo root, where dependencies can live.
    const levels: string[] = [];
    for (let dir = rel; ; dir = path.dirname(dir)) {
      levels.push(dir === '.' ? '' : dir);
      if (dir === '' || dir === '.') break;
    }
    const same = levels.every((dir) =>
      DEP_FILES.every((file) => {
        const a = read(path.join(repoRoot, dir, file));
        const b = read(path.join(checkout, dir, file));
        return a === b || (!!a && !!b && a.equals(b));
      }),
    );

    let deps: BaseCheckout['deps'] = 'linked';
    if (same) {
      for (const dir of levels) {
        const modules = path.join(repoRoot, dir, 'node_modules');
        if (existsSync(modules)) symlinkSync(modules, path.join(checkout, dir, 'node_modules'), 'junction');
      }
    } else {
      const dir = levels.find((d) => LOCKFILES.some((f) => existsSync(path.join(checkout, d, f))));
      if (dir === undefined) throw new Error(`Dependencies changed since ${ref}, and there's no lockfile there to install them from.`);
      const lockfile = LOCKFILES.find((f) => existsSync(path.join(checkout, dir, f)))!;
      onInstall?.();
      await install(INSTALL[lockfile]!, path.join(checkout, dir));
      deps = 'installed';
    }
    return { projectRoot: baseProject, commit, deps, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

function install([cmd, ...args]: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => reject(new Error(`Couldn't run ${cmd} to install the base's dependencies: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installing the base's dependencies failed (${cmd} ${args.join(' ')}, exit ${code}):\n${output.trim()}`));
    });
  });
}
