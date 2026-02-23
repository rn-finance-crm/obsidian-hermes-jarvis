import type { Plugin } from 'obsidian';
import type { AppSettings, ArchivedConversation, DeepResearchInProgressItem } from '../types';
import * as localStoragePersistence from '../persistence/persistence-local-storage';
import * as obsidianPersistence from '../persistence/persistence-obsidian';

let useObsidian = false;

export const setObsidianPlugin = (plugin: Plugin) => {
  useObsidian = true;
  obsidianPersistence.setObsidianPlugin(plugin);
};

export const getObsidianPlugin = (): Plugin | null => {
  return obsidianPersistence.getObsidianPlugin();
};

export const saveFiles = async (files: Record<string, string>): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.saveFiles(files);
  }
  return localStoragePersistence.saveFiles(files);
};

export const loadFiles = async (): Promise<Record<string, string> | null> => {
  if (useObsidian) {
    return obsidianPersistence.loadFiles();
  }
  return localStoragePersistence.loadFiles();
};

export const saveAppSettings = async (settings: AppSettings): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.saveAppSettings(settings);
  }
  return localStoragePersistence.saveAppSettings(settings);
};

export const loadAppSettings = (): AppSettings | null => {
  if (useObsidian) {
    return obsidianPersistence.loadAppSettings();
  }
  return localStoragePersistence.loadAppSettings();
};

export const loadAppSettingsAsync = async (): Promise<AppSettings | null> => {
  if (useObsidian) {
    return obsidianPersistence.loadAppSettingsAsync();
  }
  return localStoragePersistence.loadAppSettingsAsync();
};

export const reloadAppSettings = async (): Promise<AppSettings | null> => {
  if (useObsidian) {
    return obsidianPersistence.reloadAppSettings();
  }
  return localStoragePersistence.reloadAppSettings();
};

export const saveChatHistory = async (history: string[]): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.saveChatHistory(history);
  }
  return localStoragePersistence.saveChatHistory(history);
};

export const loadChatHistory = (): string[] => {
  if (useObsidian) {
    return obsidianPersistence.loadChatHistory();
  }
  return localStoragePersistence.loadChatHistory();
};

export const saveArchivedConversations = async (conversations: ArchivedConversation[]): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.saveArchivedConversations(conversations);
  }
  return localStoragePersistence.saveArchivedConversations(conversations);
};

export const loadArchivedConversations = async (): Promise<ArchivedConversation[]> => {
  if (useObsidian) {
    return obsidianPersistence.loadArchivedConversations();
  }
  return localStoragePersistence.loadArchivedConversations();
};

export const addArchivedConversation = async (conversation: ArchivedConversation): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.addArchivedConversation(conversation);
  }
  return localStoragePersistence.addArchivedConversation(conversation);
};

export const deleteArchivedConversation = async (key: string): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.deleteArchivedConversation(key);
  }
  return localStoragePersistence.deleteArchivedConversation(key);
};

export const saveDeepResearchInProgress = async (items: DeepResearchInProgressItem[]): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.saveDeepResearchInProgress(items);
  }
  return localStoragePersistence.saveDeepResearchInProgress(items);
};

export const loadDeepResearchInProgress = async (): Promise<DeepResearchInProgressItem[]> => {
  if (useObsidian) {
    return obsidianPersistence.loadDeepResearchInProgress();
  }
  return localStoragePersistence.loadDeepResearchInProgress();
};

export const addDeepResearchInProgress = async (item: DeepResearchInProgressItem): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.addDeepResearchInProgress(item);
  }
  return localStoragePersistence.addDeepResearchInProgress(item);
};

export const removeDeepResearchInProgress = async (interactionId: string): Promise<void> => {
  if (useObsidian) {
    return obsidianPersistence.removeDeepResearchInProgress(interactionId);
  }
  return localStoragePersistence.removeDeepResearchInProgress(interactionId);
};
