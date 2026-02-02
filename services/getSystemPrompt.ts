import { AppSettings } from '../types';
import { loadMemories } from '../utils/loadMemories';
import { getActiveFileInfo } from '../utils/environment';
import { loadAppSettingsAsync } from '../persistence/persistence';

export type InterfaceType = 'voice' | 'text';

export interface ContextParams {
  settings: AppSettings;
  currentFolder: string;
  currentNote: string | null;
  interfaceType: InterfaceType;
  conversationHistory?: string;
}

export interface ContextResult {
  systemInstruction: string;
  contextSummary: string;
}

/**
 * Build the full system instruction context for both voice and text interfaces.
 * Returns both the system instruction and a human-readable summary for initialization messages.
 */
export async function getSystemPrompt(params: ContextParams): Promise<ContextResult> {

  const { settings, currentFolder: fallbackFolder, currentNote: fallbackNote, interfaceType, conversationHistory } = params;

  // Get live active file from Obsidian (falls back to passed values if not in Obsidian)
  const liveInfo = getActiveFileInfo();
  const currentFolder = liveInfo.currentFolder || fallbackFolder;
  const currentNote = liveInfo.currentNote || fallbackNote;

  // Build current context section
  const contextString = `
CURRENT_CONTEXT:
Current Folder Path: ${currentFolder}
Current Note Name: ${currentNote || 'No note currently selected'}
`;


  // Load chatHistoryFolder directly from plugin settings (not from passed settings)
  const pluginSettings = await loadAppSettingsAsync();
  const chatHistoryFolder = pluginSettings?.chatHistoryFolder;

  // Merge chatHistoryFolder into settings for loadMemories
  const settingsWithChatHistory: AppSettings = {
    ...settings,
    chatHistoryFolder
  };

  const memoriesSection = await loadMemories(settingsWithChatHistory);

  // Build conversation history section (voice only, for reconnects)
  const historySection = conversationHistory ? `\n\nPREVIOUS_CONVERSATION:\n${conversationHistory}\n` : '';

  // Build memories injection
  const memoriesInjection = memoriesSection ? `\n\n${memoriesSection}\n` : '';

  // Assemble final system instruction
  const systemInstruction = `${settings.systemInstruction}\n${contextString}${memoriesInjection}${historySection}\n${settings.customContext}`.trim();


  // Build human-readable summary for initialization message
  const summaryParts: string[] = [];
  summaryParts.push(`**Interface**: ${interfaceType}`);
  summaryParts.push(`**Folder**: \`${currentFolder}\``);
  summaryParts.push(`**Note**: ${currentNote ? `\`${currentNote}\`` : '_none_'}`);
  
  if (memoriesSection) {
    const memoryCount = (memoriesSection.match(/^- /gm) || []).length;
    summaryParts.push(`**Memories**: ${memoryCount} loaded`);
  } else {
    summaryParts.push(`**Memories**: _none_`);
  }

  if (settings.customContext) {
    summaryParts.push(`**Custom context**: ${settings.customContext.length} chars`);
  }

  if (conversationHistory) {
    summaryParts.push(`**Previous conversation**: restored`);
  }

  summaryParts.push(`**Total context size**: ${systemInstruction.length} chars`);

  const contextSummary = summaryParts.join('\n');

  return {
    systemInstruction,
    contextSummary
  };
}
