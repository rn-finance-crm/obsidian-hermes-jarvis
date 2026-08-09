import { Type } from '@google/genai';
import type { App } from 'obsidian';
import { getObsidianPlugin } from '../persistence/persistence';
import type { ToolCallbacks } from '../types';

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

export const declaration = {
  name: 'open_file',
  description:
    "Open a vault file in whatever application the system uses for it — a PDF in the PDF reader, a document in Word. Use when the user wants to look at or print a file rather than have a copy of it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filename: { type: Type.STRING, description: 'Path relative to vault root of the file to open' },
    },
    required: ['filename'],
  },
};

export const instruction = `- open_file: Opens a file in the application the system associates with it. Use it when the user wants to see or print something now. Note the difference from the neighbouring tools: read_file shows you the contents, open_folder_in_system shows the containing folder, export_file puts a copy on the Desktop, and this one opens the file itself. Parameters:
  - filename: required, path in the vault`;

export const execute = async (
  args: ToolArgs,
  callbacks: ToolCallbacks,
): Promise<{ status: string; opened?: string; error?: string }> => {
  const filename = getStringArg(args, 'filename');
  if (!filename) throw new Error('Missing filename');

  const fail = (error: string) => {
    callbacks.onSystem(error, { name: 'open_file', filename, status: 'error', error });
    return { status: 'error', error };
  };

  const app = (getObsidianPlugin() as unknown as { app?: App } | null)?.app;
  if (!app) return fail('Could not reach Obsidian from this environment.');

  const adapter = app.vault.adapter as unknown as {
    getFullPath?: (p: string) => string;
    openPath?: (p: string) => Promise<void>;
  };

  if (typeof adapter.getFullPath !== 'function') return fail('Could not resolve the vault path.');

  const target = adapter.getFullPath(filename);

  try {
    if (typeof adapter.openPath === 'function') {
      // Same mechanism open_folder_in_system uses, pointed at the file itself
      // rather than climbing to its parent folder.
      await adapter.openPath(target);
    } else {
      const openWithDefaultApp = (app as unknown as { openWithDefaultApp?: (p: string) => Promise<void> | void })
        .openWithDefaultApp;
      if (!openWithDefaultApp) return fail('This build of Obsidian cannot open files externally.');
      await openWithDefaultApp(target);
    }

    callbacks.onSystem(`Opened ${filename}`, {
      name: 'open_file',
      filename,
      status: 'success',
      systemPath: target,
    });

    return { status: 'success', opened: target };
  } catch (error) {
    return fail(`Could not open the file: ${error instanceof Error ? error.message : String(error)}`);
  }
};
