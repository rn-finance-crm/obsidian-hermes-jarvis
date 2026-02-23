import { Type, GoogleGenAI } from '@google/genai';
import { requestUrl } from 'obsidian';
import type { ToolCallbacks, DeepResearchInProgressItem, ToolData } from '../types';
import { loadAppSettings } from '../persistence/persistence';
import { addDeepResearchInProgress, loadDeepResearchInProgress, removeDeepResearchInProgress } from '../persistence/persistence';
import { createDirectory, createFile, updateFile } from '../services/vaultOperations';
import { getObsidianApp } from '../utils/environment';

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const getNestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
};

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
};

const nowDate = (): string => {
  return new Date().toISOString();
};

const dateForFilename = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
};

const formatElapsedHuman = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

const truncate = (text: string, max = 220): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
};

const guessShortName = (query: string): string => {
  const words = query
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
    .trim();
  return words || 'Research';
};

const extractTextFromOutput = (output: unknown): string[] => {
  if (!isRecord(output)) return [];

  const type = typeof output.type === 'string' ? output.type : undefined;
  const lines: string[] = [];

  if (type === 'text' && typeof output.text === 'string' && output.text.trim()) {
    lines.push(output.text.trim());
  }

  if (type === 'thought' && Array.isArray(output.summary)) {
    for (const part of output.summary) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        lines.push(part.text.trim());
      }
    }
  }

  return lines;
};

const extractThinkingFromDelta = (delta: unknown): string[] => {
  if (!isRecord(delta)) return [];
  const type = typeof delta.type === 'string' ? delta.type : undefined;

  if (type === 'thought_summary') {
    const content = delta.content;
    if (isRecord(content) && content.type === 'text' && typeof content.text === 'string' && content.text.trim()) {
      return [content.text.trim()];
    }
  }

  if (type === 'text' && typeof delta.text === 'string' && delta.text.trim()) {
    return [delta.text.trim()];
  }

  return [];
};

const uniqueLines = (lines: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
};

const formatThinkingForUi = (thinkingLines: string[]): string => {
  if (thinkingLines.length === 0) {
    return 'Preparing research stream...';
  }

  return [
    'Research stream:',
    '',
    ...thinkingLines.map(line => `- ${line}`)
  ].join('\n');
};

const RESEARCH_AGENT_CANDIDATES = [
  'deep-research-pro-preview-12-2025',
  'deep-research-pro',
  'deep-research'
];

const buildFrontmatter = (params: {
  date: string;
  query: string;
  shortName: string;
  longName: string;
  researchModel: string;
  elapsed: number;
  elapsedHuman: string;
  tokenCount: number | null;
  shortConclusion: string;
}): string => {
  const tokenValue = params.tokenCount === null ? 'null' : String(params.tokenCount);
  const escapedQuery = JSON.stringify(params.query);
  const escapedShort = JSON.stringify(params.shortName);
  const escapedLong = JSON.stringify(params.longName);
  const escapedModel = JSON.stringify(params.researchModel);
  const escapedConclusion = JSON.stringify(params.shortConclusion);
  const escapedElapsedHuman = JSON.stringify(params.elapsedHuman);

  return [
    '---',
    `date: ${params.date}`,
    `query: ${escapedQuery}`,
    `shortName: ${escapedShort}`,
    `longName: ${escapedLong}`,
    `researchModel: ${escapedModel}`,
    `elapsed: ${params.elapsed}`,
    `elapsed_human: ${escapedElapsedHuman}`,
    `tokenCount: ${tokenValue}`,
    `shortConclusion: ${escapedConclusion}`,
    '---'
  ].join('\n');
};

const toWikiLink = (path: string): string => {
  return `[[${path.replace(/\.md$/i, '')}]]`;
};

