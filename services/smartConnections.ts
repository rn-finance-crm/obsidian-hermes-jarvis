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
export async function semanticSearch(query: string, limit: number = 20): Promise<SemanticSearchResult[]> {
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
