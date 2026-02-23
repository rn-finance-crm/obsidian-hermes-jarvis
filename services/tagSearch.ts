import { getAllTags } from 'obsidian';
import { getObsidianApp } from '../utils/environment';
import type { TagSearchResult } from '../types';

/**
 * Normalize a tag string: ensure it starts with '#' and is lowercase.
 */
function normalizeTag(tag: string): string {
  const trimmed = tag.trim().toLowerCase();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * Check whether a file tag matches a search tag.
 * Supports nested tag prefix matching: searching for '#project'
 * matches '#project', '#project/alpha', '#project/web', etc.
 */
function tagMatches(fileTag: string, searchTag: string): boolean {
  const normalizedFileTag = fileTag.toLowerCase();
  return normalizedFileTag === searchTag || normalizedFileTag.startsWith(searchTag + '/');
}

/**
 * Search the vault for files that match ALL of the provided tags.
 * Uses the in-memory metadataCache (zero disk I/O).
 *
 * Tags may be provided with or without the '#' prefix.
 * Nested tag prefix matching is supported: searching for '#project'
 * will also match '#project/alpha', '#project/web', etc.
 *
 * AND logic: a file must contain at least one match for every provided tag.
 *
 * @param tags - Array of tag strings to search for
 * @returns Array of TagSearchResult with filename and the list of matching tags
 */
export function searchByTags(tags: string[]): TagSearchResult[] {
  const app = getObsidianApp();
  if (!app) return [];

  if (tags.length === 0) {
    return [];
  }

  const normalizedSearchTags = tags.map(normalizeTag);
  const results: TagSearchResult[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;

    const fileTags = getAllTags(cache);
    if (!fileTags || fileTags.length === 0) continue;

    // For each search tag, collect the file tags that match it
    const matchingTags = new Set<string>();
    let allSearchTagsMatched = true;

    for (const searchTag of normalizedSearchTags) {
      let searchTagMatched = false;

      for (const fileTag of fileTags) {
        if (tagMatches(fileTag, searchTag)) {
          matchingTags.add(fileTag);
          searchTagMatched = true;
        }
      }

      if (!searchTagMatched) {
        allSearchTagsMatched = false;
        break;
      }
    }

    if (allSearchTagsMatched) {
      results.push({
        filename: file.path,
        tags: Array.from(matchingTags),
      });
    }
  }

  return results;
}
