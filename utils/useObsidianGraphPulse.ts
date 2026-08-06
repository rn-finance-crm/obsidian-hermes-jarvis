import { useEffect, useRef } from 'react';
import type { App, WorkspaceLeaf } from 'obsidian';
import { HudState } from './useHudState';
import { getObsidianPlugin } from '../persistence/persistence';

/**
 * Stirs Obsidian's own graph view while the assistant is working.
 *
 * Obsidian lays the graph out with a force simulation that cools to a stop
 * once the nodes settle. Re-heating it is exactly what happens when the graph
 * is first opened, so this reuses that motion rather than inventing one: while
 * a tool is running the simulation is kept warm and the whole vault map drifts,
 * then cools back down on its own when the work finishes.
 *
 * The graph view is not part of Obsidian's public API, so every access here is
 * feature-detected and wrapped. If the internals ever change shape, this stops
 * doing anything and nothing else is affected.
 */

/** Leaf types that host a force-directed graph. */
const GRAPH_LEAF_TYPES = ['graph', 'localgraph'];

/**
 * How hard each nudge re-heats the simulation. Roughly what Obsidian itself
 * uses when a node is dragged: enough to move, not enough to rearrange.
 */
const PULSE_ALPHA = 0.4;

/**
 * Floor the simulation cools towards while thinking. Non-zero keeps it gently
 * in motion; low enough that a 3,000-node vault does not churn.
 */
const PULSE_ALPHA_TARGET = 0.06;

/** Gap between nudges, so the motion swells and eases rather than running flat. */
const PULSE_INTERVAL_MS = 1400;

interface GraphWorker {
  postMessage: (payload: Record<string, unknown>) => void;
}

/** Reads the simulation worker off a leaf, or null if this is not a graph leaf. */
const workerFor = (leaf: WorkspaceLeaf): GraphWorker | null => {
  const renderer = (leaf.view as unknown as { renderer?: { worker?: GraphWorker } })?.renderer;
  const worker = renderer?.worker;

  return typeof worker?.postMessage === 'function' ? worker : null;
};

const graphWorkers = (app: App): GraphWorker[] =>
  GRAPH_LEAF_TYPES.flatMap((type) => {
    try {
      return app.workspace
        .getLeavesOfType(type)
        .map(workerFor)
        .filter((worker): worker is GraphWorker => worker !== null);
    } catch {
      return [];
    }
  });

const post = (app: App, payload: Record<string, unknown>): void => {
  graphWorkers(app).forEach((worker) => {
    try {
      worker.postMessage(payload);
    } catch {
      // A graph mid-teardown can reject messages; nothing here is essential.
    }
  });
};

/** Wakes the graph up. */
const stir = (app: App): void =>
  post(app, { alpha: PULSE_ALPHA, alphaTarget: PULSE_ALPHA_TARGET, run: true });

/** Lets it coast to a stop the way it normally would. */
const settle = (app: App): void => post(app, { alphaTarget: 0, run: true });

export const useObsidianGraphPulse = (state: HudState, enabled: boolean): void => {
  const wasActive = useRef(false);

  useEffect(() => {
    const app = (getObsidianPlugin() as unknown as { app?: App } | null)?.app;
    if (!app) return;

    const active = enabled && state === 'THINKING';

    if (!active) {
      // Only settle a graph this hook actually stirred, so a disabled or idle
      // assistant never interferes with a graph the user is working in.
      if (wasActive.current) {
        wasActive.current = false;
        settle(app);
      }
      return;
    }

    wasActive.current = true;
    stir(app);

    const timer = window.setInterval(() => stir(app), PULSE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [state, enabled]);

  // Leaving the view mid-thought must not leave the simulation running hot.
  useEffect(() => {
    return () => {
      const app = (getObsidianPlugin() as unknown as { app?: App } | null)?.app;
      if (app && wasActive.current) settle(app);
    };
  }, []);
};
