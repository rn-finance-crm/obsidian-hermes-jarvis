import { ToolData } from '../types';

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/** Map tool names to human-readable action labels */
const TOOL_LABELS: Record<string, string> = {
  'generate_image_from_context': 'Image Generation',
  'create_file': 'File Creation',
  'delete_file': 'File Deletion',
  'edit_file': 'File Editing',
  'update_file': 'File Update',
  'move_file': 'File Move',
  'rename_file': 'File Rename',
  'create_directory': 'Directory Creation',
  'list_directory': 'Vault Scan',
  'list_vault_files': 'File Explorer',
  'dirlist': 'Directory Structure',
  'get_folder_tree': 'Folder Tree',
  'read_file': 'File Reading',
  'search_vault': 'Vault Search',
  'search_regexp': 'Pattern Search',
  'search_replace_file': 'File Search & Replace',
  'search_replace_global': 'Global Search & Replace',
  'internet_search': 'Web Search',
  'reveal_active_pane': 'Active Pane Info',
  'open_folder_in_system': 'System File Browser',
  'end_conversation': 'Session End',
  'topic_switch': 'Topic Switch'
};

/** Get the human-readable label for a tool name */
export function getToolActionName(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName.replace(/_/g, ' ').toUpperCase();
}

/** Get the filename label to display for a tool call */
export function getToolFilenameLabel(toolName: string, args: ToolArgs): string {
  return getStringArg(args, 'filename') || (toolName === 'internet_search' ? 'Web' : 'Registry');
}

/** Generate a unique tool call ID */
export function generateToolCallId(): string {
  return `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build the completion ToolData after a tool finishes executing.
 * Returns null if no meaningful display content can be derived (tool already updated its own message).
 */
export function buildToolCompletionData(
  toolName: string,
  args: ToolArgs,
  response: unknown,
  toolCallId: string,
  filenameLabel: string
): { text: string; toolData: ToolData } | null {
  const responseRecord = isRecord(response) ? response : undefined;
  const responseText = responseRecord && typeof responseRecord.text === 'string' ? responseRecord.text : undefined;

  let displayContent = '';
  if (toolName === 'create_file' || toolName === 'create_directory') {
    const path = getStringArg(args, 'filename') || getStringArg(args, 'path');
    if (path) {
      const lastSlashIndex = path.lastIndexOf('/');
      const containingFolder = lastSlashIndex === -1 ? '/' : path.substring(0, lastSlashIndex + 1);
      displayContent = `Created in: ${containingFolder}`;
    }
  } else if (toolName === 'move_file' || toolName === 'rename_file') {
    const sourcePath = getStringArg(args, 'sourcePath') || getStringArg(args, 'oldPath');
    const targetPath = getStringArg(args, 'targetPath') || getStringArg(args, 'newPath');
    if (sourcePath && targetPath) {
      displayContent = `Moved from: ${sourcePath} to: ${targetPath}`;
    }
  } else if (toolName === 'update_file' || toolName === 'edit_file') {
    const filename = getStringArg(args, 'filename');
    if (filename) {
      displayContent = `Updated: ${filename}`;
    }
  } else if (toolName === 'delete_file') {
    const filename = getStringArg(args, 'filename');
    if (filename) {
      displayContent = `Deleted: ${filename}`;
    }
  } else if (responseText) {
    displayContent = responseText;
  } else if (typeof response === 'string') {
    displayContent = response;
  }

  if (!displayContent) return null;

  const groundingChunks = Array.isArray(responseRecord?.groundingChunks) ? responseRecord?.groundingChunks : [];
  const responseFiles = Array.isArray(responseRecord?.files)
    ? responseRecord?.files.filter((file): file is string => typeof file === 'string')
    : undefined;
  const responseDirectories = Array.isArray(responseRecord?.directories)
    ? responseRecord?.directories
        .map((dir) => (isRecord(dir) && typeof dir.path === 'string' ? dir.path : null))
        .filter((path): path is string => Boolean(path))
    : undefined;
  const responseFolders = Array.isArray(responseRecord?.folders)
    ? responseRecord?.folders.filter((folder): folder is string => typeof folder === 'string')
    : undefined;
  const directoryInfo = Array.isArray(responseRecord?.directoryInfo) ? responseRecord?.directoryInfo : undefined;

  const actionName = getToolActionName(toolName);

  return {
    text: `${actionName} Complete`,
    toolData: {
      id: toolCallId,
      name: toolName,
      filename: filenameLabel,
      status: 'success',
      newContent: displayContent,
      groundingChunks,
      files: responseFiles || responseDirectories || responseFolders,
      directoryInfo
    }
  };
}