const getInteractionId = (interaction: unknown): string | null => {
  if (!isRecord(interaction)) return null;

  const directId = interaction.id;
  if (typeof directId === 'string' && directId.trim()) return directId;

  const interactionObj = getNestedRecord(interaction, 'interaction');
  if (interactionObj && typeof interactionObj.id === 'string' && interactionObj.id.trim()) {
    return interactionObj.id;
  }

  const responseObj = getNestedRecord(interaction, 'response');
  if (responseObj) {
    if (typeof responseObj.id === 'string' && responseObj.id.trim()) {
      return responseObj.id;
    }
    const nestedInteraction = getNestedRecord(responseObj, 'interaction');
    if (nestedInteraction && typeof nestedInteraction.id === 'string' && nestedInteraction.id.trim()) {
      return nestedInteraction.id;
    }
  }

  const name = interaction.name;
  if (typeof name === 'string' && name.includes('/interactions/')) {
    const parts = name.split('/');
    return parts[parts.length - 1] || null;
  }

  return null;
};

const isObsidianRuntime = (): boolean => {
  return Boolean(getObsidianApp());
};

const interactionApiRequest = async (
  apiKey: string,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<unknown> => {
  const safePath = !path ? '' : (path.startsWith('/') ? path : `/${path}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/interactions${safePath}?key=${encodeURIComponent(apiKey)}`;

  if (isObsidianRuntime()) {
    const response = await requestUrl({
      url,
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const statusOk = response.status >= 200 && response.status < 300;
    if (!statusOk) {
      throw new Error(`Interactions API error (${response.status}): ${response.text || 'Unknown error'}`);
    }

    return response.json as unknown;
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Interactions API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<unknown>;
};

type InteractionStatus = 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled';

const getInteractionStatus = (interaction: unknown): InteractionStatus | null => {
  if (!isRecord(interaction)) return null;

  const interactionObj = getNestedRecord(interaction, 'interaction') || getNestedRecord(interaction, 'response') || interaction;
  const status = interactionObj.status;
  if (
    status === 'in_progress' ||
    status === 'requires_action' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status;
  }

  // Handle operation-like responses
  if (typeof interaction.done === 'boolean') {
    if (!interaction.done) return 'in_progress';
    if (interaction.error) return 'failed';
    return 'completed';
  }

  const state = interactionObj.state;
  if (typeof state === 'string') {
    const normalized = state.toLowerCase();
    if (normalized.includes('running') || normalized.includes('pending') || normalized.includes('queued')) {
      return 'in_progress';
    }
    if (normalized.includes('failed') || normalized.includes('error')) {
      return 'failed';
    }
    if (normalized.includes('cancel')) {
      return 'cancelled';
    }
    if (normalized.includes('success') || normalized.includes('complete') || normalized.includes('succeed')) {
      return 'completed';
    }
  }

  return null;
};

const getUsageTokenCount = (interaction: unknown): number | null => {
  if (!isRecord(interaction)) return null;
  const interactionObj = getNestedRecord(interaction, 'interaction') || getNestedRecord(interaction, 'response') || interaction;
  if (!isRecord(interactionObj.usage)) return null;
  const usage = interactionObj.usage;
  if (typeof usage.total_tokens === 'number') return usage.total_tokens;
  if (typeof usage.totalTokens === 'number') return usage.totalTokens;
  return null;
};

type UsageSnapshot = {
  total: number | null;
  input: number | null;
  output: number | null;
  thoughts: number | null;
  toolUse: number | null;
};

const getUsageSnapshot = (interaction: unknown): UsageSnapshot => {
  if (!isRecord(interaction)) {
    return { total: null, input: null, output: null, thoughts: null, toolUse: null };
  }

  const interactionObj = getNestedRecord(interaction, 'interaction') || getNestedRecord(interaction, 'response') || interaction;
  const usageObject = isRecord(interactionObj.usage)
    ? interactionObj.usage
    : (isRecord(interactionObj.usage_metadata) ? interactionObj.usage_metadata : (isRecord(interactionObj.usageMetadata) ? interactionObj.usageMetadata : null));

  if (!usageObject) {
    return { total: null, input: null, output: null, thoughts: null, toolUse: null };
  }

  const usage = usageObject;
  const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : (typeof usage.totalTokens === 'number' ? usage.totalTokens : null);
  const input = typeof usage.total_input_tokens === 'number' ? usage.total_input_tokens : (typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : null);
  const output = typeof usage.total_output_tokens === 'number' ? usage.total_output_tokens : (typeof usage.responseTokenCount === 'number' ? usage.responseTokenCount : null);
  const thoughts = typeof usage.total_thought_tokens === 'number' ? usage.total_thought_tokens : (typeof usage.thoughtsTokenCount === 'number' ? usage.thoughtsTokenCount : null);
  const toolUse = typeof usage.total_tool_use_tokens === 'number' ? usage.total_tool_use_tokens : (typeof usage.toolUsePromptTokenCount === 'number' ? usage.toolUsePromptTokenCount : null);

  return { total, input, output, thoughts, toolUse };
};

const getOutputText = (interaction: unknown): string => {
  if (!isRecord(interaction)) return '';

  const interactionObj = getNestedRecord(interaction, 'interaction') || getNestedRecord(interaction, 'response') || interaction;
  if (!Array.isArray(interactionObj.outputs)) return '';
  const outputs = interactionObj.outputs;
  const lines: string[] = [];

  for (const output of outputs) {
    lines.push(...extractTextFromOutput(output));
  }

  return uniqueLines(lines).join('\n\n').trim();
};

const buildInteractionLookupPath = (interactionId: string): string => {
  const trimmed = interactionId.trim();
  if (!trimmed) return '';

  if (trimmed.includes('/interactions/')) {
    const marker = '/interactions/';
    const index = trimmed.lastIndexOf(marker);
    const idPart = trimmed.slice(index + marker.length);
    return `/${encodeURIComponent(idPart)}`;
  }

  if (trimmed.startsWith('interactions/')) {
    return `/${trimmed.slice('interactions/'.length)}`;
  }

  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    return `/${encodeURIComponent(parts[parts.length - 1])}`;
  }

  return `/${encodeURIComponent(trimmed)}`;
};

const buildInteractionLookupPaths = (interactionId: string): string[] => {
  const raw = interactionId.trim();
  const candidates = new Set<string>();

  const primary = buildInteractionLookupPath(raw);
  if (primary) candidates.add(primary);

  if (raw.startsWith('interactions/')) {
    candidates.add(`/${raw.slice('interactions/'.length)}`);
  }

  if (raw.includes('/interactions/')) {
    const marker = '/interactions/';
    const idx = raw.lastIndexOf(marker);
    const suffix = raw.slice(idx + marker.length);
    candidates.add(`/${suffix}`);
    candidates.add(`/${encodeURIComponent(suffix)}`);
  }

  if (raw.includes('/')) {
    const tail = raw.split('/').pop();
    if (tail) {
      candidates.add(`/${tail}`);
      candidates.add(`/${encodeURIComponent(tail)}`);
    }
  }

  return Array.from(candidates).filter(Boolean);
};

const collectThinkingFromEvent = (event: unknown): string[] => {
  if (!isRecord(event)) return [];
  const out: string[] = [];

  const eventType = typeof event.event_type === 'string' ? event.event_type : undefined;
  if (eventType === 'interaction.status_update' && typeof event.status === 'string') {
    out.push(`Status: ${event.status}`);
  }

  if (eventType === 'content.delta') {
    out.push(...extractThinkingFromDelta(event.delta));
  }

  if (eventType === 'content.start' && isRecord(event.content) && event.content.type === 'thought') {
    out.push('Thought stream opened');
  }

  if (eventType === 'content.stop') {
    out.push('Thought stream checkpoint complete');
  }

  return out;
};

const activeResearchJobs = new Set<string>();

type ResearchRunOptions = {
  existingItem?: DeepResearchInProgressItem;
  toolCallId?: string;
};

const runBackgroundResearch = async (
  query: string,
  shortName: string,
  longName: string,
  callbacks: ToolCallbacks,
  options?: ResearchRunOptions
): Promise<void> => {
  const startedAt = performance.now();
  const startDate = options?.existingItem ? new Date(options.existingItem.startedAt) : new Date();

  const settings = loadAppSettings();
  const apiKey = settings?.manualApiKey?.trim();
  if (!apiKey) {
    throw new Error('No Gemini API key configured for research');
  }

  const baseFolder = settings?.chatHistoryFolder?.trim() || 'hermes';
  const researchFolder = `${baseFolder}/research`;

  await createDirectory(researchFolder);

  const timestamp = dateForFilename(startDate);
  const filename = `${timestamp}-${slugify(shortName || guessShortName(query)) || 'research'}.md`;
  const fullPath = options?.existingItem?.fullPath || `${researchFolder}/${filename}`;
  const link = toWikiLink(fullPath);

  const pendingToolId = options?.existingItem?.toolCallId || options?.toolCallId;

  const emitSystem = (text: string, toolData: Record<string, unknown>) => {
    callbacks.onSystem(text, { ...toolData, ...(pendingToolId ? { id: pendingToolId } : {}) } as ToolData);
  };

  if (!options?.existingItem) {
    const placeholderFrontmatter = buildFrontmatter({
      date: nowDate(),
      query,
      shortName,
      longName,
      researchModel: 'pending',
      elapsed: 0,
      elapsedHuman: '00:00',
      tokenCount: null,
      shortConclusion: 'Research in progress.'
    });
    const placeholderBody = [
      placeholderFrontmatter,
      '',
      '# Research Result',
      '',
      '_Research in progress..._',
      '',
      '---',
      'Train of Thought',
      '---',
      '- Research started'
    ].join('\n');

    try {
      await createFile(fullPath, placeholderBody);
      callbacks.onLog(`Research placeholder file created: ${fullPath}`, 'action');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already exists')) {
        await updateFile(fullPath, placeholderBody);
        callbacks.onLog(`Research placeholder file updated: ${fullPath}`, 'info');
      } else {
        throw error;
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  let initialInteraction: unknown = null;
  let selectedAgent = options?.existingItem?.agent || RESEARCH_AGENT_CANDIDATES[0];
  let lastCreatePayload: unknown = null;
  let interactionId = options?.existingItem?.interactionId || null;

  if (!interactionId) {
    callbacks.onLog('Research: creating background interaction', 'action');

    let lastCreateError: Error | null = null;
    for (const agent of RESEARCH_AGENT_CANDIDATES) {
      try {
        if (isObsidianRuntime()) {
          initialInteraction = await interactionApiRequest(apiKey, '', 'POST', {
            input: query,
            agent,
            background: true,
            agent_config: {
              type: 'deep-research',
              thinking_summaries: 'auto'
            }
          });
        } else {
          initialInteraction = await ai.interactions.create({
            input: query,
            agent,
            background: true,
            agent_config: {
              type: 'deep-research',
              thinking_summaries: 'auto'
            }
          });
        }
        lastCreatePayload = initialInteraction;
        selectedAgent = agent;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        callbacks.onLog(`Research agent ${agent} unavailable: ${message}`, 'info');
        lastCreateError = error instanceof Error ? error : new Error(message);
      }
    }

    if (!initialInteraction) {
      throw lastCreateError || new Error('Failed to create research interaction');
    }

    interactionId = getInteractionId(initialInteraction);
    if (!interactionId) {
      callbacks.onLog(`Research create response: ${JSON.stringify(initialInteraction).slice(0, 1000)}`, 'info');
      throw new Error('Research did not return a valid interaction id');
    }

    await addDeepResearchInProgress({
      interactionId,
      query,
      shortName,
      longName,
      fullPath,
      agent: selectedAgent,
      startedAt: startDate.toISOString(),
      ...(pendingToolId ? { toolCallId: pendingToolId } : {})
    });
  }

  if (!interactionId) {
    throw new Error('Research interaction id missing');
  }

  if (activeResearchJobs.has(interactionId)) {
    callbacks.onLog(`Research already active, skipping duplicate monitor: ${interactionId}`, 'info');
    return;
  }
  activeResearchJobs.add(interactionId);

  try {

  callbacks.onLog(`Research interaction created: ${interactionId}`, 'action');
  callbacks.onLog(`Research agent selected: ${selectedAgent}`, 'info');

  const thinkingLines: string[] = ['Research job queued'];
  let lastUiPush = 0;

  console.debug('[start_research] monitor start', { query, interactionId, selectedAgent, fullPath, resumed: Boolean(options?.existingItem) });

  emitSystem('research started, will get back when the results are in.', {
    name: 'start_research',
    filename: query,
    status: 'pending',
    dropdown: true,
    targetPath: fullPath,
    newContent: `File: ${link}\n\n${formatThinkingForUi(thinkingLines)}`,
    description: `Interaction: ${interactionId}`
  });

  let streamFailed = false;
  if (!isObsidianRuntime()) {
    try {
      const stream = await ai.interactions.get(interactionId, { stream: true });
      for await (const event of stream as AsyncIterable<unknown>) {
        const newLines = collectThinkingFromEvent(event);
        if (newLines.length > 0) {
          thinkingLines.push(...newLines);
        }

        const now = performance.now();
        if (now - lastUiPush > 700 && newLines.length > 0) {
          lastUiPush = now;
          emitSystem('research started, will get back when the results are in.', {
            name: 'start_research',
            filename: query,
            status: 'pending',
            dropdown: true,
            targetPath: fullPath,
            newContent: `File: ${link}\n\n${formatThinkingForUi(uniqueLines(thinkingLines))}`,
            description: `Interaction: ${interactionId}`
          });
        }
      }
    } catch (error) {
      streamFailed = true;
      thinkingLines.push(`Stream warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let finalInteraction: unknown = null;
  const maxPolls = 1200;
  const lookupPaths = buildInteractionLookupPaths(interactionId);
  let lastSuccessfulLookupPath = lookupPaths[0] || '';
  let lastStatus: string | null = null;
  let lastPollPayload: unknown = null;
  let consecutivePollFailures = 0;

  callbacks.onLog(`Research polling started. Paths: ${lookupPaths.join(', ')}`, 'info');

  for (let i = 0; i < maxPolls; i++) {
    try {
      if (isObsidianRuntime()) {
        let resolved: unknown = null;
        let resolvedPath: string | null = null;
        const pollErrors: string[] = [];

        for (const candidatePath of lookupPaths) {
          try {
            const payload = await interactionApiRequest(apiKey, candidatePath, 'GET');
            resolved = payload;
            resolvedPath = candidatePath;
            break;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            pollErrors.push(`${candidatePath}: ${msg}`);
          }
        }

        if (!resolved) {
          throw new Error(`All interaction lookup paths failed. ${pollErrors.join(' | ')}`);
        }

        finalInteraction = resolved;
        lastSuccessfulLookupPath = resolvedPath || lastSuccessfulLookupPath;
      } else {
        finalInteraction = await ai.interactions.get(interactionId);
      }
      lastPollPayload = finalInteraction;
      consecutivePollFailures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      thinkingLines.push(`Polling warning: ${message}`);
      consecutivePollFailures += 1;
      callbacks.onLog(`Research polling warning (${i + 1}/${maxPolls}, consecutive ${consecutivePollFailures}): ${message}`, 'info');
      console.error('[start_research] polling failed', {
        interactionId,
        poll: i + 1,
        consecutivePollFailures,
        lastSuccessfulLookupPath,
        lookupPaths,
        message
      });
      await delay(1000);
      continue;
    }

    const status = getInteractionStatus(finalInteraction);
    lastStatus = status;
    const usage = getUsageSnapshot(finalInteraction);
    if (status) {
      thinkingLines.push(`Status: ${status}`);
    }

    const polledOutput = getOutputText(finalInteraction);
    if (polledOutput) {
      const preview = truncate(polledOutput, 300);
      thinkingLines.push(`Interim summary: ${preview}`);
    }

    const now = performance.now();
    const elapsedSecondsLive = Math.max(1, Math.round((now - startedAt) / 1000));
    const elapsedHumanLive = formatElapsedHuman(elapsedSecondsLive);
    const usageLabel = usage.total !== null
      ? `Tokens: ${usage.total}${usage.input !== null || usage.output !== null ? ` (in ${usage.input ?? 0}, out ${usage.output ?? 0})` : ''}`
      : 'Tokens: n/a (pending usage)';

    if (i === 0 || i % 5 === 0) {
      console.debug('[start_research] poll', {
        interactionId,
        poll: i + 1,
        lookupPath: lastSuccessfulLookupPath,
        status,
        elapsedSeconds: elapsedSecondsLive,
        usage
      });
    }

    if (now - lastUiPush > 1200) {
      lastUiPush = now;
      emitSystem('research started, will get back when the results are in.', {
        name: 'start_research',
        filename: query,
        status: 'pending',
        dropdown: true,
        targetPath: fullPath,
        newContent: `File: ${link}\nStatus: ${status || 'in_progress'}\nElapsed: ${elapsedSecondsLive}s (${elapsedHumanLive})\n${usageLabel}\nDebug: poll ${i + 1}, path ${lastSuccessfulLookupPath || 'n/a'}\n\n${formatThinkingForUi(uniqueLines(thinkingLines))}`,
        description: `Interaction: ${interactionId} (${selectedAgent})`
      });
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      break;
    }
    await delay(1000);
  }

  const finalStatus = getInteractionStatus(finalInteraction);
  if (!finalStatus || finalStatus === 'in_progress' || finalStatus === 'requires_action') {
    const debugPayload = {
      interactionId,
      selectedAgent,
      lastStatus,
      lastSuccessfulLookupPath,
      maxPolls,
      lastPollPreview: lastPollPayload ? JSON.stringify(lastPollPayload).slice(0, 1200) : null,
      createPreview: lastCreatePayload ? JSON.stringify(lastCreatePayload).slice(0, 1200) : null
    };
    console.error('[start_research] timeout', debugPayload);
    emitSystem('Research timed out before completion', {
      name: 'start_research',
      filename: query,
      status: 'error',
      dropdown: true,
      targetPath: fullPath,
      error: `Timeout after ${maxPolls}s-equivalent polling`,
      newContent: `File: ${link}\nStatus: ${lastStatus || 'unknown'}\nAgent: ${selectedAgent}\nLast path: ${lastSuccessfulLookupPath || 'n/a'}\n\nDebug:\n${JSON.stringify(debugPayload, null, 2)}`
    });
    throw new Error(`Research timed out before completion. Debug: ${JSON.stringify(debugPayload)}`);
  }

  if (finalStatus !== 'completed') {
    const failureDebug = {
      interactionId,
      selectedAgent,
      finalStatus,
      lastSuccessfulLookupPath,
      lastPollPreview: lastPollPayload ? JSON.stringify(lastPollPayload).slice(0, 1200) : null
    };
    console.error('[start_research] terminal failure', failureDebug);
    emitSystem(`Research ended with status: ${finalStatus}`, {
      name: 'start_research',
      filename: query,
      status: 'error',
      dropdown: true,
      targetPath: fullPath,
      error: `Terminal status: ${finalStatus}`,
      newContent: `File: ${link}\nAgent: ${selectedAgent}\nStatus: ${finalStatus}\nPath: ${lastSuccessfulLookupPath || 'n/a'}\n\nDebug:\n${JSON.stringify(failureDebug, null, 2)}`
    });
    await removeDeepResearchInProgress(interactionId);
    throw new Error(`Research ended with status: ${finalStatus}. Debug: ${JSON.stringify(failureDebug)}`);
  }

  const report = getOutputText(finalInteraction);
  const usageFinal = getUsageSnapshot(finalInteraction);
  const tokenCount = usageFinal.total ?? getUsageTokenCount(finalInteraction);
  const elapsedMs = Math.round(performance.now() - startedAt);
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const elapsedHuman = formatElapsedHuman(elapsedSeconds);
  const conclusion = truncate(report || 'Research completed, but no summary text was returned.', 280);

  if (streamFailed) {
    thinkingLines.push('Stream disconnected; completion recovered by polling.');
  }

  const uniqueThinking = uniqueLines(thinkingLines);

  const frontmatter = buildFrontmatter({
    date: nowDate(),
    query,
    shortName,
    longName,
    researchModel: selectedAgent,
    elapsed: elapsedSeconds,
    elapsedHuman,
    tokenCount,
    shortConclusion: conclusion
  });

  const body = [
    frontmatter,
    '',
    '# Research Result',
    '',
    report || 'No detailed report returned.',
    '',
    '---',
    'Train of Thought',
    '---',
    uniqueThinking.length > 0 ? uniqueThinking.map(line => `- ${line}`).join('\n') : '- No thinking stream available.'
  ].join('\n');

  // createFile will fail if placeholder exists, so replace in that case.
  try {
    await createFile(fullPath, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('already exists')) {
      await updateFile(fullPath, body);
    } else {
      throw error;
    }
  }

  console.debug('[start_research] completed', {
    interactionId,
    fullPath,
    elapsedSeconds,
    tokenCount,
    usage: usageFinal
  });

  emitSystem('Research complete', {
    name: 'start_research',
    filename: query,
    status: 'success',
    dropdown: true,
    targetPath: fullPath,
    description: `Saved to ${fullPath}`,
    duration: elapsedMs,
    newContent: [
      `Saved: ${link}`,
      `Conclusion: ${conclusion}`,
      `Elapsed: ${elapsedSeconds}s (${elapsedHuman})`,
      `Token count: ${tokenCount ?? 'n/a'}`,
      usageFinal.input !== null || usageFinal.output !== null
        ? `Token detail: in ${usageFinal.input ?? 0}, out ${usageFinal.output ?? 0}, thoughts ${usageFinal.thoughts ?? 0}, tool ${usageFinal.toolUse ?? 0}`
        : 'Token detail: n/a'
    ].join('\n')
  });
  await removeDeepResearchInProgress(interactionId);
  } finally {
    activeResearchJobs.delete(interactionId);
  }
};

export const declaration = {
  name: 'start_research',
  description: 'Start an asynchronous deep research task and stream progress updates while it runs in the background.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Research query to investigate deeply.' },
      shortName: { type: Type.STRING, description: 'Short human-friendly name for the research file.' },
      longName: { type: Type.STRING, description: 'Long descriptive name for the research result.' }
    },
    required: ['query']
  }
};

export const instruction = `- start_research: Use this when the user asks for async/background research. Start it immediately, then respond exactly: "research started, will get back when the results are in." Do not block waiting for completion.`;

export const resumePendingDeepResearch = async (callbacks: ToolCallbacks): Promise<void> => {
  const items = await loadDeepResearchInProgress();
  if (!items.length) return;

  callbacks.onLog(`Resuming ${items.length} pending deep research task(s)`, 'info');

  for (const item of items) {
    const safeItem: DeepResearchInProgressItem = {
      interactionId: item.interactionId,
      query: item.query,
      shortName: item.shortName,
      longName: item.longName,
      fullPath: item.fullPath,
      agent: item.agent || RESEARCH_AGENT_CANDIDATES[0],
      startedAt: item.startedAt,
      ...(item.toolCallId ? { toolCallId: item.toolCallId } : {})
    };
    const resumeToolId = safeItem.toolCallId || `tool-resume-${safeItem.interactionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    callbacks.onSystem('Recovered pending background research task', {
      name: 'start_research',
      filename: safeItem.query,
      status: 'pending',
      dropdown: true,
      targetPath: safeItem.fullPath,
      id: resumeToolId,
      newContent: `Resuming saved task\nFile: ${toWikiLink(safeItem.fullPath)}\nInteraction: ${safeItem.interactionId}`
    });

    void runBackgroundResearch(safeItem.query, safeItem.shortName, safeItem.longName, callbacks, {
      existingItem: safeItem,
      toolCallId: resumeToolId
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[start_research] failed while resuming', {
        interactionId: safeItem.interactionId,
        query: safeItem.query,
        fullPath: safeItem.fullPath,
        message,
        stack: error instanceof Error ? error.stack : undefined
      });
      callbacks.onSystem(`Failed to resume research: ${message}`, {
        name: 'start_research',
        filename: safeItem.query,
        status: 'error',
        dropdown: true,
        targetPath: safeItem.fullPath,
        id: resumeToolId,
        error: message
      });
    });
  }
};

export const execute = async (args: ToolArgs, callbacks: ToolCallbacks): Promise<{ status: string; query: string }> => {
  const query = getStringArg(args, 'query');
  if (!query) {
    throw new Error('Missing query');
  }

  const shortName = getStringArg(args, 'shortName') || guessShortName(query);
  const longName = getStringArg(args, 'longName') || query;

  callbacks.onSystem('research started, will get back when the results are in.', {
    name: 'start_research',
    filename: query,
    status: 'pending',
    dropdown: true,
    newContent: 'Preparing research stream...'
  });

  void runBackgroundResearch(query, shortName, longName, callbacks).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[start_research] failed', {
      query,
      shortName,
      longName,
      message,
      stack: error instanceof Error ? error.stack : undefined
    });
    callbacks.onSystem(`Research failed: ${message}`, {
      name: 'start_research',
      filename: query,
      status: 'error',
      error: message,
      dropdown: true
    });
  });

  return {
    status: 'started',
    query
  };
};
