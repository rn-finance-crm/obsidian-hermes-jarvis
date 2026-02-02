import { ToolCallbacks } from '../types';
import { readFile, createFile, updateFile, createDirectory, getFolderTree } from '../services/vaultOperations';
import { loadAppSettings } from '../persistence/persistence';

export const declaration = {
  name: 'save_memory',
  description:
    'Save or update a persistent memory that will be loaded in future sessions. Use this when the user specifies preferences, behaviors, rules, or future instructions they want Hermes to remember.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Short descriptive title for this memory (e.g., "Date Format Preference", "Code Style"). Used as filename slug.',
      },
      content: {
        type: 'string',
        description:
          'The full behavior, preference, or instruction to remember. Should be concise but complete.',
      },
    },
    required: ['title', 'content'],
  },
};

export const instruction =
  `Use save_memory when the user explicitly states a preference, behavior, or rule they want you to remember for future sessions.
Examples:
- User: "Always format dates as YYYY-MM-DD" → save_memory with title="Date Format" and content="Always format dates as YYYY-MM-DD"
- User: "I prefer markdown code blocks with syntax highlighting" → save_memory with title="Code Block Format"
- User: "When I ask for summaries, make them bullet-pointed and concise" → save_memory with title="Summary Format"

If a memory with the same title already exists, it will be updated (not duplicated).`;

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

const generateMemoryFilename = (title: string): string => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const slug = slugify(title);
  return `${dateStr}-${slug}.md`;
};

const readExistingMemories = async (
  memoryFolder: string
): Promise<Map<string, string>> => {
  try {
    const files = getFolderTree(memoryFolder);
    const memories = new Map<string, string>();

    for (const filePath of files) {
      if (filePath.endsWith('.md')) {
        try {
          const content = await readFile(filePath);
          const filename = filePath.split('/').pop() || filePath;
          memories.set(filename, content);
        } catch (e) {
          // File read error, skip
        }
      }
    }

    return memories;
  } catch (e) {
    // Directory doesn't exist yet or read error
    return new Map();
  }
};

const findMatchingMemory = (
  title: string,
  existingMemories: Map<string, string>
): string | null => {
  const titleLower = title.toLowerCase();

  for (const filename of existingMemories.keys()) {
    // Check if filename contains the slugified title
    const slug = slugify(title);
    if (filename.includes(slug)) {
      return filename;
    }
  }

  return null;
};

export const execute = async (
  args: ToolArgs,
  callbacks: ToolCallbacks
): Promise<unknown> => {
  const title = getStringArg(args, 'title');
  const content = getStringArg(args, 'content');

  if (!title) {
    throw new Error('Missing required parameter: title');
  }
  if (!content) {
    throw new Error('Missing required parameter: content');
  }

  try {
    const settings = await loadAppSettings();
    if (!settings.chatHistoryFolder) {
      throw new Error('Chat history folder not configured in settings');
    }

    const memoryFolder = `${settings.chatHistoryFolder}/memory`;

    // Ensure memory folder exists
    try {
      await createDirectory(memoryFolder);
    } catch (e) {
      // Folder might already exist, continue
    }

    // Read existing memories
    const existingMemories = await readExistingMemories(memoryFolder);
    const existingFile = findMatchingMemory(title, existingMemories);

    // Generate filename
    const filename = existingFile || generateMemoryFilename(title);
    const filePath = `${memoryFolder}/${filename}`;

    // Create memory content with frontmatter
    const now = new Date().toISOString();
    const memoryContent = `---
created: ${now}
title: ${title}
---
${content}`;

    // Save file
    if (existingFile) {
      await updateFile(filePath, memoryContent);
      callbacks.onSystemMessage(
        `Memory updated: "${title}" has been updated with new content.`,
        { data: { type: 'memory_updated', title, filename } }
      );
    } else {
      await createFile(filePath, memoryContent);
      callbacks.onSystemMessage(
        `Memory saved: "${title}" will be remembered for future sessions.`,
        { data: { type: 'memory_saved', title, filename } }
      );
    }

    return { success: true, filename, title };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    callbacks.onSystemMessage(`Failed to save memory: ${message}`, {
      data: { type: 'error', error: message },
    });
    throw error;
  }
};
