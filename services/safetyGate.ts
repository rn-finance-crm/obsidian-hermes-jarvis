import type { TranscriptionEntry } from '../types';
import type { App } from 'obsidian';
import { listDirectory, readFile } from './vaultOperations';
import { getObsidianPlugin } from '../persistence/persistence';

/**
 * Confirmation gate for destructive tool calls.
 *
 * This is not an allowlist and it blocks nothing outright: every tool stays
 * available. It intercepts a short list of operations that can destroy work
 * irreversibly, and holds them until the user has said yes out loud.
 *
 * The enforcement is in code, not in the prompt. The plugin already ships an
 * `instruction` asking the model to confirm before a global replace, and that
 * is advisory — the model can skip it. Here the tool simply does not run until
 * an approving user utterance is found in the transcript, so the model cannot
 * approve on the user's behalf.
 */

type ToolArgs = Record<string, unknown>;

export interface GateHold {
  /** Read to the user verbatim, then wait. */
  spokenPrompt: string;
  /** Short label for the log and for the git snapshot message. */
  summary: string;
}

export type GateDecision =
  /** `approvedSummary` is set only when this call was held and then approved,
   *  which is the moment a snapshot is worth taking. */
  | { status: 'allow'; approvedSummary?: string }
  | { status: 'hold'; hold: GateHold }
  | { status: 'cancelled'; reason: string };

/**
 * Obsidian command ids that rewrite or destroy state. Matched as substrings of
 * the id, which covers third-party plugin commands too.
 */
const DANGEROUS_COMMAND_PATTERNS = [
  'delete', 'remove', 'trash', 'empty', 'clear', 'purge',
  'reset', 'overwrite', 'replace-all', 'uninstall', 'disable', 'revert',
];

/**
 * An overwrite that shrinks a file below this fraction of its current size is
 * treated as content loss rather than an edit. `update_file` replaces the whole
 * file and does not go through the trash, so there is nothing to restore from.
 */
const SHRINK_RATIO = 0.3;

/** A pending hold expires rather than waiting forever for an answer. */
const HOLD_TTL_MS = 3 * 60 * 1000;

/** Only an utterance made after the hold, and this recently, can approve it. */
const APPROVAL_WINDOW_MS = 3 * 60 * 1000;

const AFFIRMATIVE =
  /(^|[\s,.!?])(כן|מאשר|מאשרת|אישור|תבצע|בצע|תעשה|קדימה|יאללה|אוקיי|אוקי|בסדר|בטח|yes|yeah|yep|confirm|confirmed|approve|approved|proceed|go ahead|do it)([\s,.!?]|$)/i;

const NEGATIVE =
  /(^|[\s,.!?])(לא|בטל|תבטל|ביטול|עצור|תעצור|חכה|רגע|עזוב|no|nope|cancel|stop|abort|wait|don't|dont)([\s,.!?]|$)/i;

interface PendingHold {
  createdAt: number;
  hold: GateHold;
}

const pending = new Map<string, PendingHold>();

let readTranscripts: (() => TranscriptionEntry[]) | null = null;
let enabled = true;

/** Lets the user switch the gate off entirely; on by default. */
export const setGateEnabled = (value: boolean): void => {
  enabled = value;
  if (!value) pending.clear();
};

/**
 * App registers a reader here so the gate can check what the user actually
 * said. Follows the module-accessor pattern already used by vaultOperations.
 */
export const setTranscriptReader = (reader: () => TranscriptionEntry[]): void => {
  readTranscripts = reader;
};

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

/** Stable key so the second call must carry exactly the same arguments. */
const holdKey = (name: string, args: ToolArgs): string => {
  const stable = Object.keys(args)
    .filter((key) => key !== 'currentFolder')
    .sort()
    .map((key) => `${key}=${JSON.stringify(args[key])}`)
    .join('&');

  return `${name}::${stable}`;
};

/** Reads the human-readable name of an Obsidian command, if it can be found. */
const commandLabel = (commandId: string): string => {
  try {
    const app = (getObsidianPlugin() as unknown as { app?: App } | null)?.app;
    const commands = (app as unknown as {
      commands?: { commands?: Record<string, { name?: string }> };
    })?.commands?.commands;

    return commands?.[commandId]?.name || commandId;
  } catch {
    return commandId;
  }
};

/**
 * Counts the files a global replace would actually change.
 *
 * A regex carrying the `g` flag keeps `lastIndex` between `test` calls, so
 * reusing one across files would start each search mid-way through the previous
 * file and undercount. A fresh regex per file avoids that.
 */
const previewGlobalReplace = async (args: ToolArgs): Promise<GateHold> => {
  const pattern = getStringArg(args, 'pattern') ?? '';
  const replacement = getStringArg(args, 'replacement') ?? '';
  const flags = getStringArg(args, 'flags') || 'g';

  const files = listDirectory();
  const matched: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file);
      if (new RegExp(pattern, flags).test(content)) matched.push(file);
    } catch {
      // A file that cannot be read now cannot be rewritten either.
    }
  }

  const sample = matched.slice(0, 3).join(', ');
  const andMore = matched.length > 3 ? `, and ${matched.length - 3} more` : '';

  return {
    summary: `global replace across ${matched.length} file(s)`,
    spokenPrompt:
      matched.length === 0
        ? `A global search and replace of "${pattern}" matches no files, so nothing would change. Should I still run it?`
        : `This will replace "${pattern}" with "${replacement}" across ${matched.length} files in the vault, including ${sample}${andMore}. This rewrites all of them at once and cannot be undone from the trash. Do you want me to go ahead?`,
  };
};

