import { Type } from '@google/genai';
import { requestUrl } from 'obsidian';
import type { ToolCallbacks } from '../types';
import { getObsidianApp } from '../utils/environment';

type ToolArgs = Record<string, unknown>;

type WebFetchResult = {
  url: string;
  finalUrl?: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

type FetchedResponse = {
  ok: boolean;
  status: number;
  url: string;
  contentType?: string;
  body: string;
};

const DEFAULT_MAX_CHARS_PER_URL = 12000;
const MAX_MAX_CHARS_PER_URL = 30000;

const getNumberArg = (args: ToolArgs, key: string, fallback: number): number => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const getUrlsArg = (args: ToolArgs): string[] => {
  const value = args.urls;

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((url) => url.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((url) => url.trim()).filter(Boolean);
  }

  return [];
};

const normalizeUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Empty URL provided');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol for URL: ${rawUrl}`);
  }

  return parsed.toString();
};

const stripHtml = (html: string): string => {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

const truncateText = (text: string, maxChars: number): { content: string; truncated: boolean } => {
  if (text.length <= maxChars) {
    return { content: text, truncated: false };
  }

  return {
    content: `${text.slice(0, maxChars)}\n\n[Content truncated at ${maxChars} characters]`,
    truncated: true
  };
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const fetchViaRuntime = async (url: string): Promise<FetchedResponse> => {
  const app = getObsidianApp();

  if (app) {
    const response = await requestUrl({
      url,
      method: 'GET'
    });

    const contentType = response.headers?.['content-type'] || response.headers?.['Content-Type'];
    const body = typeof response.text === 'string' ? response.text : '';

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      url,
      contentType,
      body
    };
  }

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow'
  });

  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    contentType: response.headers.get('content-type') || undefined,
    body: await response.text()
  };
};

export const declaration = {
  name: 'web_fetch',
  description: 'Fetch content from one or more URLs and return extracted text content to the model.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      urls: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of URLs to fetch. You can also pass a comma-separated string.'
      },
      maxCharsPerUrl: {
        type: Type.NUMBER,
        description: `Maximum content length per URL (default: ${DEFAULT_MAX_CHARS_PER_URL}, max: ${MAX_MAX_CHARS_PER_URL}).`
      }
    },
    required: ['urls']
  }
};

export const instruction = `- web_fetch: Use this to fetch and read content from specific URLs provided by the user. Accepts multiple URLs in a single call.`;

export const execute = async (
  args: ToolArgs,
  callbacks: ToolCallbacks
): Promise<{ fetchedCount: number; failedCount: number; results: WebFetchResult[] }> => {
  const rawUrls = getUrlsArg(args);

  if (rawUrls.length === 0) {
    throw new Error('Missing urls. Provide a non-empty list of URLs.');
  }

  const maxCharsPerUrl = Math.min(
    Math.max(1000, Math.floor(getNumberArg(args, 'maxCharsPerUrl', DEFAULT_MAX_CHARS_PER_URL))),
    MAX_MAX_CHARS_PER_URL
  );

  callbacks.onSystem(`Fetching ${rawUrls.length} URL${rawUrls.length > 1 ? 's' : ''}...`, {
    name: 'web_fetch',
    filename: `Web (${rawUrls.length})`,
    status: 'pending'
  });

  const results = await Promise.all(
    rawUrls.map(async (rawUrl): Promise<WebFetchResult> => {
      let normalizedUrl: string;

      try {
        normalizedUrl = normalizeUrl(rawUrl);
      } catch (error) {
        return {
          url: rawUrl,
          ok: false,
          error: getErrorMessage(error)
        };
      }

      try {
        const response = await fetchViaRuntime(normalizedUrl);
        const parsedText = response.contentType?.includes('html') ? stripHtml(response.body) : response.body.trim();

        if (!parsedText) {
          return {
            url: rawUrl,
            finalUrl: response.url,
            ok: false,
            status: response.status,
            contentType: response.contentType,
            error: 'Empty or non-text response body'
          };
        }

        const { content, truncated } = truncateText(parsedText, maxCharsPerUrl);

        return {
          url: rawUrl,
          finalUrl: response.url,
          ok: response.ok,
          status: response.status,
          contentType: response.contentType,
          content,
          truncated,
          error: response.ok ? undefined : `HTTP ${response.status}`
        };
      } catch (error) {
        return {
          url: rawUrl,
          finalUrl: normalizedUrl,
          ok: false,
          error: getErrorMessage(error)
        };
      }
    })
  );

  const fetchedCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - fetchedCount;
  const combinedPreview = results
    .map((result) => {
      if (!result.ok) {
        return `URL: ${result.url}\nError: ${result.error || 'Unknown error'}`;
      }
      return `URL: ${result.finalUrl || result.url}\nStatus: ${result.status}\nContent:\n${result.content || ''}`;
    })
    .join('\n\n---\n\n');

  callbacks.onSystem(`Fetched ${fetchedCount}/${results.length} URLs`, {
    name: 'web_fetch',
    filename: `Web (${results.length})`,
    status: failedCount > 0 && fetchedCount === 0 ? 'error' : 'success',
    newContent: combinedPreview,
    description: failedCount > 0 ? `${fetchedCount} succeeded, ${failedCount} failed` : `${fetchedCount} succeeded`
  });

  return {
    fetchedCount,
    failedCount,
    results
  };
};
