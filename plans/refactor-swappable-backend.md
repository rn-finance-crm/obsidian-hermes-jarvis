# Refactor: Swappable Backend - Direct Vault Access Violations

## Summary

Several tools bypass the abstraction layers (`persistence.ts` and `vaultOperations.ts`) and directly access Obsidian's `app.vault` API. This prevents the app from running in standalone mode or with alternative backends.

## Architecture Reminder

```
Tools → vaultOperations.ts → Obsidian API (app.vault)
Tools → persistence.ts → Settings/Data storage
```

**Good pattern** (e.g., `create_file.ts`):
```typescript
import { createFile } from '../services/vaultOperations';
// Uses abstraction layer
await createFile(filename, content);
```

**Bad pattern** (direct access):
```typescript
const app = getObsidianApp();
await app.vault.adapter.writeBinary(filePath, buffer);
```

---

## Violations Found

### 1. `tools/download_image.ts`

**Lines with direct access:**
- Line 40: `app.vault` check
- Line 64: `app.workspace.getActiveFile()`
- Line 75: `app.vault.adapter.exists()`
- Line 76: `app.vault.createFolder()`
- Line 147: `app.vault.adapter.writeBinary()`

**Required changes:**
- Add `createBinaryFile()` to vaultOperations (already exists)
- Add `folderExists()` and `ensureFolder()` to vaultOperations
- Add `getActiveFilePath()` to vaultOperations or environment utils
- Replace direct calls with abstraction layer

---

### 2. `tools/image_search.ts`

**Lines with direct access:**
- Line 44-46: `app.vault` check
- Line 80: `app.workspace.getActiveFile()`
- Line 91: `app.vault.adapter.exists()`
- Line 92: `app.vault.createFolder()`
- Line 188-194: `app.setting.open()` (opens Obsidian settings)
- Line 327: `app.vault.adapter.writeBinary()`

**Required changes:**
- Same as download_image.ts
- Add `openPluginSettings()` to environment utils (Obsidian-only, graceful no-op in standalone)

---

### 3. `tools/list_trash.ts`

**Lines with direct access:**
- Line 28-30: `app.vault` check
- Line 55: `app.vault.getAbstractFileByPath()`
- Line 67: `app.vault.getMarkdownFiles()`

**Required changes:**
- Add `listTrashFiles()` to vaultOperations
- Move trash folder logic into vaultOperations

---

### 4. `tools/restore_from_trash.ts`

**Lines with direct access:**
- Line 30-32: `app.vault` check
- Line 68: `app.vault.getAbstractFileByPath()`
- Line 93-96: `app.vault.getAbstractFileByPath()` + `app.vault.createFolder()`
- Line 101: `app.vault.getAbstractFileByPath()`
- Line 118: `app.fileManager.renameFile()`

**Required changes:**
- Add `restoreFromTrash()` to vaultOperations
- Add `fileExists()` to vaultOperations
- Use existing `moveFile()` from vaultOperations

---

### 5. `tools/open_folder_in_system.ts`

**Lines with direct access:**
- Line 20-22: `app.vault` check
- Line 33: `app.vault`
- Line 40: `vault.adapter.getBasePath()`
- Line 44: `vault.getAbstractFileByPath()`
- Line 59-65: `vault.adapter.getFullPath()`
- Line 72-79: `app.vault.adapter.openPath()` / `app.openWithDefaultApp()`

**Required changes:**
- Add `getVaultBasePath()` to vaultOperations
- Add `getFullSystemPath()` to vaultOperations
- Add `openInSystemExplorer()` to environment utils (Obsidian-only feature)

---

### 6. `tools/context.ts`

**Lines with direct access:**
- Line 79-96: `app.vault.getMarkdownFiles()` + `app.metadataCache.getFileCache()`
- Line 126-128: `app.workspace` check
- Line 146: `app.workspace`
- Line 150-152: `workspace.getActiveFile()`
- Line 155-160: `workspace.getLastOpenFiles()` + `workspace.getLeavesOfType()`

**Required changes:**
- Add `getAllTags()` to vaultOperations
- Add workspace info getters to environment utils:
  - `getActiveFilePath()`
  - `getOpenFilePaths()`
  - `getLastOpenFilePaths()`

---

## vaultOperations.ts - Also Has Direct Access

Note: `vaultOperations.ts` itself uses `getObsidianApp()` directly. This is **acceptable** as it's the designated abstraction layer. However, for true backend swappability, this file would need a backend interface:

```typescript
interface VaultBackend {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  // etc.
}
```

---

## Recommended Refactor Order

1. **Add missing functions to vaultOperations.ts:**
   - `folderExists(path: string): Promise<boolean>`
   - `ensureFolderExists(path: string): Promise<void>`
   - `fileExists(path: string): boolean`
   - `listTrashFiles(): Promise<TrashFileInfo[]>`
   - `restoreFromTrash(trashPath: string, targetPath: string): Promise<void>`
   - `getVaultBasePath(): string`
   - `getFullSystemPath(relativePath: string): string`
   - `getAllVaultTags(): Map<string, number>`

2. **Add workspace helpers to environment.ts:**
   - `getActiveFilePath(): string | null`
   - `getOpenFilePaths(): string[]`
   - `getLastOpenFilePaths(limit?: number): string[]`
   - `openInSystemExplorer(path: string): Promise<void>`
   - `openPluginSettings(): void`

3. **Update tools to use abstractions** (in order of complexity):
   - `list_trash.ts` (simple)
   - `restore_from_trash.ts` (medium)
   - `download_image.ts` (medium)
   - `image_search.ts` (medium, shares code with download_image)
   - `open_folder_in_system.ts` (Obsidian-specific, may need graceful degradation)
   - `context.ts` (complex, many workspace features)

---

## Tools Using Correct Pattern (No Changes Needed)

These tools properly use `vaultOperations.ts`:
- `create_file.ts`
- `create_directory.ts`
- `delete_file.ts`
- `dirlist.ts`
- `edit_file.ts`
- `get_folder_tree.ts`
- `list_directory.ts`
- `list_vault_files.ts`
- `move_file.ts`
- `read_file.ts`
- `rename_file.ts`
- `search_keyword.ts`
- `search_regexp.ts`
- `search_replace_file.ts`
- `search_replace_global.ts`
- `update_file.ts`
- `generate_image_from_context.ts`
- `web_search.ts`
