# search_vault: BM25 + Tag Search Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `search_keyword` with a unified `search_vault` tool that uses MiniSearch BM25 for ranked full-text search, integrates tag/metadata filtering via Obsidian's metadataCache, and retains semantic search via Smart Connections.

**Architecture:** New `services/searchIndex.ts` manages a MiniSearch BM25 index (lazy-init on first search, incremental updates via vault events). New `services/tagSearch.ts` queries Obsidian's in-memory metadataCache for tag filtering. The tool `search_vault` runs BM25 + tag filter + semantic search in parallel, returning ranked results to Gemini and UI.

**Tech Stack:** TypeScript, MiniSearch (7 kB), Obsidian MetadataCache API, React

---

### Task 1: Install MiniSearch dependency

```bash
npm install minisearch
```

Commit: "chore: add minisearch dependency"

---

### Task 2: Add types

In `types.ts`:

Add `score?: number` to `SearchResult` interface.

Add new interface:
```ts
export interface TagSearchResult {
  filename: string;
  tags: string[];
}
```

Add `tagResults?: TagSearchResult[]` to `ToolData`.

Commit: "feat: add score to SearchResult, add TagSearchResult type"

---

### Task 3: Create `services/searchIndex.ts`

MiniSearch BM25 index service:
- `initSearchIndex()`: builds index from all vault markdown files using `vault.cachedRead()`
- `searchIndex(query, limit)`: returns ranked results with scores
- `getSearchIndex()`: lazy-init getter
- Register vault events for incremental updates (add/remove/modify documents)
- Fields: `id` (path), `title` (basename), `content` (file text)
- Options: title boost 2x, fuzzy 0.2, prefix true

Commit: "feat: add MiniSearch BM25 search index service"

---

### Task 4: Create `services/tagSearch.ts`

Tag search service using Obsidian metadataCache:
- `searchByTags(tags: string[])`: returns files matching ALL given tags
- Uses `getAllTags()` from Obsidian, supports nested tag prefix matching
- Zero disk I/O — reads from metadataCache only

Commit: "feat: add tag search service via metadataCache"

---

### Task 5: Create `tools/search_vault.ts`, delete `tools/search_keyword.ts`

New unified search tool:
- Name: `search_vault`
- Params: `keyword` (required), `tags` (optional string array), `semantic` (optional boolean, default true)
- Runs BM25 search + tag filter + semantic search in parallel
- If tags provided, BM25 results filtered to only files matching those tags
- Returns ranked keyword results, tag info, and semantic results

Commit: "feat: add search_vault tool replacing search_keyword"

---

### Task 6: Update all references from `search_keyword` to `search_vault`

Files to update:
- `services/commands.ts` — import and registry
- `services/voiceInterface.ts` — display name
- `utils/defaultPrompt.ts` — import and instruction
- `components/ToolResult.tsx` — all name checks
- `components/messages/SystemMessage.tsx` — all name checks

Commit: "refactor: rename search_keyword to search_vault across codebase"

---

### Task 7: Update UI for tag badges and BM25 scores

In `ToolResult.tsx`:
- Show BM25 score on search results (if available)
- Show matched tags as small badges on results when tag filter was used

Commit: "feat: show BM25 scores and tag badges in search results UI"

---

### Task 8: Build and verify

```bash
npm run build
```

Commit if needed.
