# Memory Tool Implementation Plan

Implement a persistent memory system where the AI can store user-specified future behaviors and load them with the initial context prompt.

---

## Overview

When the user tells Hermes a specific future behavior (e.g., "always format dates as YYYY-MM-DD"), the AI creates a short summary and stores it in a `memory/` subfolder inside the chat history folder. These memories are loaded with the system prompt at session start.

---

## Components to Create/Modify

### 1. New Tool: `tools/memory.ts`
- **Declaration**: `save_memory` tool with parameters:
  - `title`: Short descriptive title
  - `content`: The behavior/preference to remember
- **Execute**: Creates a `.md` file in `{chatHistoryFolder}/memory/`
- **Instruction**: Guide AI on when to use (user states preferences, behaviors, rules)

### 2. Memory Loading in System Prompt
Modify `utils/defaultPrompt.ts` or create `utils/loadMemories.ts`:
- Read all `.md` files from `{chatHistoryFolder}/memory/`
- Concatenate their contents
- Inject into system instruction (similar to `customContext`)

### 3. Interface Updates
Modify `services/voiceInterface.ts` and `services/textInterface.ts`:
- Load memories at session initialization
- Append to `systemInstruction` alongside `customContext`

### 4. Settings Integration
- Use `chatHistoryFolder` from `AppSettings` (already exists in `types.ts`)
- Memory subfolder path: `{chatHistoryFolder}/memory/`

---

## Implementation Steps

| # | Task | Files |
|---|------|-------|
| 1 | Create `tools/memory.ts` with `save_memory` declaration and execute | `tools/memory.ts` |
| 2 | Register tool in `services/commands.ts` | `services/commands.ts` |
| 3 | Add instruction to `utils/defaultPrompt.ts` | `utils/defaultPrompt.ts` |
| 4 | Create `utils/loadMemories.ts` to read memory files | `utils/loadMemories.ts` |
| 5 | Update `voiceInterface.ts` to load memories into system prompt | `services/voiceInterface.ts` |
| 6 | Update `textInterface.ts` to load memories into system prompt | `services/textInterface.ts` |
| 7 | Test: save a memory, restart session, verify it's in context | Manual test |

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
