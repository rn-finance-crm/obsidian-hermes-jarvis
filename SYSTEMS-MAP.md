# Systems map — J.A.R.V.I.S / Hermes

How the assistant is wired to the vault, what it can do, and what stops it.

---

## The chain

```
you speak
   ↓  microphone, 16 kHz
Hermes panel                      React app inside an Obsidian workspace leaf
   ↕  live audio
Gemini Live                       gemini-2.5-flash-native-audio-preview-12-2025
   ↓  tool call
executeCommand                    services/commands.ts — the single dispatcher
   ↓
safety gate                       services/safetyGate.ts — holds destructive calls
   ↓
tool                              one of 29 in tools/
   ↓
Obsidian vault API                app.vault, app.fileManager, app.metadataCache
   ↓
your notes
```

Model audio comes back at 24 kHz. Typed messages use `gemini-2.0-flash` through
`services/textInterface.ts` and travel the same dispatcher, so everything below
applies to both.

## How it reaches the vault

Not through the disk. Every read and write goes through Obsidian's own API —
`app.vault.getMarkdownFiles`, `app.vault.read`, `app.vault.modify`,
`app.vault.create`, `app.fileManager.renameFile`, `app.metadataCache.getFileCache`
— wrapped in `services/vaultOperations.ts`. That is why links, tags and metadata
are visible to it the way Obsidian sees them, and why its writes behave like
edits made in the app.

## What leaves the machine

| Stays local | Sent to the cloud |
| --- | --- |
| Every file in the vault | Your speech audio |
| Tool execution | The content of files it reads during a conversation |
| API keys (`.obsidian/plugins/hermes-voice-assistant/data.json`) | The system instructions at session start |

Cloud services: **Gemini Live** for the voice session, **Gemini 2.0 Flash** for
typed chat, **Serper** for image search.

## What it can do — 29 tools

- **Files** — read, create, overwrite, line-level edit, delete to trash, restore
  from trash, rename, move.
- **Folders** — create, map the hierarchy, list files with pagination.
- **Search** — keyword, regex, and find-and-replace both in one file and across
  every file at once.
- **Internet** — web search, image search, download an image, generate an image.
- **Obsidian control** — run any command from the palette, list available
  commands, open a folder in the file manager, report the active file.
- **Conversation** — detect a topic change, archive the conversation as markdown
  in `chat-history`, end the session.

Conversations become part of the vault: each is written out as a note with an
LLM-written title, tags and summary, so they show up in the graph like anything
else.

---

## Safety layer

The assistant keeps full freedom on everything above. A short list of actions
that can destroy work irreversibly is held until you approve it out loud.

### What is gated

| Tool | When | Why |
| --- | --- | --- |
| `search_and_replace_regex_global` | every call | rewrites matching files across the whole vault at once |
| `search_and_replace_regex_in_file` | every call | a wrong regex can empty a file, and it does not go to the trash |
| `update_file` | new content is under 30% of the current size | replaces the whole file, with nothing in the trash to restore |
| `run_obsidian_command` | command id contains `delete`, `remove`, `trash`, `empty`, `clear`, `purge`, `reset`, `overwrite`, `replace-all`, `uninstall`, `disable`, `revert` | can reach any command, including plugins' |

**Deliberately not gated**, because they were checked and found safe:
`create_file` fails if the file exists and cannot overwrite; `delete_file` moves
to a trash folder and is restorable; `move_file` and `rename_file` go through
`app.fileManager.renameFile`, which refuses to clobber a destination. Reading,
searching, listing, web access and image tools are untouched.

> Note the tool names above. Three tools are registered under names that differ
> from their filenames — `search_and_replace_regex_global`,
> `search_and_replace_regex_in_file` and `internet_search`. A gate written
> against the filenames would never fire.

### How approval works

The gate sits in `executeCommand` **before** `tool.execute`, so when it asks you
nothing has happened yet.

1. **First call.** The gate measures what the call would actually do — for a
   global replace it scans the vault and counts the real number of matching
   files — stores a pending hold, and returns `confirmation_required` with the
   exact sentence to read to you. **The tool does not run.**
2. **You answer.** The model reads the sentence and waits.
3. **Second call.** With identical arguments, the gate looks in the live
   transcript for something *you* said after the hold was raised, and only lets
   the tool run if it matches an approval.

Approval is enforced in code, not by asking the model nicely. The plugin already
shipped an advisory instruction to confirm before a global replace, and advisory
instructions can be skipped. Here, with no approving utterance from you in the
transcript, the tool simply does not run — the model cannot approve on your
behalf.

- Approval: `כן`, `מאשר`, `אישור`, `תבצע`, `בצע`, `קדימה`, `יאללה`, `בסדר`,
  `אוקיי`, `yes`, `confirm`, `approve`, `proceed`, `go ahead`, `do it`.
- Refusal: `לא`, `בטל`, `עצור`, `חכה`, `רגע`, `no`, `cancel`, `stop`, `abort`,
  `wait`. A refusal anywhere in the answer wins over an approval.
- Anything else — silence, a question, a change of subject — is **not** approval.
  The hold stays, expires after three minutes, and nothing runs.
- Only an utterance made *after* the hold and within three minutes counts, so an
  old "yes" from earlier in the conversation cannot approve anything.

Turn the whole thing off under **Settings → Hermes → Safety → Confirm
destructive actions**.

### Vault snapshots — undo

The vault is a local git repository. A commit is taken immediately before an
approved destructive action runs — never before ordinary reads or edits.

- A local git identity is set on the repository, because commits fail without
  one and this machine has no global identity configured.
