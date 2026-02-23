import { Type } from '@google/genai';
import { searchIndexed } from '../services/searchIndex';
import { searchByTags } from '../services/tagSearch';
import { semanticSearch } from '../services/smartConnections';
import type { ToolCallbacks, SearchResult } from '../types';

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
  description: 'Search the vault using BM25 ranked text search. Optionally filter by tags and run semantic search via Smart Connections.',
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

export const instruction = `- search_vault: BM25 ranked search across all vault files. Supports tag filtering (tags parameter) and semantic search via Smart Connections (enabled by default, set semantic=false to disable).`;

export const execute = async (args: ToolArgs, callbacks: ToolCallbacks): Promise<{ results: unknown; semanticResults?: unknown; tagResults?: unknown }> => {
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
  let keywordResults: SearchResult[];
  if (hasTags && tagResults.length > 0) {
    const taggedFiles = new Set(tagResults.map(t => t.filename));
    keywordResults = bm25Results.filter(r => taggedFiles.has(r.filename));
  } else if (hasTags && tagResults.length === 0) {
    // Tags were requested but no files matched — return empty keyword results
    keywordResults = [];
  } else {
    keywordResults = bm25Results;
  }

  const hasSemantic = semResults.length > 0;

  // Build display
  const displayParts = [`Searching for "<strong>${keyword}</strong>" (${keywordResults.length} results)`];
  if (hasTags) {
    displayParts.push(`<br/><strong>Tags:</strong> ${tags.join(', ')} (${tagResults.length} matching files)`);
  }
  if (hasSemantic) {
    displayParts.push(`<br/><strong>Semantic:</strong> ${semResults.length} related notes`);
  }

  callbacks.onSystem(`Search complete for "${keyword}"`, {
    name: 'search_vault',
    filename: `Vault Search: "${keyword}"`,
    searchKeyword: keyword,
    searchResults: keywordResults,
    semanticResults: hasSemantic ? semResults : undefined,
    tagResults: hasTags ? tagResults : undefined,
    displayFormat: displayParts.join(''),
  });

  return {
    results: keywordResults,
    ...(hasSemantic ? { semanticResults: semResults } : {}),
    ...(hasTags ? { tagResults } : {}),
  };
};
