# Memory Tool Implementation Plan

Implement a persistent memory system where the AI can store user-specified future behaviors and load them with the initial context prompt.

---

## Overview

When the user tells Hermes a specific future behavior (e.g., "always format dates as YYYY-MM-DD"), the AI creates a short summary and stores it in a `memory/` subfolder inside the chat history folder. These memories are loaded with the system prompt at session start.

---

## Components to Create/Modify

### 1. New Tool: `tools/save_memory.ts`
- **Declaration**: `save_memory` tool with parameters:
  - `title`: Short descriptive title (used as filename slug)
  - `content`: The behavior/preference to remember
- **Execute logic**:
  1. List existing memory files in `{chatHistoryFolder}/memory/`
  2. Search for a memory with similar title/topic
  3. If found → **update** existing file
  4. If not found → **create** new file
- **Instruction**: Guide AI on when to use (user states preferences, behaviors, rules)

### 2. New Tool: `tools/delete_memory.ts`
- **Declaration**: `delete_memory` tool with parameters:
  - `title`: Title/filename of memory to delete
- **Execute**: Removes the `.md` file from `{chatHistoryFolder}/memory/`
- **Instruction**: Guide AI on when to use (user wants to forget a preference)

### 3. Memory Loading in System Prompt
Create `utils/loadMemories.ts`:
- Read all `.md` files from `{chatHistoryFolder}/memory/`
- Concatenate their contents
- Inject into system instruction (similar to `customContext`)

### 4. Interface Updates
Modify `services/voiceInterface.ts` and `services/textInterface.ts`:
- Load memories at session initialization
- Append to `systemInstruction` alongside `customContext`

### 5. Storage Location
- Always uses `{chatHistoryFolder}/memory/` (no settings needed)
- `chatHistoryFolder` already exists in `AppSettings`

---

## Implementation Steps

| # | Task | Files |
|---|------|-------|
| 1 | Create `tools/save_memory.ts` with save/update logic | `tools/save_memory.ts` |
| 2 | Create `tools/delete_memory.ts` | `tools/delete_memory.ts` |
| 3 | Register both tools in `services/commands.ts` | `services/commands.ts` |
| 4 | Add instructions to `utils/defaultPrompt.ts` | `utils/defaultPrompt.ts` |
| 5 | Create `utils/loadMemories.ts` to read memory files | `utils/loadMemories.ts` |
| 6 | Update `voiceInterface.ts` to load memories into system prompt | `services/voiceInterface.ts` |
| 7 | Update `textInterface.ts` to load memories into system prompt | `services/textInterface.ts` |
| 8 | Test: save, update, delete memories; verify loading | Manual test |

---

## File Format

Memory files stored as:
```
{chatHistoryFolder}/memory/YYYY-MM-DD-{slug}.md
```

Content format:
```markdown
---
created: 2026-02-02T10:55:00Z
---
{content}
```

---

## System Prompt Integration

Memories will be injected as:
```
USER_MEMORIES:
- [title]: [content]
- [title]: [content]
...
```

Placed after `CURRENT_CONTEXT` and before `customContext` in the system instruction.

---

## Edge Cases

- **Empty memory folder**: No-op, no memories section in prompt
- **Large number of memories**: Consider token limits; may need truncation or summarization in future
- **Standalone mode**: Use localStorage-based memory storage via persistence layer
