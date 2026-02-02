import { readFile, getFolderTree } from '../services/vaultOperations';
import { AppSettings } from '../types';

/**
 * Load all memories from the memory folder and format them for system prompt injection.
 * Returns empty string if no memories exist.
 */
export const loadMemories = async (
  settings: AppSettings
): Promise<string> => {
  
  if (!settings.chatHistoryFolder) {
    return '';
  }

  const memoryFolder = `${settings.chatHistoryFolder}/memory`;

  try {
    let filePaths: string[] = [];
    
    // Try to get folder contents - it may not exist yet
    try {
      filePaths = getFolderTree(memoryFolder);
    } catch {
      // Memory folder doesn't exist yet - that's OK, just return empty
      return '';
    }
    
    const mdFiles = filePaths.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      return '';
    }

    const memories: Array<{ title: string; content: string }> = [];

    for (const filePath of mdFiles) {
      try {
        const fileContent = await readFile(filePath);

        // Parse frontmatter
        const frontmatterMatch = fileContent.match(
          /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
        );
        const filename = filePath.split('/').pop() || filePath;
        let title = filename.replace('.md', '');
        let content = fileContent;

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const body = frontmatterMatch[2];
          content = body.trim();

          // Extract title from frontmatter if available
          const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
        }

        memories.push({ title, content });
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    if (memories.length === 0) {
      return '';
    }

    // Format memories for injection
    const memoriesText = memories
      .map((m) => `- ${m.title}: ${m.content}`)
      .join('\n');

    const result = `USER_MEMORIES:\n${memoriesText}`;
      return result;
  } catch (e) {
    // Unexpected error - log it but don't crash
    console.error('Error loading memories:', e);
    return '';
  }
};
