import { ToolCallbacks } from '../types';
import { readFile, deleteFile, getFolderTree } from '../services/vaultOperations';
import { loadAppSettings } from '../persistence/persistence';

export const declaration = {
  name: 'delete_memory',
  description:
    'Delete a previously saved memory. Use this when the user wants to forget a preference, behavior, or rule.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Title or filename of the memory to delete. Can be the memory title (e.g., "Date Format Preference") or the exact filename.',
      },
    },
    required: ['title'],
  },
};

export const instruction =
  `Use delete_memory when the user explicitly wants to remove a previously saved memory.
Examples:
- User: "Forget the date format preference" → use delete_memory
- User: "Remove the code style memory" → use delete_memory

The tool will search for a matching memory by title and delete it.`;

type ToolArgs = Record<string, unknown>;

const getStringArg = (args: ToolArgs, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
};

const findMemoryFile = async (
  title: string,
  memoryFolder: string
): Promise<string | null> => {
  try {
    const filePaths = getFolderTree(memoryFolder);
    const titleSlug = slugify(title);

    // First try exact filename match
    for (const filePath of filePaths) {
      const filename = filePath.split('/').pop() || filePath;
      if (filename === title || filename === `${title}.md`) {
        return filePath;
      }
    }

    // Then try slug matching
    for (const filePath of filePaths) {
      const filename = filePath.split('/').pop() || filePath;
      if (filename.includes(titleSlug) && filename.endsWith('.md')) {
        return filePath;
      }
    }

    return null;
  } catch (e) {
    // Directory doesn't exist
    return null;
  }
};

export const execute = async (
  args: ToolArgs,
  callbacks: ToolCallbacks
): Promise<unknown> => {
  const title = getStringArg(args, 'title');

  if (!title) {
    throw new Error('Missing required parameter: title');
  }

  try {
    const settings = await loadAppSettings();
    if (!settings.chatHistoryFolder) {
      throw new Error('Chat history folder not configured in settings');
    }

    const memoryFolder = `${settings.chatHistoryFolder}/memory`;
    const filePath = await findMemoryFile(title, memoryFolder);

    if (!filePath) {
      callbacks.onSystemMessage(
        `Memory not found: No memory titled "${title}" exists.`,
        { data: { type: 'memory_not_found', title } }
      );
      return { success: false, message: `Memory "${title}" not found` };
    }

    await deleteFile(filePath);
    const filename = filePath.split('/').pop() || filePath;

    callbacks.onSystemMessage(
      `Memory deleted: "${title}" has been removed.`,
      { data: { type: 'memory_deleted', title, filename } }
    );

    return { success: true, filename, title };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    callbacks.onSystemMessage(`Failed to delete memory: ${message}`, {
      data: { type: 'error', error: message },
    });
    throw error;
  }
};
