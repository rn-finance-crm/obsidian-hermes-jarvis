import { Type } from '@google/genai';
import { searchIndexed } from '../services/searchIndex';
import { searchByTags } from '../services/tagSearch';
import { semanticSearch } from '../services/smartConnections';
import type { ToolCallbacks, SearchResult, TagSearchResult } from '../types';

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

const getStringArrayArg = (args: ToolArgs, key: string): string[] => {
  const value = args[key];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
};

export const declaration = {
  name: 'search_vault',
  description: 'Search the vault using BM25 ranked text search. Optionally filter by tags and run semantic search via Smart Connections. Returns a unified ranked list with source indicators (keyword/semantic/tag).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      keyword: { type: Type.STRING, description: 'The text to search for' },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Optional: filter results to files matching ALL these tags (e.g. ["#project", "#active"]). Supports nested tags.',
      },
      semantic: { type: Type.BOOLEAN, description: 'Whether to also run semantic (embedding-based) search. Defaults to true. Set to false for exact text matches only.' },
    },
    required: ['keyword'],
  },
};

export const instruction = `- search_vault: BM25 ranked search across all vault files. Returns unified results with source labels (keyword, semantic, tag). Supports tag filtering (tags parameter) and semantic search via Smart Connections (enabled by default, set semantic=false to disable).`;

/**
 * Merge BM25 keyword results, semantic results, and tag-only matches into a single
 * unified ranked list. Each result is tagged with its source. Files appearing in
 * multiple sources get the highest-ranked entry with all sources noted.
 */
function mergeResults(
  bm25Results: SearchResult[],
  semResults: { filename: string; score: number; key: string }[],
  tagResults: TagSearchResult[],
  hasTags: boolean,
): SearchResult[] {
  // Map to track best result per filename and accumulate sources
  const merged = new Map<string, SearchResult & { sources: Set<string> }>();

  // 1. Add BM25 keyword results (already ranked by score)
  for (const r of bm25Results) {
    merged.set(r.filename, {
      ...r,
      source: 'keyword',
      sources: new Set(['keyword']),
    });
  }

  // 2. Add semantic results — merge or insert
  for (const sr of semResults) {
    const existing = merged.get(sr.filename);
    if (existing) {
      existing.sources.add('semantic');
    } else {
      merged.set(sr.filename, {
        filename: sr.filename,
        matches: [],
        score: sr.score,
        source: 'semantic',
        sources: new Set(['semantic']),
      });
    }
  }

  // 3. Add tag-only results (files that matched tags but NOT keyword/semantic)
  if (hasTags) {
    for (const tr of tagResults) {
      const existing = merged.get(tr.filename);
      if (existing) {
        existing.sources.add('tag');
      } else {
        merged.set(tr.filename, {
          filename: tr.filename,
          matches: [],
          source: 'tag',
          sources: new Set(['tag']),
        });
      }
    }
  }

  // Build final list: set source to most descriptive label
  const results: SearchResult[] = [];
  for (const entry of merged.values()) {
    const { sources, ...result } = entry;
    // Pick source label: if multiple, use the most specific
    if (sources.size > 1) {
      // Prefer keyword > semantic > tag for the primary label
      result.source = sources.has('keyword') ? 'keyword' : sources.has('semantic') ? 'semantic' : 'tag';
    }
    results.push(result);
  }

  // Sort: keyword results first (by BM25 score desc), then semantic (by score desc), then tag-only
  results.sort((a, b) => {
    const sourceOrder = { keyword: 0, semantic: 1, tag: 2 };
    const aOrder = sourceOrder[a.source || 'keyword'];
    const bOrder = sourceOrder[b.source || 'keyword'];
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.score || 0) - (a.score || 0);
  });

  return results;
}

export const execute = async (args: ToolArgs, callbacks: ToolCallbacks): Promise<{ results: SearchResult[] }> => {
  const keyword = getStringArg(args, 'keyword');
  if (!keyword) {
    throw new Error('Missing keyword');
  }

  const tags = getStringArrayArg(args, 'tags');
  const runSemantic = getBooleanArg(args, 'semantic', true);
  const hasTags = tags.length > 0;

  // Run all searches in parallel
  const [bm25Results, tagResults, semResults] = await Promise.all([
    searchIndexed(keyword).catch(() => []),
    hasTags ? Promise.resolve(searchByTags(tags)).catch(() => []) : Promise.resolve([]),
    runSemantic ? semanticSearch(keyword).catch(() => []) : Promise.resolve([]),
  ]);

  // If tags were provided, filter BM25 results to only files that match the tags
  let filteredBm25: SearchResult[];
  if (hasTags && tagResults.length > 0) {
    const taggedFiles = new Set(tagResults.map(t => t.filename));
    filteredBm25 = bm25Results.filter(r => taggedFiles.has(r.filename));
  } else if (hasTags && tagResults.length === 0) {
    filteredBm25 = [];
  } else {
    filteredBm25 = bm25Results;
  }

  // Tag BM25 results with source
  for (const r of filteredBm25) {
    r.source = 'keyword';
  }

  // Merge all results into a unified ranked list
  const unified = mergeResults(filteredBm25, semResults, tagResults, hasTags);

  // Build display summary
  const keywordCount = unified.filter(r => r.source === 'keyword').length;
  const semanticCount = unified.filter(r => r.source === 'semantic').length;
  const tagOnlyCount = unified.filter(r => r.source === 'tag').length;

  const displayParts = [`Searching for "<strong>${keyword}</strong>" (${unified.length} results)`];
  const breakdown: string[] = [];
  if (keywordCount > 0) breakdown.push(`${keywordCount} keyword`);
  if (semanticCount > 0) breakdown.push(`${semanticCount} semantic`);
  if (tagOnlyCount > 0) breakdown.push(`${tagOnlyCount} tag-only`);
  if (breakdown.length > 0) {
    displayParts.push(`<br/><span style="opacity:0.7">${breakdown.join(' · ')}</span>`);
  }
  if (hasTags) {
    displayParts.push(`<br/><strong>Tags:</strong> ${tags.join(', ')}`);
  }

  callbacks.onSystem(`Search complete for "${keyword}"`, {
    name: 'search_vault',
    filename: `Vault Search: "${keyword}"`,
    searchKeyword: keyword,
    searchResults: unified,
    tagResults: hasTags ? tagResults : undefined,
    displayFormat: displayParts.join(''),
  });

  return { results: unified };
};
