import MiniSearch from 'minisearch';
import { TFile, EventRef } from 'obsidian';
import { getObsidianApp } from '../utils/environment';
import type { SearchResult, SearchMatch } from '../types';

interface IndexedDocument {
  id: string;
  title: string;
  content: string;
}

let miniSearch: MiniSearch<IndexedDocument> | null = null;
let initialized = false;
let initializing: Promise<void> | null = null;
let eventRefs: EventRef[] = [];

/**
 * Create a fresh MiniSearch instance with our field configuration.
 */
function createMiniSearch(): MiniSearch<IndexedDocument> {
  return new MiniSearch<IndexedDocument>({
    fields: ['title', 'content'],
    storeFields: ['title'],
    idField: 'id',
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
    },
  });
}

/**
 * Build the full index from all markdown files in the vault.
 */
async function buildIndex(): Promise<void> {
  const app = getObsidianApp();
  if (!app) return;

  miniSearch = createMiniSearch();

  const files = app.vault.getMarkdownFiles();
  const documents: IndexedDocument[] = [];

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      documents.push({
        id: file.path,
        title: file.basename,
        content,
      });
    } catch (error) {
      console.warn(`searchIndex: failed to read ${file.path}`, error);
    }
  }

  miniSearch.addAll(documents);
  registerVaultEvents();
  initialized = true;
}

/**
 * Ensure the index is built. Safe to call multiple times;
 * concurrent callers will wait on the same promise.
 */
async function ensureIndex(): Promise<void> {
  if (initialized) return;
  if (initializing) {
    await initializing;
    return;
  }
  initializing = buildIndex();
  await initializing;
  initializing = null;
}

/**
 * Register vault events for incremental index updates.
 */
function registerVaultEvents(): void {
  const app = getObsidianApp();
  if (!app || !miniSearch) return;

  eventRefs.push(
    app.vault.on('create', async (file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      try {
        const content = await app.vault.cachedRead(file);
        miniSearch!.add({ id: file.path, title: file.basename, content });
      } catch (error) {
        console.warn(`searchIndex: failed to index new file ${file.path}`, error);
      }
    }),

    app.vault.on('modify', async (file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      try {
        const content = await app.vault.cachedRead(file);
        miniSearch!.discard(file.path);
        miniSearch!.add({ id: file.path, title: file.basename, content });
      } catch (error) {
        console.warn(`searchIndex: failed to re-index ${file.path}`, error);
      }
    }),

    app.vault.on('delete', (file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      try {
        miniSearch!.discard(file.path);
      } catch {
        // File may not have been in the index
      }
    }),

    app.vault.on('rename', async (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      try {
        miniSearch!.discard(oldPath);
      } catch {
        // Old path may not have been in the index
      }
      try {
        const content = await app.vault.cachedRead(file);
        miniSearch!.add({ id: file.path, title: file.basename, content });
      } catch (error) {
        console.warn(`searchIndex: failed to index renamed file ${file.path}`, error);
      }
    })
  );
}

/**
 * Clean up the search index and event listeners.
 * Call from plugin.onunload() to prevent leaks on hot-reload.
 */
export function destroySearchIndex(): void {
  const app = getObsidianApp();
  if (app) {
    for (const ref of eventRefs) {
      app.vault.offref(ref);
    }
  }
  eventRefs = [];
  miniSearch = null;
  initialized = false;
  initializing = null;
}

/**
 * Extract matching lines from file content for the given query terms.
 * Returns SearchMatch entries with line numbers, content, and surrounding context.
 */
function extractLineMatches(
  content: string,
  query: string,
  maxMatches: number = 3,
  contextLines: number = 1
): SearchMatch[] {
  const lines = content.split('\n');
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const matches: SearchMatch[] = [];

  for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
    const lineLower = lines[i].toLowerCase();
    const hasMatch = terms.some((term) => lineLower.includes(term));
    if (!hasMatch) continue;

    const contextBefore: string[] = [];
    for (let j = Math.max(0, i - contextLines); j < i; j++) {
      contextBefore.push(lines[j]);
    }

    const contextAfter: string[] = [];
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
      contextAfter.push(lines[j]);
    }

    matches.push({
      line: i + 1, // 1-based line number
      content: lines[i],
      contextBefore: contextBefore.length > 0 ? contextBefore : undefined,
      contextAfter: contextAfter.length > 0 ? contextAfter : undefined,
    });
  }

  return matches;
}

/**
 * Search the vault using a BM25 index powered by MiniSearch.
 * Lazily initializes the index on first call.
 *
 * @param query - The search query string
 * @param limit - Maximum number of results to return (default 30)
 * @returns Array of SearchResult with filename, score, and matching lines
 */
export async function searchIndexed(
  query: string,
  limit: number = 30
): Promise<SearchResult[]> {
  const app = getObsidianApp();
  if (!app) return [];

  await ensureIndex();
  if (!miniSearch) return [];

  const raw = miniSearch.search(query);
  const topResults = raw.slice(0, limit);

  const results: SearchResult[] = [];

  for (const hit of topResults) {
    const file = app.vault.getAbstractFileByPath(hit.id);
    if (!file || !(file instanceof TFile)) continue;

    try {
      const content = await app.vault.cachedRead(file);
      const matches = extractLineMatches(content, query);

      results.push({
        filename: hit.id,
        matches,
        score: hit.score,
      });
    } catch (error) {
      // If we cannot read the file, still return the result without line matches
      results.push({
        filename: hit.id,
        matches: [],
        score: hit.score,
      });
    }
  }

  return results;
}
