import { useEffect, useMemo, useRef, useState } from 'react';
import { DirectoryInfoItem, SearchResult, ToolData, TranscriptionEntry } from '../types';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'file' | 'folder';
  /** Folder node id this file belongs to; undefined for folders. */
  parent?: string;
  lastTouch: number;
  x: number;
  y: number;
}

export interface ConversationGraph {
  nodes: GraphNode[];
  edges: { id: string; from: string; to: string }[];
}

export interface GraphTouch {
  /** Node ids lit by the most recent batch. */
  ids: string[];
  /** Increments per batch so effects can react without comparing arrays. */
  seq: number;
}

/**
 * Hard ceiling on nodes. A single keyword search can return dozens of files,
 * and an unbounded map would both crowd the panel and grow without limit over
 * a long conversation. Least-recently-touched nodes are dropped first.
 */
const MAX_FILE_NODES = 40;

/** Layout constants, in the 200x200 user space of the SVG. */
const CENTRE = 100;
const FOLDER_RADIUS = 44;
const FILE_RADIUS = 23;

const ROOT_LABEL = 'vault';

const folderIdFor = (folderPath: string): string => `folder:${folderPath}`;

const normalisePath = (value: string): string => value.trim().replace(/^\.?\//, '').replace(/\/+$/, '');

const basename = (path: string): string => {
  const name = path.split('/').pop() || path;
  return name.replace(/\.md$/i, '');
};

const dirname = (path: string): string => {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
};

const isUsablePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  !value.startsWith('http://') &&
  !value.startsWith('https://');

/**
 * Pulls every vault path a tool call touched out of the data the UI already
 * receives. Nothing here reaches into the tools themselves — this reads the
 * same toolData that renders the tool result cards.
 */
export const extractPaths = (tool: ToolData): string[] => {
  const found: string[] = [];

  const add = (value: unknown) => {
    if (isUsablePath(value)) found.push(normalisePath(value));
  };

  add(tool.filename);
  add(tool.targetPath);
  add(tool.originalPath);
  add(tool.restoredPath);
  tool.files?.forEach(add);

  // searchResults is a union: file hits carry `filename`, image hits do not.
  if (Array.isArray(tool.searchResults)) {
    tool.searchResults.forEach((result) => {
      if (result && typeof result === 'object' && 'filename' in result) {
        add((result as SearchResult).filename);
      }
    });
  }

  tool.directoryInfo?.forEach((item: DirectoryInfoItem) => add(item?.path));

  return found.filter((path) => path.length > 0);
};

interface TrackedFile {
  path: string;
  lastTouch: number;
}

/**
 * Builds a small graph of the files this conversation has touched.
 *
 * Derived entirely from `transcripts`, which already carries every tool call's
 * result. That keeps the tool layer untouched, and it means a file lights up
 * the moment its call is registered as pending rather than when it finishes.
 */
export const useConversationGraph = (transcripts: TranscriptionEntry[]) => {
  const seenEntryIds = useRef<Set<string>>(new Set());
  const files = useRef<Map<string, TrackedFile>>(new Map());
  const isFirstPass = useRef(true);
  const previousShape = useRef<{ length: number; firstId?: string }>({ length: 0 });

  const [touch, setTouch] = useState<GraphTouch>({ ids: [], seq: 0 });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Restoring an archived conversation replaces the whole array rather than
    // appending to it. Those files should appear on the map, but silently —
    // they are history, not something happening now.
    const shape = previousShape.current;
    const isReplacement =
      transcripts.length < shape.length ||
      (shape.length > 0 && transcripts[0]?.id !== shape.firstId);
    previousShape.current = { length: transcripts.length, firstId: transcripts[0]?.id };

    const unseen = transcripts.filter((entry) => !seenEntryIds.current.has(entry.id));
    if (unseen.length === 0) return;

    const now = Date.now();
    const touched: string[] = [];
    let changed = false;

    unseen.forEach((entry) => {
      seenEntryIds.current.add(entry.id);
      if (!entry.toolData) return;

      extractPaths(entry.toolData).forEach((path) => {
        const existing = files.current.get(path);
        if (!existing) changed = true;
        files.current.set(path, { path, lastTouch: now });
        touched.push(path);
      });
    });

    // Drop least-recently-touched files once over the ceiling.
    if (files.current.size > MAX_FILE_NODES) {
      const ordered = [...files.current.values()].sort((a, b) => b.lastTouch - a.lastTouch);
      files.current = new Map(
        ordered.slice(0, MAX_FILE_NODES).map((file) => [file.path, file]),
      );
      changed = true;
    }

    const silent = isFirstPass.current || isReplacement;
    isFirstPass.current = false;

    if (changed) setVersion((value) => value + 1);
    if (touched.length > 0 && !silent) {
      setTouch((previous) => ({ ids: touched, seq: previous.seq + 1 }));
    }
  }, [transcripts]);

  const graph = useMemo<ConversationGraph>(() => {
    const tracked = [...files.current.values()];
    if (tracked.length === 0) return { nodes: [], edges: [] };

    // Group by folder so the map reads as structure rather than scattered dots.
    const byFolder = new Map<string, TrackedFile[]>();
    tracked.forEach((file) => {
      const folder = dirname(file.path);
      const group = byFolder.get(folder);
      if (group) group.push(file);
      else byFolder.set(folder, [file]);
    });

    const folders = [...byFolder.keys()].sort();
    const nodes: GraphNode[] = [];
    const edges: ConversationGraph['edges'] = [];

    folders.forEach((folder, folderIndex) => {
      const group = byFolder.get(folder) ?? [];
      const id = folderIdFor(folder);

      // A single folder sits at the centre; several spread around a ring.
      const folderAngle = (folderIndex / folders.length) * Math.PI * 2 - Math.PI / 2;
      const folderX = folders.length === 1 ? CENTRE : CENTRE + Math.cos(folderAngle) * FOLDER_RADIUS;
      const folderY = folders.length === 1 ? CENTRE : CENTRE + Math.sin(folderAngle) * FOLDER_RADIUS;

      nodes.push({
        id,
        label: folder === '' ? ROOT_LABEL : basename(folder),
        kind: 'folder',
        lastTouch: Math.max(...group.map((file) => file.lastTouch)),
        x: folderX,
        y: folderY,
      });

      group
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .forEach((file, fileIndex) => {
          const spread = Math.max(group.length, 3);
          const angle = (fileIndex / spread) * Math.PI * 2 + folderAngle;
          const radius = FILE_RADIUS * (group.length > 6 ? 1.35 : 1);

          nodes.push({
            id: file.path,
            label: basename(file.path),
            kind: 'file',
            parent: id,
            lastTouch: file.lastTouch,
            x: folderX + Math.cos(angle) * radius,
            y: folderY + Math.sin(angle) * radius,
          });

          edges.push({ id: `${id}->${file.path}`, from: id, to: file.path });
        });
    });

    return { nodes, edges };
    // version changes whenever the tracked set changed; files.current is a ref.
  }, [version]);

  return { graph, touch };
};
