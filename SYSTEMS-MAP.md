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

### Vault snapshots

With snapshots on, the vault is a local git repository and a commit is taken
immediately before an approved destructive action runs — never before ordinary
reads or edits.

- Created on first use: `git init`, a `.gitignore`, and an initial commit.
- **`.obsidian/` is excluded in full.** The plugin's `data.json` inside it holds
  the Gemini and Serper API keys, and a key committed once stays in history.
  `.trash/` is excluded too. All vault content is kept.
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
