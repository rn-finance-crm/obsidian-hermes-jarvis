import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import { getObsidianPlugin } from '../persistence/persistence';

/**
 * Local git snapshots of the vault, taken just before an approved destructive
 * operation runs, so a bad change can be undone in seconds.
 *
 * Desktop only: it shells out to git, which does not exist on mobile. When it
 * cannot run it reports that and the confirmation gate carries on regardless —
 * the snapshot is a safety net, never a precondition.
 */

/**
 * `.obsidian` is excluded in full, deliberately. The plugin's own data.json
 * inside it holds the Gemini and Serper API keys, and a key committed once
 * stays in history. Vault content — the part worth restoring — is all kept.
 */
const GITIGNORE = `.obsidian/
.trash/
.DS_Store
Thumbs.db
`;

const COMMIT_NAME = 'Hermes safety gate';
const COMMIT_EMAIL = 'hermes@localhost';

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Obsidian's desktop runtime exposes Node's require on window. Reached through
 * window rather than a static import so esbuild does not try to bundle Node
 * built-ins into a plugin that also ships to mobile.
 */
const nodeRequire = (): ((moduleName: string) => unknown) | null => {
  const runtime = window as unknown as { require?: (moduleName: string) => unknown };
  return typeof runtime.require === 'function' ? runtime.require : null;
};

export const isAvailable = (): boolean => Platform.isDesktopApp && nodeRequire() !== null;

let snapshotsEnabled = true;

export const setSnapshotsEnabled = (value: boolean): void => {
  snapshotsEnabled = value;
};

const vaultPath = (): string | null => {
  try {
    const app = (getObsidianPlugin() as unknown as { app?: App } | null)?.app;
    const adapter = app?.vault.adapter as unknown as { getBasePath?: () => string } | undefined;
    return typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : null;
  } catch {
    return null;
  }
};

const runGit = (args: string[], cwd: string): Promise<GitResult> =>
  new Promise((resolve) => {
    const req = nodeRequire();
    if (!req) {
      resolve({ ok: false, stdout: '', stderr: 'node runtime unavailable' });
      return;
    }

    try {
      const { execFile } = req('child_process') as {
        execFile: (
          file: string,
          args: string[],
          options: { cwd: string; windowsHide: boolean; maxBuffer: number },
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => void;
      };

      execFile(
        'git',
        args,
        { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }),
      );
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: String(error) });
    }
  });

/**
 * Creates the repository on first use. Safe to call repeatedly.
 *
 * A local identity is set explicitly because this machine has no global git
 * identity configured, and `git commit` fails outright without one.
 */
export const ensureRepo = async (): Promise<{ ok: boolean; message: string }> => {
  if (!isAvailable()) return { ok: false, message: 'Git snapshots need the desktop app.' };

  const cwd = vaultPath();
  if (!cwd) return { ok: false, message: 'Could not resolve the vault path.' };

  const inRepo = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inRepo.ok) return { ok: true, message: 'Vault is already under git.' };

  const init = await runGit(['init'], cwd);
  if (!init.ok) return { ok: false, message: `git init failed: ${init.stderr.trim()}` };

  const req = nodeRequire();
  if (req) {
    try {
      const fs = req('fs') as { writeFileSync: (p: string, d: string) => void };
      const path = req('path') as { join: (...parts: string[]) => string };
      fs.writeFileSync(path.join(cwd, '.gitignore'), GITIGNORE);
    } catch {
      // Without a .gitignore the first commit would sweep in .obsidian, so stop.
      return { ok: false, message: 'Could not write .gitignore; repository left empty.' };
    }
  }

  await runGit(['config', 'user.name', COMMIT_NAME], cwd);
  await runGit(['config', 'user.email', COMMIT_EMAIL], cwd);

  await runGit(['add', '-A'], cwd);
  const commit = await runGit(['commit', '-m', 'Initial vault snapshot'], cwd);

  return commit.ok
    ? { ok: true, message: 'Vault repository created with an initial snapshot.' }
    : { ok: false, message: `Initial commit failed: ${commit.stderr.trim()}` };
};

/**
 * Commits the current state under a label describing what is about to happen.
 * A clean tree is not an error — it means the last snapshot still represents it.
 */
export const snapshot = async (label: string): Promise<{ ok: boolean; message: string }> => {
  if (!snapshotsEnabled) return { ok: true, message: 'Vault snapshots are switched off.' };
  if (!isAvailable()) return { ok: false, message: 'Git snapshots need the desktop app.' };

  const cwd = vaultPath();
  if (!cwd) return { ok: false, message: 'Could not resolve the vault path.' };

  const ready = await ensureRepo();
  if (!ready.ok) return ready;

  await runGit(['add', '-A'], cwd);

  const status = await runGit(['status', '--porcelain'], cwd);
  if (status.ok && status.stdout.trim() === '') {
    return { ok: true, message: 'Nothing changed since the last snapshot.' };
  }

  const commit = await runGit(['commit', '-m', `Before ${label}`], cwd);
  return commit.ok
    ? { ok: true, message: `Snapshot taken before ${label}.` }
    : { ok: false, message: `Snapshot failed: ${commit.stderr.trim()}` };
};
