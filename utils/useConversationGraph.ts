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

/** Layout constants, in the user space the view is later fitted to. */
const CENTRE = 100;
/** Smallest folder ring; grows with folder count so clusters never collide. */
const FOLDER_RADIUS_MIN = 54;
/**
 * Clear space demanded between neighbouring folder clusters. Generous because
 * a node's label reaches well past the node itself.
 */
const FOLDER_GAP = 46;
/**
 * Files orbit their folder at this distance. It has to clear the folder's own
 * label, so it is considerably wider than the node itself.
 */
const FILE_RADIUS = 32;
/** Extra orbit room per file past the third, so busy folders do not bunch up. */
const FILE_RADIUS_STEP = 2.6;
const MAX_FILE_RADIUS = 58;
/**
 * Rotates each orbit off its folder's own bearing. Without it a folder and its
 * files land on one straight line through the centre, which reads as a stick
 * rather than a cluster.
 */
const ORBIT_OFFSET = Math.PI / 4;
/** Half-angle between the two files of a pair, chosen to form a clear triangle. */
const PAIR_SPREAD = Math.PI / 3;

/**
 * Angle of a file around its folder. One or two files are placed as a triangle
 * with their folder; three or more take an even ring.
 */
/** Orbit radius for a folder holding `count` files. */
const orbitRadius = (count: number): number =>
  Math.min(MAX_FILE_RADIUS, FILE_RADIUS + Math.max(0, count - 3) * FILE_RADIUS_STEP);

/**
 * Radius of the ring the folders sit on, solved from the chord between
 * neighbours so that adjacent clusters always keep `FOLDER_GAP` between them
 * however many folders there are.
 */
const folderRingRadius = (folderCount: number, widestOrbit: number): number => {
  if (folderCount < 2) return 0;

  const requiredChord = widestOrbit * 2 + FOLDER_GAP;
  const solved = requiredChord / (2 * Math.sin(Math.PI / folderCount));

  return Math.max(FOLDER_RADIUS_MIN, solved);
};

const fileAngle = (index: number, count: number, folderAngle: number): number => {
  const base = folderAngle + ORBIT_OFFSET;

  if (count === 1) return base;
  if (count === 2) return base + (index === 0 ? -PAIR_SPREAD : PAIR_SPREAD);

  return base + (index / count) * Math.PI * 2;
};

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

    const widestOrbit = Math.max(
      ...folders.map((folder) => orbitRadius((byFolder.get(folder) ?? []).length)),
    );
    const ringRadius = folderRingRadius(folders.length, widestOrbit);

    folders.forEach((folder, folderIndex) => {
      const group = byFolder.get(folder) ?? [];
      const id = folderIdFor(folder);

      // A single folder sits at the centre; several spread around a ring.
      const folderAngle = (folderIndex / folders.length) * Math.PI * 2 - Math.PI / 2;
      const folderX = CENTRE + Math.cos(folderAngle) * ringRadius;
      const folderY = CENTRE + Math.sin(folderAngle) * ringRadius;

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
          const angle = fileAngle(fileIndex, group.length, folderAngle);
          const radius = orbitRadius(group.length);

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
