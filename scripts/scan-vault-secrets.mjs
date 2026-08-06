#!/usr/bin/env node

/**
 * Audits what the vault repository would actually commit.
 *
 * The .gitignore is a guess about what will be sensitive. This checks the
 * result instead: it looks at the files git is really tracking and flags
 * anything that carries a credential-shaped value or an env-file name.
 *
 * Run it after adding a plugin, or any time the vault gains a new kind of
 * file:  node scripts/scan-vault-secrets.mjs "<path to vault>"
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.argv[2] || 'C:/Users/User/Desktop/Obsidian/jarvis';

/**
 * Long, high-entropy credentials. Lengths are set above what the tracking
 * links in imported marketing email happen to produce, which otherwise
 * generate a steady stream of false positives.
 */
const CREDENTIAL_PATTERNS = [
  { label: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { label: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{40,}/ },
  { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36}/ },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{30,}/ },
];

/** Filenames that should never be tracked whatever they contain. */
const RISKY_NAMES = [/(^|\/)\.env/i, /data\.json$/i, /secrets?\./i, /credentials?\./i, /\.(pem|p12|pfx|key)$/i];

const tracked = execFileSync('git', ['-C', vault, 'ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 64,
})
  .split('\0')
  .filter(Boolean);

console.log(`tracked files: ${tracked.length}\n`);

const nameHits = [];
const contentHits = [];

for (const rel of tracked) {
  if (RISKY_NAMES.some((re) => re.test(rel))) nameHits.push(rel);

  let text;
  try {
    text = readFileSync(join(vault, rel), 'utf8');
  } catch {
    continue; // binary or unreadable; nothing to match against
  }

  for (const { label, re } of CREDENTIAL_PATTERNS) {
    if (re.test(text)) contentHits.push({ rel, label });
  }
}

if (nameHits.length) {
  console.log('FILES WITH A RISKY NAME THAT ARE BEING TRACKED:');
  nameHits.forEach((f) => console.log('  -', f));
  console.log();
}

if (contentHits.length) {
  console.log('TRACKED FILES CONTAINING A CREDENTIAL-SHAPED VALUE:');
  contentHits.forEach((h) => console.log(`  - [${h.label}] ${h.rel}`));
  console.log();
}

if (!nameHits.length && !contentHits.length) {
  console.log('Clean: nothing tracked looks like a secret.');
  process.exit(0);
}

console.log('Review each hit. To stop tracking one:');
console.log('  git -C "<vault>" rm --cached "<file>"   then add it to .gitignore');
console.log('\nIf a real credential was already committed, rotate it — removing');
console.log('the file now does not remove it from history.');
process.exit(1);
