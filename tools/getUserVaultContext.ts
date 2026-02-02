import { Type } from '@google/genai';
import { MarkdownView, getAllTags } from 'obsidian';
import { getObsidianApp } from '../utils/environment';
import { loadAppSettings, loadChatHistory, loadArchivedConversations } from '../persistence/persistence';
import { getVaultFiles, getFolderTree } from '../services/vaultOperations';
import type { ToolCallbacks } from '../types';

type ToolArgs = Record<string, unknown>;

interface RecentFile {
  path: string;
  name: string;
  modified: string;
  size: string;
}

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

const getNumberArg = (args: ToolArgs, key: string, fallback?: number): number | undefined => {
  const value = args[key];
  if (typeof value === 'number') return value;
  return fallback;
};

export const declaration = {
  name: 'get_user_vault_context',
  description: 'Provides comprehensive context about the current Obsidian environment including current note, folder, opened files, chat history, recent files, directory structure, and most used tags.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      includeHistory: { 
        type: Type.BOOLEAN, 
        description: 'Include chat history in context (default: true)' 
      },
      historyLimit: { 
        type: Type.NUMBER, 
        description: 'Number of recent chat messages to include (default: 10)' 
      },
      includeRecentFiles: { 
        type: Type.BOOLEAN, 
        description: 'Include recently edited files (default: true)' 
      },
      recentFilesLimit: { 
        type: Type.NUMBER, 
        description: 'Number of recent files to include (default: 15)' 
      },
      includeDirectoryStructure: { 
        type: Type.BOOLEAN, 
        description: 'Include directory structure up to 2 levels (default: true)' 
      },
      includeTags: { 
        type: Type.BOOLEAN, 
        description: 'Include most used tags from vault (default: true)' 
      },
      tagsLimit: { 
        type: Type.NUMBER, 
        description: 'Number of most used tags to include (default: 30)' 
      }
    }
  }
};

