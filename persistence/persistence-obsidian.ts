import type { Plugin } from 'obsidian';
import type { AppSettings, ArchivedConversation, DeepResearchInProgressItem } from '../types';

let obsidianPlugin: Plugin | null = null;
let cachedSettings: AppSettings | null = null;
let cachedConversations: ArchivedConversation[] | null = null;
let cachedDeepResearchInProgress: DeepResearchInProgressItem[] | null = null;

// Mutex lock to prevent concurrent writes
let persistLock: Promise<void> = Promise.resolve();

/**
 * Central persistence function that ensures atomic read-modify-write.
 * All writes go through this to prevent race conditions.
 * @param updater Function that receives current data and returns updated data
 */
export const persistData = async (updater: (currentData: Record<string, unknown>) => Record<string, unknown>): Promise<void> => {
  // Chain onto the existing lock to serialize all writes
  const previousLock = persistLock;
  let releaseLock: () => void;
  persistLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    await previousLock;
    
    if (!obsidianPlugin) {
      console.warn('persistData called without obsidianPlugin');
      return;
    }

    const currentData = (await obsidianPlugin.loadData()) || {};
    const nextData = updater(currentData);
    await obsidianPlugin.saveData(nextData);
  } catch (error) {
    console.error('Failed to persist data', error);
  } finally {
    releaseLock();
  }
};

export const setObsidianPlugin = (plugin: Plugin) => {
  obsidianPlugin = plugin;
};

export const getObsidianPlugin = (): Plugin | null => obsidianPlugin;

export const saveFiles = (_files: Record<string, string>): Promise<void> => {
  // For Obsidian, we could use the vault API in the future
  // For now, this is a placeholder that does nothing since files are managed by Obsidian
  console.warn('saveFiles called in Obsidian mode - files are managed by Obsidian vault');
  return Promise.resolve();
};

export const loadFiles = (): Promise<Record<string, string> | null> => {
  // For Obsidian, files are managed by the vault
  // Return null to indicate no local file storage
  return Promise.resolve(null);
};

export const saveAppSettings = async (settings: AppSettings): Promise<void> => {
  const toSave = { ...settings };
  cachedSettings = toSave;
  
  await persistData((currentData) => ({
    ...currentData,
    ...toSave
  }));
};

export const loadAppSettings = (): AppSettings | null => {
  if (cachedSettings) return cachedSettings;
  return null;
};

export const loadAppSettingsAsync = async (): Promise<AppSettings | null> => {
  if (obsidianPlugin) {
    try {
      const data = await obsidianPlugin.loadData();
      cachedSettings = (data || {}) as AppSettings;
      
      // If plugin has its own settings, merge them
      const pluginSettings = (obsidianPlugin as { settings?: AppSettings }).settings;
      if (pluginSettings) {
        cachedSettings = { ...cachedSettings, ...pluginSettings };
      }
      
      return cachedSettings;
    } catch (error) {
      console.error('Failed to load settings from Obsidian', error);
      return null;
    }
  }
  
  return null;
};

export const reloadAppSettings = async (): Promise<AppSettings | null> => {
  // Clear cache and reload from Obsidian
  cachedSettings = null;
  return await loadAppSettingsAsync();
};

export const saveChatHistory = async (history: string[]): Promise<void> => {
  // Filter out AI tags like <noise> and <ctrl46>
  const aiTagBlacklist = ['<noise>', '<ctrl46>'];
  const filteredHistory = history.map(message => {
    let filteredMessage = message;
    aiTagBlacklist.forEach(tag => {
      const regex = new RegExp(tag, 'gi');
      filteredMessage = filteredMessage.replace(regex, '');
    });
    return filteredMessage.trim();
  });
  
  await persistData((currentData) => ({
    ...currentData,
    chatHistory: filteredHistory
  }));
};

export const loadChatHistory = (): string[] => {
  if (cachedSettings?.chatHistory) {
    return cachedSettings.chatHistory;
  }
  return [];
};

export const saveArchivedConversations = async (conversations: ArchivedConversation[]): Promise<void> => {
  cachedConversations = conversations;
  
  await persistData((currentData) => ({
    ...currentData,
    archivedConversations: conversations
  }));
};

export const loadArchivedConversations = async (): Promise<ArchivedConversation[]> => {
  if (cachedConversations) {
    return cachedConversations;
  }
  
  if (obsidianPlugin) {
    try {
      const data = await obsidianPlugin.loadData();
      cachedConversations = data?.archivedConversations || [];
      return cachedConversations;
    } catch (error) {
      console.error('Failed to load archived conversations', error);
      return [];
    }
  }
  
  return [];
};

export const addArchivedConversation = async (conversation: ArchivedConversation): Promise<void> => {
  const existing = await loadArchivedConversations();
  const updated = [...existing, conversation];
  await saveArchivedConversations(updated);
};

export const deleteArchivedConversation = async (key: string): Promise<void> => {
  const existing = await loadArchivedConversations();
  const updated = existing.filter(conv => conv.key !== key);
  await saveArchivedConversations(updated);
};

export const saveDeepResearchInProgress = async (items: DeepResearchInProgressItem[]): Promise<void> => {
  cachedDeepResearchInProgress = items;

  await persistData((currentData) => ({
    ...currentData,
    deepResearchInProgress: items
  }));
};

export const loadDeepResearchInProgress = async (): Promise<DeepResearchInProgressItem[]> => {
  if (cachedDeepResearchInProgress) {
    return cachedDeepResearchInProgress;
  }

  if (obsidianPlugin) {
    try {
      const data = await obsidianPlugin.loadData();
      cachedDeepResearchInProgress = data?.deepResearchInProgress || [];
      return cachedDeepResearchInProgress;
    } catch (error) {
      console.error('Failed to load deep research in-progress items', error);
      return [];
    }
  }

  return [];
};

export const addDeepResearchInProgress = async (item: DeepResearchInProgressItem): Promise<void> => {
  const existing = await loadDeepResearchInProgress();
  const updated = existing.filter(entry => entry.interactionId !== item.interactionId);
  updated.push(item);
  await saveDeepResearchInProgress(updated);
};

export const removeDeepResearchInProgress = async (interactionId: string): Promise<void> => {
  const existing = await loadDeepResearchInProgress();
  const updated = existing.filter(entry => entry.interactionId !== interactionId);
  await saveDeepResearchInProgress(updated);
};
