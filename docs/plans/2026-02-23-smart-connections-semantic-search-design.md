# Smart Connections Semantic Search Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Augment `search_keyword` to run semantic search via Smart Connections in parallel with keyword search, returning both result sets to Gemini and the UI.

**Architecture:** Add a `services/smartConnections.ts` service that checks for the Smart Connections plugin and calls its `env.smart_sources.lookup()` API. Modify `search_keyword` to accept an optional `semantic` boolean (default `true`), run both searches in parallel, and append semantic results as a new `semanticResults` field on `ToolData`. Add a `SemanticResultsView` UI component rendered below keyword results.

**Tech Stack:** TypeScript, React, Obsidian API, Smart Connections internal API (`env.smart_sources.lookup`)

---

### Task 1: Add `SemanticSearchResult` type to `types.ts`

**Files:**
- Modify: `types.ts:19-29` (near existing SearchResult types)
- Modify: `types.ts:44-81` (ToolData interface)

**Step 1: Add `SemanticSearchResult` interface after `SearchResult`**

In `types.ts`, after the `SearchResult` interface (line 29), add:

```ts
export interface SemanticSearchResult {
  filename: string;
  score: number;
  key: string;
}
```

**Step 2: Add `semanticResults` field to `ToolData`**

In `types.ts`, in the `ToolData` interface, after the `searchKeyword?: string;` line (line 57), add:

```ts
  semanticResults?: SemanticSearchResult[];
```

**Step 3: Commit**

```bash
git add types.ts
git commit -m "feat: add SemanticSearchResult type and ToolData field"
```

---

### Task 2: Create `services/smartConnections.ts`

**Files:**
- Create: `services/smartConnections.ts`

**Step 1: Create the service**

Create `services/smartConnections.ts`:

```ts
import { getObsidianApp } from '../utils/environment';
import type { SemanticSearchResult } from '../types';

/**
 * Check if Smart Connections plugin is installed and its environment is ready.
 */
export function isSmartConnectionsAvailable(): boolean {
  const app = getObsidianApp();
  if (!app) return false;
  const sc = (app as any).plugins?.plugins?.['smart-connections'];
  return !!sc?.env?.smart_sources;
}

/**
 * Perform semantic search via Smart Connections' lookup API.
 * Returns empty array if SC is not available or search fails.
 */
export async function semanticSearch(query: string, limit: number = 10): Promise<SemanticSearchResult[]> {
  const app = getObsidianApp();
  if (!app) return [];

  const sc = (app as any).plugins?.plugins?.['smart-connections'];
  const env = sc?.env;
  if (!env?.smart_sources) return [];

  try {
    const results = await env.smart_sources.lookup({
      hypotheticals: [query],
      filter: { limit },
    });

    return results.map((r: any) => ({
      filename: r.item?.path ?? r.key,
      score: r.score,
      key: r.key,
    }));
  } catch (error) {
    console.warn('Smart Connections semantic search failed:', error);
    return [];
  }
}
```

**Step 2: Commit**

```bash
git add services/smartConnections.ts
git commit -m "feat: add Smart Connections semantic search service"
```

---

### Task 3: Modify `search_keyword.ts` to run both searches in parallel

**Files:**
- Modify: `tools/search_keyword.ts`

**Step 1: Update the tool**

Replace the entire contents of `tools/search_keyword.ts`:

```ts
import { Type } from '@google/genai';
import { searchFiles } from '../services/vaultOperations';
import { semanticSearch } from '../services/smartConnections';
import type { ToolCallbacks } from '../types';

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

const getBooleanArg = (args: ToolArgs, key: string, defaultValue: boolean): boolean => {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'false') return false;
  if (value === 'true') return true;
  return defaultValue;
};

export const declaration = {
  name: 'search_keyword',
  description: 'Search for a keyword across all files in the vault. By default also runs semantic search via Smart Connections if available.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      keyword: { type: Type.STRING, description: 'The text to search for' },
      semantic: { type: Type.BOOLEAN, description: 'Whether to also run semantic (embedding-based) search. Defaults to true. Set to false for exact keyword matches only.' }
    },
    required: ['keyword']
  }
};

export const instruction = `- search_keyword: Fast plaintext search across all files. Also runs semantic search via Smart Connections by default (set semantic=false to disable).`;

export const execute = async (args: ToolArgs, callbacks: ToolCallbacks): Promise<{ results: unknown; semanticResults?: unknown }> => {
  const keyword = getStringArg(args, 'keyword');
  if (!keyword) {
    throw new Error('Missing keyword');
  }

  const runSemantic = getBooleanArg(args, 'semantic', true);

  // Run keyword search and (optionally) semantic search in parallel
  const [keywordResults, semResults] = await Promise.all([
    searchFiles(keyword, false),
    runSemantic ? semanticSearch(keyword).catch(() => []) : Promise.resolve([]),
  ]);

  const hasSemantic = semResults.length > 0;
  const displayParts = [`Searching for "<strong>${keyword}</strong>" (${keywordResults.length} results)`];
  if (hasSemantic) {
    displayParts.push(`<br/><strong>Semantic:</strong> ${semResults.length} related notes`);
  }

  callbacks.onSystem(`Search complete for "${keyword}"`, {
    name: 'search_keyword',
    filename: `Global Search: "${keyword}"`,
    searchKeyword: keyword,
    searchResults: keywordResults,
    semanticResults: hasSemantic ? semResults : undefined,
    displayFormat: displayParts.join(''),
  });

  return {
    results: keywordResults,
    ...(hasSemantic ? { semanticResults: semResults } : {}),
  };
};
```

