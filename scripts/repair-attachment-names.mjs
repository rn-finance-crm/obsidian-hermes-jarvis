#!/usr/bin/env node

/**
 * One-off repair of attachment names the mail importer damaged.
 *
 * Three faults, all fixed from the data itself rather than from guesswork:
 *   - names stored as raw UTF-8 bytes shown as Latin-1 punctuation
 *   - names where a byte was destroyed and cannot be decoded, which fall back
 *     to the containing folder's name (the importer writes it from the email
 *     subject and leaves it in correct Hebrew)
 *   - files saved with no extension, identified by their leading bytes
 *
 * Report-only unless --apply is passed. Every rename is verified afterwards.
 *
 *   node scripts/repair-attachment-names.mjs [--apply] [--vault <path>]
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const vaultArg = args.indexOf('--vault');
const VAULT = vaultArg !== -1 ? args[vaultArg + 1] : 'C:/Users/User/Desktop/Obsidian/jarvis';

const ROOT = join(VAULT, 'Emails', 'attachments');

/**
 * The naming logic lives in TypeScript, shared with the export_file tool.
 * Rather than duplicate it here, bundle it on the fly with the esbuild that
 * is already a dependency, so there is exactly one source of truth.
 */
const loadNameUtils = async () => {
  const { build } = await import('esbuild');
  const { tmpdir } = await import('node:os');
  const outfile = join(tmpdir(), `hermes-names-${process.pid}.mjs`);

  await build({
    entryPoints: [new URL('../utils/attachmentNames.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true,
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });

  return import(`file:///${outfile.replace(/\\/g, '/')}`);
};

const { repairFileName, uniqueName } = await loadNameUtils();

const headOf = (file) => {
  const fd = openSync(file, 'r');
  const buffer = new Uint8Array(64);
  readSync(fd, buffer, 0, 64, 0);
  closeSync(fd);
  return buffer;
};

/** The folder name carries the email subject; the timestamp prefix is noise. */
const subjectOf = (folder) => folder.replace(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} /, '');

if (!existsSync(ROOT)) {
  console.log('no attachments folder at', ROOT);
  process.exit(0);
}

const planned = [];
let unchanged = 0;

for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;

  const dirPath = join(ROOT, dir.name);
  const files = readdirSync(dirPath, { withFileTypes: true }).filter((f) => f.isFile());
  const claimed = new Set();

  files.forEach((file, index) => {
    const desired = repairFileName(file.name, {
      head: headOf(join(dirPath, file.name)),
      folderName: subjectOf(dir.name),
      index: index + 1,
    });

    // Two attachments in one folder can repair to the same name.
    const finalName = uniqueName(desired, (c) => claimed.has(c) || (c !== file.name && existsSync(join(dirPath, c))));
    claimed.add(finalName);

    if (finalName === file.name) unchanged++;
    else planned.push({ dir: dir.name, from: file.name, to: finalName, dirPath });
  });
}

console.log(`attachments      : ${planned.length + unchanged}`);
console.log(`to be renamed    : ${planned.length}`);
console.log(`left as they are : ${unchanged}`);

if (!apply) {
  console.log('\n--- report only, nothing changed. Pass --apply to act. ---\n');
  planned.forEach((p, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${p.from.length > 42 ? `${p.from.slice(0, 40)}…` : p.from}`);
    console.log(`    → ${p.to}`);
  });
  process.exit(0);
}

let renamed = 0;
const failures = [];

for (const p of planned) {
  try {
    renameSync(join(p.dirPath, p.from), join(p.dirPath, p.to));
    // Verify from disk rather than trusting the call.
    if (existsSync(join(p.dirPath, p.to)) && !existsSync(join(p.dirPath, p.from))) renamed++;
    else failures.push(p.to);
  } catch (error) {
    failures.push(`${basename(p.from)}: ${error.message}`);
  }
}

console.log(`\nrenamed : ${renamed} / ${planned.length}`);
if (failures.length) {
  console.log('failures:');
  failures.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('All renames verified on disk.');
