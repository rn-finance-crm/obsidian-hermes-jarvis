#!/usr/bin/env node

/**
 * Keeps the IMAP-imported mail folder sane.
 *
 * The importer (imap-mail-importer) names each note after the email subject and
 * offers no filtering or length limit of its own, which causes two problems:
 *
 *   1. Long Hebrew subjects produce filenames over 255 bytes in UTF-8. Android
 *      cannot create those, so Syncthing fails on them permanently.
 *   2. Marketing mail floods the vault and is the main source of problem 1.
 *
 * Long names are shortened rather than deleted — nothing is lost, and the sync
 * failure disappears. Marketing mail is moved to the vault trash, which is
 * excluded from both git and Syncthing and can be emptied or restored by hand.
 *
 * Runs in report-only mode unless --apply is passed.
 *
 *   node scripts/tidy-imported-mail.mjs [--apply] [--vault <path>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const vaultArg = args.indexOf('--vault');
const VAULT = vaultArg !== -1 ? args[vaultArg + 1] : 'C:/Users/User/Desktop/Obsidian/jarvis';

const MAIL_DIR = join(VAULT, 'Emails');
const TRASH = join(VAULT, '.trash');

/** Android and most filesystems cap a single name at 255 bytes, not characters. */
const NAME_LIMIT = 255;

/**
 * Israeli law requires commercial mail to carry "פרסומת" in the subject, which
 * makes the subject the most reliable signal available here. The importer does
 * not keep the List-Unsubscribe header, so the body's unsubscribe wording and
 * the sender address are used as corroboration.
 */
const SUBJECT_MARKERS = [/פרסומת/, /\badvertisement\b/i];

const BODY_MARKERS = [
  /להסרה מרשימת התפוצה/,
  /להסרה מהדיוור/,
  /הסרה מרשימת/,
  /לחץ(?:י)? כאן להסרה/,
  /\bunsubscribe\b/i,
  /\bopt[- ]out\b/i,
];

const SENDER_MARKERS = [
  /no[-_.]?reply@/i,
  /newsletter@/i,
  /marketing@/i,
  /mailer@/i,
  /campaign/i,
  /promo/i,
];

const utf8 = (s) => Buffer.byteLength(s, 'utf8');

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split('\n')) {
    const eq = line.indexOf(':');
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
};

/** Shortens a name to fit the byte limit while keeping the date prefix and .md. */
const shorten = (name) => {
  const stem = name.replace(/\.md$/, '');
  const chars = [...stem];
  let cut = chars.length;

  // "…" plus ".md" must also fit, so trim against the budget including them.
  while (cut > 0 && utf8(chars.slice(0, cut).join('') + '….md') > NAME_LIMIT) cut--;

  return chars.slice(0, cut).join('').trimEnd() + '….md';
};

const classify = (file) => {
  const full = join(MAIL_DIR, file);
  let text = '';
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    return null;
  }

  const fm = frontmatter(text);
  const subject = fm.subject || '';
  const from = fm.from || '';

  const subjectHit = SUBJECT_MARKERS.some((re) => re.test(subject));
  const bodyHit = BODY_MARKERS.some((re) => re.test(text));
  const senderHit = SENDER_MARKERS.some((re) => re.test(from));

  return {
    file,
    bytes: utf8(file),
    tooLong: utf8(file) > NAME_LIMIT,
    subject,
    /**
     * Only the legally required marker moves a file. The unsubscribe-plus-bulk-
     * sender combination was tried and rejected: on this vault it also caught a
     * sign-in security alert and a supplier's price-change notice. It is kept
     * purely as a list to review by hand.
     */
    promotional: subjectHit,
    suspected: !subjectHit && bodyHit && senderHit,
    reason: subjectHit ? 'subject marked פרסומת' : '',
  };
};

if (!existsSync(MAIL_DIR)) {
  console.log('no Emails folder at', MAIL_DIR);
  process.exit(0);
}

const files = readdirSync(MAIL_DIR).filter((f) => f.endsWith('.md'));
const results = files.map(classify).filter(Boolean);

const tooLong = results.filter((r) => r.tooLong);
const promotional = results.filter((r) => r.promotional);
const suspected = results.filter((r) => r.suspected);

console.log(`mail notes            : ${results.length}`);
console.log(`over ${NAME_LIMIT} bytes        : ${tooLong.length}  → shortened, never deleted`);
console.log(`marked פרסומת         : ${promotional.length}  → moved to .trash`);
console.log(`possibly bulk         : ${suspected.length}  → left alone, listed for you to judge`);

if (!apply) {
  console.log('\n--- report only, nothing changed. Pass --apply to act. ---\n');
  console.log('would be moved to .trash, first 10:');
  promotional.slice(0, 10).forEach((r) => console.log(`  ${r.subject.slice(0, 72)}`));

  if (tooLong.length) {
    console.log('\nwould be shortened:');
    tooLong.slice(0, 5).forEach((r) => {
      console.log(`  ${r.bytes}B  ${r.file.slice(0, 58)}…`);
      console.log(`   →      ${shorten(r.file).slice(0, 58)}…  (${utf8(shorten(r.file))}B)`);
    });
  }

  if (suspected.length) {
    console.log('\nleft in place — bulk-looking but not legally marked, decide yourself:');
    suspected.slice(0, 8).forEach((r) => console.log(`  ${r.subject.slice(0, 72)}`));
  }
  process.exit(0);
}

mkdirSync(TRASH, { recursive: true });

let trashed = 0;
let renamed = 0;

// Marketing goes first, so a note that is both does not get renamed pointlessly.
for (const r of promotional) {
  try {
    renameSync(join(MAIL_DIR, r.file), join(TRASH, r.file));
    trashed++;
  } catch (error) {
    console.log('  could not trash:', r.file.slice(0, 50), error.message);
  }
}

for (const r of tooLong) {
  if (r.promotional) continue;
  const target = join(MAIL_DIR, shorten(r.file));
  try {
    if (!existsSync(target)) {
      renameSync(join(MAIL_DIR, r.file), target);
      renamed++;
    }
  } catch (error) {
    console.log('  could not shorten:', r.file.slice(0, 50), error.message);
  }
}

console.log(`\nmoved to .trash : ${trashed}`);
console.log(`shortened       : ${renamed}`);
console.log(`remaining notes : ${readdirSync(MAIL_DIR).filter((f) => f.endsWith('.md')).length}`);
