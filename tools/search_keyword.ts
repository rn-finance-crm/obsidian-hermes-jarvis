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
