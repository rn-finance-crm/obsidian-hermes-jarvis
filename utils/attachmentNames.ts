/**
 * Repairs attachment names written by the mail importer.
 *
 * Three faults show up on imported attachments, and each one stops a file
 * being usable once it leaves the vault:
 *
 *   1. Hebrew names stored as their UTF-8 bytes shown as single characters,
 *      so "דיסקונט" sits on disk as a run of Latin-1 punctuation.
 *   2. Some of those are damaged beyond recovery — the importer replaced the
 *      second byte of a letter with a space, destroying it.
 *   3. Some attachments were saved with no extension at all, so Windows has
 *      nothing to open them with.
 *
 * Everything here is recovered from the data itself: the name's own bytes, the
 * file's leading bytes, and the folder name the importer wrote from the email
 * subject. Nothing is guessed, and anything that does not decode cleanly is
 * left exactly as it is.
 */

/**
 * Windows-1252 differs from Latin-1 only in 0x80-0x9F, where it maps
 * punctuation instead of control codes. Hebrew's second UTF-8 byte lands in
 * that range, so a name mangled through cp1252 needs these mapped back to
 * bytes before it can be decoded.
 */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const HEBREW = /[֐-׿]/;

/** C1 controls and Latin-1 supplement: the signature of raw bytes shown as text. */
const MANGLED = /[\u0080-\u00ff]/;

const RESERVED_BY_WINDOWS = new Set([...String.raw`<>:"/\|?*`]);

/**
 * Control characters are tested by code point rather than by a pattern: a
 * regex containing literal control characters is a lint error in its own
 * right, and this reads more plainly anyway.
 */
const isUnsafeInName = (character: string): boolean => {
  if (RESERVED_BY_WINDOWS.has(character)) return true;
  const code = character.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/**
 * Recovers the original name, or returns the input untouched when it cannot be
 * recovered. Deliberately conservative: it only accepts a decode that turns a
 * name with no Hebrew into one that has some, and refuses anything that is not
 * valid UTF-8 underneath rather than emitting replacement characters.
 */
export const decodeMojibake = (name: string): string => {
  if (HEBREW.test(name)) return name;

  const bytes = new Uint8Array(name.length);

  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    const mapped = CP1252_HIGH[code];

    if (mapped !== undefined) bytes[i] = mapped;
    else if (code <= 0xff) bytes[i] = code;
    else return name; // Not a byte this encoding could have produced.
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return HEBREW.test(decoded) ? decoded : name;
  } catch {
    return name; // A byte was destroyed; the name cannot be rebuilt.
  }
};

/**
 * True when a name is clearly raw bytes but cannot be decoded — meaning
 * information was lost and a different source is needed.
 */
export const isUnrecoverable = (name: string): boolean =>
  MANGLED.test(name) && decodeMojibake(name) === name;

const startsWith = (head: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, i) => head[i] === byte);

const asText = (head: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: false }).decode(head.slice(0, 64));

/**
 * Identifies a file from its leading bytes. Returns null when the bytes are
 * ambiguous — legacy and zip-based Office each share one signature across
 * several formats, and a wrong extension is worse than none.
 */
export const sniffExtension = (head: Uint8Array): string | null => {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'gif';

  const text = asText(head);
  if (text.startsWith('BEGIN:VCALENDAR')) return 'ics';
  if (/^\s*<(!doctype html|html)/i.test(text)) return 'html';

  return null;
};

/** Strips a name down to something Windows accepts and a person can read. */
const sanitise = (text: string): string =>
  [...text].filter((c) => !isUnsafeInName(c)).join('').replace(/\s+/g, ' ').trim().slice(0, 90);

export interface RepairOptions {
  /** First bytes of the file, used to add a missing extension. */
  head?: Uint8Array;
  /**
   * Name of the containing folder. The importer builds it from the email
   * subject and leaves it in correct Hebrew, which makes it the best source
   * when the filename's own bytes are damaged.
   */
  folderName?: string;
  /** Distinguishes several attachments recovered from the same folder. */
  index?: number;
}

/**
 * Best available name for one file: decodes the encoding when it can, falls
 * back to the folder name when the filename is damaged, and adds an extension
 * when the file has none and its type is unambiguous.
 */
export const repairFileName = (name: string, options: RepairOptions = {}): string => {
  const { head, folderName, index } = options;

  let base = decodeMojibake(name);

  if (isUnrecoverable(base) && folderName) {
    const suffix = index && index > 1 ? ` (${index})` : '';
    base = `${sanitise(folderName)}${suffix}`;
  }

  const hasExtension = /\.[A-Za-z0-9]{1,6}$/.test(base);
  if (hasExtension || !head) return base;

  const sniffed = sniffExtension(head);
  return sniffed ? `${base}.${sniffed}` : base;
};

/**
 * Picks a name that is not taken, so an export can never overwrite:
 * "contract.pdf" becomes "contract (2).pdf".
 */
export const uniqueName = (name: string, exists: (candidate: string) => boolean): string => {
  if (!exists(name)) return name;

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }

  return `${stem} (${Date.now()})${ext}`;
};
