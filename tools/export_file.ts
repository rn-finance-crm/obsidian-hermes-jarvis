import { Type } from '@google/genai';
import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import { getObsidianPlugin } from '../persistence/persistence';
import { repairFileName, uniqueName } from '../utils/attachmentNames';
import type { ToolCallbacks } from '../types';

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Where an export is allowed to land. Deliberately a closed list: this is the
 * only place the assistant can write outside the vault, and the vault's git
 * history does not cover anything out here.
 */
const DESTINATIONS = ['desktop', 'downloads'] as const;
type Destination = (typeof DESTINATIONS)[number];

export const declaration = {
  name: 'export_file',
  description:
    'Copy a file out of the vault to the Desktop or Downloads folder so the user can attach, print or send it. Works for any file type: PDF, Word, Excel, images.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      filename: { type: Type.STRING, description: 'Path relative to vault root of the file to export' },
      destination: { type: Type.STRING, description: 'Either "desktop" (default) or "downloads"' },
      saveAs: { type: Type.STRING, description: 'Optional filename to save as. Leave empty to keep the original name.' },
    },
    required: ['filename'],
  },
};

export const instruction = `- export_file: Copies a file out of the vault so the user can actually use it — attach it to an email, print it, or send it to a client. Use it whenever they ask to save, download, or get a file out. Reading a file only shows its contents; this puts a real copy on their Desktop. Parameters:
  - filename: required, path in the vault
  - destination: optional, "desktop" (default) or "downloads"
  - saveAs: optional, a nicer filename
  Damaged attachment names are repaired and a missing file extension is added automatically, so what lands is openable. An existing file is never overwritten — a numbered copy is made instead. Always tell the user the full path it was saved to.`;

/** Obsidian's desktop runtime exposes Node's require on window. */
const nodeRequire = (): ((moduleName: string) => unknown) | null => {
  const runtime = window as unknown as { require?: (moduleName: string) => unknown };
  return typeof runtime.require === 'function' ? runtime.require : null;
};

const getApp = (): App | null =>
  (getObsidianPlugin() as unknown as { app?: App } | null)?.app ?? null;

export const execute = async (
  args: ToolArgs,
  callbacks: ToolCallbacks,
): Promise<{ status: string; savedTo?: string; error?: string }> => {
  const filename = getStringArg(args, 'filename');
  if (!filename) throw new Error('Missing filename');

  const fail = (error: string) => {
    callbacks.onSystem(error, { name: 'export_file', filename, status: 'error', error });
    return { status: 'error', error };
  };

  if (!Platform.isDesktopApp) {
    return fail('Exporting files needs the desktop app; it is not available on mobile.');
  }

  const requested = (getStringArg(args, 'destination') || 'desktop').toLowerCase();
  if (!DESTINATIONS.includes(requested as Destination)) {
    return fail(`Files can only be exported to ${DESTINATIONS.join(' or ')}, not "${requested}".`);
  }

  const req = nodeRequire();
  const app = getApp();
  if (!req || !app) return fail('Could not reach the file system from this environment.');

  try {
    const fs = req('fs') as {
      existsSync: (p: string) => boolean;
      copyFileSync: (from: string, to: string) => void;
      openSync: (p: string, flags: string) => number;
      readSync: (fd: number, buf: Uint8Array, off: number, len: number, pos: number) => number;
      closeSync: (fd: number) => void;
    };
    const path = req('path') as { join: (...parts: string[]) => string; basename: (p: string) => string; dirname: (p: string) => string };
    const os = req('os') as { homedir: () => string };

    const adapter = app.vault.adapter as unknown as { getFullPath?: (p: string) => string };
    if (typeof adapter.getFullPath !== 'function') return fail('Could not resolve the vault path.');

    const source = adapter.getFullPath(filename);
    if (!fs.existsSync(source)) return fail(`There is no file at "${filename}" in the vault.`);

    // Read the first bytes so a missing extension can be identified from content.
    let head: Uint8Array | undefined;
    try {
      const fd = fs.openSync(source, 'r');
      const buffer = new Uint8Array(64);
      fs.readSync(fd, buffer, 0, 64, 0);
      fs.closeSync(fd);
      head = buffer;
    } catch {
      head = undefined;
    }

    const folderName = path.basename(path.dirname(source));
    const desired =
      getStringArg(args, 'saveAs') ||
      repairFileName(path.basename(source), { head, folderName });

    const targetDir = path.join(os.homedir(), requested === 'downloads' ? 'Downloads' : 'Desktop');
    // Never overwrite: an existing file gets a numbered sibling instead.
    const finalName = uniqueName(desired, (candidate) => fs.existsSync(path.join(targetDir, candidate)));
    const target = path.join(targetDir, finalName);

    fs.copyFileSync(source, target);

    callbacks.onSystem(`Saved to ${requested}: ${finalName}`, {
      name: 'export_file',
      filename,
      status: 'success',
      systemPath: target,
    });

    return { status: 'success', savedTo: target };
  } catch (error) {
    return fail(`Could not export the file: ${error instanceof Error ? error.message : String(error)}`);
  }
};