- Desktop only — it shells out to `git`. On mobile it does nothing and the
  confirmation gate still works.

**Restoring:**

```bash
git -C "<vault>" log --oneline          # find the point before the change
git -C "<vault>" restore --source=<sha> -- "path/to/note.md"   # one file
git -C "<vault>" restore --source=<sha> -- .                   # everything
```

Snapshot messages read `Before <what was approved>`, so the right commit is easy
to spot.

### Replication — surviving the machine

Git history lives on this machine only, so it does not help if the machine
does. Syncthing mirrors the vault to a paired phone over a direct encrypted
connection: no account, no server holding a copy, nothing uploaded to a
company. That matters here because the vault holds real client material.

**Syncthing is not a backup — it is a mirror.** A deletion propagates within
seconds. Staggered file versioning (30 days) is enabled so a deletion arriving
from another device is still recoverable, but the protection against a mistake
made *here* is the git history, not the mirror.

| | protects against | does not protect against |
| --- | --- | --- |
| git history | a destructive action on this machine | losing the machine |
| Syncthing | losing the machine | a deletion — it copies it |

- Desktop device ID: `NMCZNQ6-36R6HZ5-UPVMHBD-GGN43SE-LFGMMDF-HYCQGJH-RZR2DWK-ICSZ6Q7`
- Folder id `jarvis-vault`, web UI at <http://127.0.0.1:8384>
- Starts at logon via the scheduled task **Syncthing (Jarvis vault)**
- Android: the official app was discontinued in 2024; the maintained
  continuation is **Syncthing-Fork**, on F-Droid and Play Store. It has changed
  maintainers twice, which is worth knowing before relying on it long term.

### What is excluded, and why

Two separate exclusion lists, because they answer different questions.
`.gitignore` decides what enters the history; `.stignore` decides what leaves
the machine.

| Excluded | From | Why |
| --- | --- | --- |
| `.obsidian/` | git | contains plugin `data.json` files holding live API keys |
| `.obsidian/plugins/*/data.json` | sync | same keys; they should exist in one place only |
| `.env*` (any depth, any tail) | both | the vault held `.env_v1.md` — an env file with a markdown tail, which `.env` and `*.env` both miss |
| `.obsidian/workspace*.json` | sync | per-device UI state; syncing it produces constant conflicts |
| `.git` | sync | thousands of small objects, slow on Android, and a copy taken mid-commit is inconsistent |
| `.trash/`, OS clutter | both | noise |

Client material is **not** excluded from either. Nothing leaves the machine
except to the paired phone, where the same documents already arrive by
WhatsApp and email.

### Getting a file out of the vault

Reading a file only shows its contents. Two tools make one usable:

| Tool | What it does |
| --- | --- |
| `export_file` | Copies it to the Desktop or Downloads so it can be attached, printed or sent |
| `open_file` | Opens it in whatever application the system uses for that type |

Both work for any file type — PDF, Word, Excel, images.

`export_file` is the only place the assistant writes outside the vault, and the
git history does not reach out there, so it is fenced in code:

- **destination is a closed list** — Desktop or Downloads, nothing else
- **overwriting is impossible** — an existing file gets a numbered sibling
- **one direction only** — it reads from the vault; there is no path back in
- **desktop only** — it reports plainly rather than failing on mobile

It is deliberately not behind the confirmation gate: it only ever creates a new
file and cannot destroy anything, so stopping to ask on every export would
annoy without protecting.

### Attachment names

The mail importer damaged the names of the files it saved, in three ways, and
`utils/attachmentNames.ts` repairs all three from the data itself:

- **Hebrew stored as raw bytes** — decoded back, but only when the result is
  valid UTF-8 containing Hebrew. Anything else is left alone rather than
  guessed at.
- **Names with a byte destroyed** — the importer replaced the second byte of a
  letter with a space, which cannot be undone. These fall back to the folder
  name, which the importer writes from the email subject and leaves intact.
- **No extension at all** — identified from the file's leading bytes. Legacy
  and zip-based Office share a signature across several formats, so those stay
  as they are: a wrong extension is worse than none.

The same code runs inside `export_file`, so a file exported today lands with a
readable name even if the copy in the vault was never repaired.

To repair the vault copies after a future import:

```bash
node scripts/repair-attachment-names.mjs            # report only
node scripts/repair-attachment-names.mjs --apply    # act
```

### Checking that a new sensitive file has not slipped through

An ignore list is a guess about the future. This checks the outcome instead —
it reads what git is actually tracking and flags credential-shaped values and
risky filenames:

```bash
node scripts/scan-vault-secrets.mjs "C:/Users/User/Desktop/Obsidian/jarvis"
```

Run it after installing a plugin, or whenever the vault starts holding a new
kind of file. Two hits are expected and harmless: Google Maps API keys inside
marketing emails Google itself sent, in `10-Mailbox/Gmail/Inbox/`. They are not
this vault's credentials.

If it ever flags a real key that is already committed, adding it to
`.gitignore` is not enough — **rotate the key**, because it remains in history.

---

## Where things live

| Path | Role |
| --- | --- |
| `services/commands.ts` | tool registry and the single dispatcher |
| `services/safetyGate.ts` | what counts as destructive, and the approval check |
| `services/vaultGit.ts` | repository setup and snapshots |
| `services/vaultOperations.ts` | every vault read and write |
| `services/voiceInterface.ts` | Gemini Live session, audio, tool-call handling |
| `utils/assistantIdentity.ts` | the assistant's name, injected per session |
| `utils/safetyInstruction.ts` | how the model should behave when a call is held |
| `tools/` | the 29 tools, one per file |
| `components/HermesHUD.tsx` | the status ring |