**Step 2: Commit**

```bash
git add tools/search_keyword.ts
git commit -m "feat: search_keyword runs semantic search in parallel"
```

---

### Task 4: Add `SemanticResultsView` to `ToolResult.tsx`

**Files:**
- Modify: `components/ToolResult.tsx:1-3` (imports)
- Modify: `components/ToolResult.tsx:14-92` (add new component after SearchResultsView)
- Modify: `components/ToolResult.tsx:574-580` (render semantic results below keyword results)

**Step 1: Add `SemanticSearchResult` to imports**

In `components/ToolResult.tsx` line 3, add `SemanticSearchResult` to the import:

```ts
import { ToolData, FileDiff, SearchResult, SearchMatch, ImageSearchResult, DownloadedImage, DirectoryInfoItem, SemanticSearchResult } from '../types';
```

**Step 2: Add `SemanticResultsView` component**

After the `SearchResultsView` component (after line 92, before `const DiffView`), add:

```tsx
const SemanticResultsView: React.FC<{ semanticResults: SemanticSearchResult[], keyword?: string }> = ({ semanticResults, keyword }) => {
  const handleFileClick = async (filename: string) => {
    try {
      await openFileInObsidian(filename);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  };

  return (
    <div className="p-4 space-y-3 hermes-border-t">
      <div className="pb-3 hermes-border-b mb-3">
        <div className="text-sm font-medium hermes-text-normal mb-1 flex items-center space-x-2">
          <svg className="w-4 h-4 hermes-text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Semantic Search Results</span>
          <span className="text-[9px] hermes-text-muted font-normal">via Smart Connections</span>
        </div>
        <div className="text-xs hermes-text-muted">
          {semanticResults.length} semantically related note{semanticResults.length !== 1 ? 's' : ''}{keyword ? ` for "${keyword}"` : ''}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto">
        {semanticResults.map((result, index) => (
          <div
            key={index}
            className="flex items-center space-x-3 p-3 rounded-xl hermes-bg-secondary/5 hermes-border/5 hermes-hover:bg-secondary/10 hermes-hover:border/10 transition-all group cursor-pointer"
            onClick={() => handleFileClick(result.filename)}
          >
            <div className="w-8 h-8 rounded-lg hermes-interactive-bg/10 flex items-center justify-center shrink-0 hermes-border/20">
              <svg className="w-4 h-4 hermes-text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="flex flex-col truncate flex-1">
              <span className="text-xs font-bold hermes-text-normal group-hover:hermes-text-accent transition-colors truncate">
                {result.filename}
              </span>
              {result.key !== result.filename && (
                <span className="text-[9px] hermes-text-muted truncate font-mono">
                  {result.key}
                </span>
              )}
            </div>
            <div className="text-[9px] font-medium px-2 py-1 rounded hermes-interactive-bg/10 hermes-text-accent">
              {Math.round(result.score * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

**Step 3: Render `SemanticResultsView` below keyword results**

In the render section around line 574-580, after the existing `SearchResultsView` block, add the semantic results block. The section should look like:

```tsx
          {(toolData.name === 'search_keyword' || toolData.name === 'search_regexp') && toolData.searchResults && (
            <SearchResultsView
              searchResults={toolData.searchResults}
              keyword={toolData.searchKeyword}
              pattern={toolData.filename}
            />
          )}

          {toolData.name === 'search_keyword' && toolData.semanticResults && toolData.semanticResults.length > 0 && (
            <SemanticResultsView
              semanticResults={toolData.semanticResults}
              keyword={toolData.searchKeyword}
            />
          )}
```

**Step 4: Commit**

```bash
git add components/ToolResult.tsx
git commit -m "feat: add SemanticResultsView UI component for semantic search results"
```

---

### Task 5: Manual testing checklist

**Without Smart Connections installed:**
1. Run `search_keyword` with a keyword — should return keyword results only, no semantic section in UI
2. Run `search_keyword` with `semantic: false` — same behavior

**With Smart Connections installed:**
1. Run `search_keyword` with a keyword — should show keyword results AND semantic results section
2. Run `search_keyword` with `semantic: false` — should show keyword results only
3. Verify semantic results show filename and similarity percentage
4. Click a semantic result — should open the file in Obsidian
5. Verify Gemini response includes semantic results in its context

**Step 1: Build and test in Obsidian**

```bash
npm run build
```

Load the plugin in Obsidian dev vault, run searches, verify both sections appear.

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat: integrate Smart Connections semantic search into search_keyword"
```