const previewFileReplace = async (args: ToolArgs): Promise<GateHold> => {
  const filename = getStringArg(args, 'filename') ?? 'the file';
  const pattern = getStringArg(args, 'pattern') ?? '';
  const replacement = getStringArg(args, 'replacement') ?? '';
  const flags = getStringArg(args, 'flags') || 'g';

  let matches = 0;
  try {
    const content = await readFile(filename);
    matches = content.match(new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`))?.length ?? 0;
  } catch {
    matches = 0;
  }

  return {
    summary: `regex replace in ${filename} (${matches} match(es))`,
    spokenPrompt: `This will replace "${pattern}" with "${replacement}" in ${filename}, changing ${matches} match${matches === 1 ? '' : 'es'}. A regular expression edit rewrites the file and cannot be undone from the trash. Should I go ahead?`,
  };
};

const previewOverwrite = async (args: ToolArgs, existingLength: number): Promise<GateHold> => {
  const filename = getStringArg(args, 'filename') ?? 'the file';
  const nextLength = (getStringArg(args, 'content') ?? '').length;
  const percent = existingLength === 0 ? 0 : Math.round((nextLength / existingLength) * 100);

  return {
    summary: `overwrite ${filename} down to ${percent}% of its size`,
    spokenPrompt: `This will overwrite ${filename}, replacing its current content with something about ${percent} percent of its size — roughly ${existingLength - nextLength} characters would be removed. Overwriting does not go to the trash. Should I go ahead?`,
  };
};

const previewObsidianCommand = (args: ToolArgs): GateHold => {
  const commandId = getStringArg(args, 'commandId') ?? '';
  const label = commandLabel(commandId);

  return {
    summary: `Obsidian command ${commandId}`,
    spokenPrompt: `This will run the Obsidian command "${label}", which looks like it deletes or overwrites something. Should I run it?`,
  };
};

/**
 * Decides whether a call is critical, and if so describes exactly what it would
 * do. Returns null for everything that should run untouched.
 */
const describeIfCritical = async (name: string, args: ToolArgs): Promise<GateHold | null> => {
  if (name === 'search_and_replace_regex_global') return previewGlobalReplace(args);
  if (name === 'search_and_replace_regex_in_file') return previewFileReplace(args);

  if (name === 'run_obsidian_command') {
    const commandId = (getStringArg(args, 'commandId') ?? '').toLowerCase();
    const dangerous = DANGEROUS_COMMAND_PATTERNS.some((pattern) => commandId.includes(pattern));
    return dangerous ? previewObsidianCommand(args) : null;
  }

  if (name === 'update_file') {
    const filename = getStringArg(args, 'filename');
    if (!filename) return null;

    try {
      const existing = await readFile(filename);
      const nextLength = (getStringArg(args, 'content') ?? '').length;

      // Only a drastic shrink counts. Normal edits and growth run untouched.
      if (existing.length > 0 && nextLength < existing.length * SHRINK_RATIO) {
        return previewOverwrite(args, existing.length);
      }
    } catch {
      // No existing file means nothing to lose.
    }
  }

  return null;
};

type ApprovalCheck = 'approved' | 'refused' | 'waiting';

/** Looks for the user's answer in the transcript, after the hold was raised. */
const checkApproval = (hold: PendingHold): ApprovalCheck => {
  if (!readTranscripts) return 'waiting';

  const now = Date.now();
  const answers = readTranscripts().filter(
    (entry) =>
      entry.role === 'user' &&
      entry.isComplete &&
      entry.timestamp > hold.createdAt &&
      now - entry.timestamp < APPROVAL_WINDOW_MS,
  );

  for (const answer of answers) {
    // Checked first so a mixed answer resolves to the safe reading.
    if (NEGATIVE.test(answer.text)) return 'refused';
    if (AFFIRMATIVE.test(answer.text)) return 'approved';
  }

  return 'waiting';
};

const sweepExpired = (): void => {
  const now = Date.now();
  pending.forEach((hold, key) => {
    if (now - hold.createdAt > HOLD_TTL_MS) pending.delete(key);
  });
};

/**
 * Called from executeCommand immediately before a tool runs.
 *
 * `allow` means run it. `hold` means do not run it and read the prompt to the
 * user. `cancelled` means the user said no.
 */
export const evaluate = async (name: string, args: ToolArgs): Promise<GateDecision> => {
  if (!enabled) return { status: 'allow' };

  sweepExpired();

  const key = holdKey(name, args);
  const existing = pending.get(key);

  if (existing) {
    const approval = checkApproval(existing);

    if (approval === 'approved') {
      pending.delete(key);
      return { status: 'allow', approvedSummary: existing.hold.summary };
    }

    if (approval === 'refused') {
      pending.delete(key);
      return { status: 'cancelled', reason: 'The user declined.' };
    }

    // Still waiting: repeat the original request rather than letting it through.
    return { status: 'hold', hold: existing.hold };
  }

  const critical = await describeIfCritical(name, args);
  if (!critical) return { status: 'allow' };

  pending.set(key, { createdAt: Date.now(), hold: critical });
  return { status: 'hold', hold: critical };
};

/** Exposed for tests. */
export const __testing = { AFFIRMATIVE, NEGATIVE, DANGEROUS_COMMAND_PATTERNS, SHRINK_RATIO, holdKey };
