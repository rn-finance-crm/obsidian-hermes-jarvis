import type { AppSettings, ArchivedConversation, DeepResearchInProgressItem } from '../types';

const FILES_KEY = 'hermes_os_filesystem';
const SETTINGS_KEY = 'hermes_os_settings';
const CHAT_HISTORY_KEY = 'hermes_os_chat_history';
const ARCHIVED_CONVERSATIONS_KEY = 'hermes_os_archived_conversations';
const DEEP_RESEARCH_IN_PROGRESS_KEY = 'hermes_os_deep_research_in_progress';

const memoryStore = new Map<string, string>();
let cachedSettings: AppSettings | null = null;
let cachedConversations: ArchivedConversation[] | null = null;
let cachedDeepResearchInProgress: DeepResearchInProgressItem[] | null = null;

export const saveFiles = (files: Record<string, string>): Promise<void> => {
  memoryStore.set(FILES_KEY, JSON.stringify(files));
  return Promise.resolve();
};

export const loadFiles = (): Promise<Record<string, string> | null> => {
  const data = memoryStore.get(FILES_KEY);
  if (!data) return Promise.resolve(null);
  try {
    return Promise.resolve(JSON.parse(data) as Record<string, string>);
  } catch (error) {
    console.error('Failed to parse persistent storage', error);
    return Promise.resolve(null);
  }
};

export const saveAppSettings = (settings: AppSettings): Promise<void> => {
  try {
    const toSave = { ...settings };
    cachedSettings = toSave;
    memoryStore.set(SETTINGS_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.error('Failed to save settings', error);
  }
  return Promise.resolve();
};

export const loadAppSettings = (): AppSettings | null => {
  if (cachedSettings) return cachedSettings;

  const data = memoryStore.get(SETTINGS_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as AppSettings;
  } catch (error) {
    console.error('Failed to load settings', error);
    return null;
  }
};

export const loadAppSettingsAsync = (): Promise<AppSettings | null> => {
  return Promise.resolve(loadAppSettings());
};

export const reloadAppSettings = (): Promise<AppSettings | null> => {
  cachedSettings = null;
  return loadAppSettingsAsync();
};

export const saveChatHistory = (history: string[]): Promise<void> => {
  try {
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
    
    memoryStore.set(CHAT_HISTORY_KEY, JSON.stringify(filteredHistory));
  } catch (error) {
    console.error('Failed to save chat history', error);
  }
  return Promise.resolve();
};

export const loadChatHistory = (): string[] => {
  const data = memoryStore.get(CHAT_HISTORY_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data) as string[];
  } catch (error) {
    console.error('Failed to load chat history', error);
    return [];
  }
};

export const saveArchivedConversations = (conversations: ArchivedConversation[]): Promise<void> => {
  try {
    cachedConversations = conversations;
    memoryStore.set(ARCHIVED_CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch (error) {
    console.error('Failed to save archived conversations', error);
  }
  return Promise.resolve();
};

export const loadArchivedConversations = (): Promise<ArchivedConversation[]> => {
  if (cachedConversations) {
    return Promise.resolve(cachedConversations);
  }
  
  const data = memoryStore.get(ARCHIVED_CONVERSATIONS_KEY);
  if (!data) return Promise.resolve([]);
  try {
    cachedConversations = JSON.parse(data) as ArchivedConversation[];
    return Promise.resolve(cachedConversations);
  } catch (error) {
    console.error('Failed to load archived conversations', error);
    return Promise.resolve([]);
  }
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

export const saveDeepResearchInProgress = (items: DeepResearchInProgressItem[]): Promise<void> => {
  try {
    cachedDeepResearchInProgress = items;
    memoryStore.set(DEEP_RESEARCH_IN_PROGRESS_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save deep research in-progress items', error);
  }
  return Promise.resolve();
};

export const loadDeepResearchInProgress = (): Promise<DeepResearchInProgressItem[]> => {
  if (cachedDeepResearchInProgress) {
    return Promise.resolve(cachedDeepResearchInProgress);
  }

  const data = memoryStore.get(DEEP_RESEARCH_IN_PROGRESS_KEY);
  if (!data) return Promise.resolve([]);

  try {
    cachedDeepResearchInProgress = JSON.parse(data) as DeepResearchInProgressItem[];
    return Promise.resolve(cachedDeepResearchInProgress);
  } catch (error) {
    console.error('Failed to load deep research in-progress items', error);
    return Promise.resolve([]);
  }
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