export const instruction = `- get_user_vault_context: Use this to get comprehensive context about the current Obsidian environment including current note, folder, opened files, chat history, recent files, directory structure, and most used tags.`;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const getMostUsedTags = (limit: number = 30): Array<{ tag: string; count: number }> => {
  const app = getObsidianApp();
  if (!app?.vault) return [];

  const tagCounts = new Map<string, number>();
  const files = app.vault.getMarkdownFiles();

  // Collect tags from all files
  files.forEach(file => {
    const cache = app.metadataCache.getFileCache(file);
    if (cache) {
      const tags = getAllTags(cache);
      if (tags) {
        tags.forEach(tag => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      }
    }
  });

  // Sort by count and return top tags
  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

const getDirectoryStructure = (folders: string[], maxDepth: number = 2): string[] => {
  const structure: string[] = [];
  const processed = new Set<string>();
  
  folders
    .filter(folder => folder !== '')
    .sort()
    .forEach(folder => {
      const parts = folder.split('/');
      if (parts.length <= maxDepth) {
        if (!processed.has(folder)) {
          structure.push(`📁 ${folder}/`);
          processed.add(folder);
        }
      }
    });
  
  return structure;
};

export const execute = async (args: ToolArgs, callbacks: ToolCallbacks): Promise<unknown> => {
  const app = getObsidianApp();
  
  if (!app || !app.workspace) {
    callbacks.onSystem('Error: Not running in Obsidian or workspace unavailable', {
      name: 'get_user_vault_context',
      filename: 'Context',
      error: 'Obsidian workspace not available'
    });
    return Promise.resolve({ error: 'Obsidian workspace not available' });
  }

  try {
    const includeHistory = getStringArg(args, 'includeHistory') !== 'false';
    const historyLimit = getNumberArg(args, 'historyLimit', 10) ?? 10;
    const includeRecentFiles = getStringArg(args, 'includeRecentFiles') !== 'false';
    const recentFilesLimit = getNumberArg(args, 'recentFilesLimit', 15) ?? 15;
    const includeDirectoryStructure = getStringArg(args, 'includeDirectoryStructure') !== 'false';
    const includeTags = getStringArg(args, 'includeTags') !== 'false';
    const tagsLimit = getNumberArg(args, 'tagsLimit', 30) ?? 30;

    const workspace = app.workspace;
    const settings = loadAppSettings();
    
    // Get current file and folder information
    const activeFile = workspace.getActiveFile();
    const currentNote = activeFile?.path || settings?.currentNote || null;
    const currentFolder = activeFile?.parent?.path || settings?.currentFolder || '/';
    
    // Get opened files and workspace information
    const lastOpenFiles = workspace.getLastOpenFiles();
    const openLeaves = workspace.getLeavesOfType('markdown');
    const openedFiles = openLeaves
      .map(leaf => (leaf.view as MarkdownView)?.file?.path)
      .filter((path): path is string => !!path)
      .filter((path, index, arr) => arr.indexOf(path) === index); // Remove duplicates

    // Get recent files
    let recentFiles: RecentFile[] = [];
    if (includeRecentFiles) {
      const vaultFilesResult = await getVaultFiles({ 
        limit: recentFilesLimit, 
        sortBy: 'mtime', 
        sortOrder: 'desc' 
      });
      recentFiles = vaultFilesResult.files.map(file => ({
        path: file.path,
        name: file.name,
        modified: formatDate(file.mtime),
        size: formatFileSize(file.size)
      }));
    }

    // Get chat history
    let chatHistory: string[] = [];
    if (includeHistory) {
      const history = loadChatHistory();
      chatHistory = history.slice(-historyLimit);
    }

    // Get archived conversations summary
    const archivedConversations = await loadArchivedConversations();
    const archivedSummary = archivedConversations.slice(0, 5).map(conv => ({
      key: conv.key,
      summary: conv.summary,
      archivedAt: formatDate(conv.archivedAt)
    }));

    // Get directory structure
    let directoryStructure: string[] = [];
    if (includeDirectoryStructure) {
      const folders = getFolderTree();
      directoryStructure = getDirectoryStructure(folders, 2);
    }

    // Get most used tags
    let mostUsedTags: Array<{ tag: string; count: number }> = [];
    if (includeTags) {
      mostUsedTags = getMostUsedTags(tagsLimit);
    }

    // Get vault statistics
    const allVaultFiles = await getVaultFiles({ limit: 1000 });
    const totalFiles = allVaultFiles.total;
    const totalSize = allVaultFiles.files.reduce((sum, file) => sum + file.size, 0);

    // Compile context information
    const contextInfo = {
      // Current state
      currentNote,
      currentFolder,
      
      // Workspace information
      workspace: {
        openedFiles,
        lastOpenFiles: lastOpenFiles.slice(0, 10),
        totalOpenFiles: openedFiles.length
      },
      
      // Recent files
      recentFiles: recentFiles.slice(0, recentFilesLimit),
      
      // Chat history
      chatHistory: {
        messages: chatHistory,
        totalMessages: chatHistory.length
      },
      
      // Archived conversations
      archivedConversations: archivedSummary,
      totalArchived: archivedConversations.length,
      
      // Directory structure
      directoryStructure,
      
      // Tags
      tags: {
        mostUsed: mostUsedTags,
        totalTags: mostUsedTags.length
      },
      
      // Vault statistics
      vault: {
        totalFiles,
        totalSize: formatFileSize(totalSize),
        totalFolders: directoryStructure.length
      }
    };

    // Format the display output
    const displaySections = [
      `**📍 Current Location**`,
      currentNote ? `📄 Note: \`${currentNote}\`` : '📄 No active note',
      `📁 Folder: \`${currentFolder}\``,
      '',
      
      `**🖥️ Workspace State**`,
      `📂 Open Files: ${openedFiles.length}`,
      ...openedFiles.slice(0, 5).map(file => `  • \`${file}\``),
      openedFiles.length > 5 ? `  • ... and ${openedFiles.length - 5} more` : '',
      '',
      
      `**⏰ Recently Edited Files**`,
      ...recentFiles.slice(0, 8).map(file => 
        `  • \`${file.name}\` - ${file.modified} (${file.size})`
      ),
      recentFiles.length > 8 ? `  • ... and ${recentFiles.length - 8} more` : '',
      '',
      
      `**💬 Chat Activity**`,
      `📊 Recent messages: ${chatHistory.length}`,
      ...chatHistory.slice(0, 3).map(msg => `  • "${msg.substring(0, 60)}${msg.length > 60 ? '...' : ''}"`),
      chatHistory.length > 3 ? `  • ... and ${chatHistory.length - 3} more` : '',
      `📦 Archived conversations: ${archivedConversations.length}`,
      '',
      
      `**📂 Directory Structure (2 levels)**`,
      ...directoryStructure.slice(0, 15),
      directoryStructure.length > 15 ? `  • ... and ${directoryStructure.length - 15} more folders` : '',
      '',
      
      `**🏷️ Most Used Tags**`,
      `📊 Total tags found: ${mostUsedTags.length}`,
      ...mostUsedTags.slice(0, 10).map(tagInfo => `  • ${tagInfo.tag} (${tagInfo.count} uses)`),
      mostUsedTags.length > 10 ? `  • ... and ${mostUsedTags.length - 10} more tags` : '',
      '',
      
      `**📊 Vault Statistics**`,
      `📄 Total files: ${totalFiles}`,
      `📁 Total folders: ${directoryStructure.length}`,
      `💾 Total size: ${formatFileSize(totalSize)}`
    ];

    const displayText = displaySections.join('\n');

    callbacks.onSystem('Context information retrieved', {
      name: 'get_user_vault_context',
      filename: 'Environment Context',
      status: 'success',
      displayFormat: displayText,
      dropdown: true,
      contextInfo
    });

    return Promise.resolve(contextInfo);
    
  } catch (error) {
    console.error('Context tool error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    callbacks.onSystem('Error retrieving context information', {
      name: 'get_user_vault_context',
      filename: 'Context',
      status: 'error',
      error: errorMessage
    });
    return Promise.resolve({ error: errorMessage });
  }
};
