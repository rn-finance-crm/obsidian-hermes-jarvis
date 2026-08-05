import React, { useEffect, useMemo, useRef } from 'react';
import { HudState } from '../utils/useHudState';
import { ConversationGraph, GraphNode, GraphTouch } from '../utils/useConversationGraph';

interface HermesGraphProps {
  graph: ConversationGraph;
  touch: GraphTouch;
  state: HudState;
  /** Labels only make sense once the map has room for them. */
  showLabels: boolean;
}

/** How long a node stays lit after a tool touches it. */
const GLOW_MS = 1600;

/**
 * The layout works in a fixed coordinate space, but the map has to read the
 * same whether it holds three nodes or forty. So rather than a fixed viewBox,
 * the view is fitted to the nodes: a small graph zooms in to fill the panel
 * instead of huddling in the middle of it.
 */
/** Room left around the nodes; labels need most of it, so it drops without them. */
const FIT_PADDING_LABELLED = 22;
const FIT_PADDING_BARE = 10;
const MIN_VIEW = 82;
const MAX_VIEW = 250;

/**
 * Fraction of the view size. Because the view is fitted to the nodes, this
 * keeps labels at a constant on-screen size no matter how many there are.
 */
const LABEL_SCALE = 0.038;

/** Long names outgrow their cluster and cross neighbouring nodes. */
const MAX_LABEL_CHARS = 13;

/** Past this many nodes labels collide into noise, so they are dropped. */
const MAX_LABELLED_NODES = 20;

const truncate = (label: string): string =>
  label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;

const HermesGraph: React.FC<HermesGraphProps> = ({ graph, touch, state, showLabels }) => {
  const groupRef = useRef<SVGGElement>(null);
  const timers = useRef<Map<string, number>>(new Map());

  const withLabels = showLabels && graph.nodes.length <= MAX_LABELLED_NODES;

  const view = useMemo(() => {
    if (graph.nodes.length === 0) {
      return { viewBox: '0 0 200 200', fontSize: 200 * LABEL_SCALE };
    }

    const padding = withLabels ? FIT_PADDING_LABELLED : FIT_PADDING_BARE;

    const xs = graph.nodes.map((node) => node.x);
    const ys = graph.nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const span = Math.max(maxX - minX, maxY - minY);
    const size = Math.min(MAX_VIEW, Math.max(MIN_VIEW, span + padding * 2));
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    return {
      viewBox: `${centreX - size / 2} ${centreY - size / 2} ${size} ${size}`,
      fontSize: size * LABEL_SCALE,
    };
  }, [graph.nodes, withLabels]);

  // Lighting a node adds a class and removes it on a timer, deliberately
  // bypassing React: a decaying glow must not re-render the whole map, and
  // with a keyword search that can be dozens of nodes at once.
  useEffect(() => {
    const group = groupRef.current;
    if (!group || touch.ids.length === 0) return;

    touch.ids.forEach((id) => {
      const element = group.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`);
      if (!element) return;

      element.classList.remove('is-hot');
      // Force a reflow so re-touching an already-lit node restarts the fade
      // instead of doing nothing.
      void element.getBoundingClientRect();
      element.classList.add('is-hot');

      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);

      timers.current.set(
        id,
        window.setTimeout(() => {
          element.classList.remove('is-hot');
          timers.current.delete(id);
        }, GLOW_MS),
      );
    });
  }, [touch]);

  // Capture the map on unmount so pending timers cannot fire against it later.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  if (graph.nodes.length === 0) {
    return (
      <div className="hermes-graph is-empty" data-graph-state={state}>
        <span className="hermes-graph-hint">No files touched yet</span>
      </div>
    );
  }

  const nodeById = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));

  return (
    <div className="hermes-graph" data-graph-state={state}>
      <svg className="hermes-graph-svg" viewBox={view.viewBox} aria-hidden="true">
        {/* One transformed group carries the drift and the "inhale", so the
            motion costs the same whether there are three nodes or forty. */}
        <g ref={groupRef} className="hermes-graph-field">
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;

            return (
              <line
                key={edge.id}
                className="hermes-graph-edge"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}

          {graph.nodes.map((node, index) => (
            <g
              key={node.id}
              className="hermes-graph-node"
              data-node-id={node.id}
              data-node-kind={node.kind}
              // Staggered so the nodes breathe out of phase with each other
              // rather than pulsing in unison, which reads as mechanical.
              style={{ animationDelay: `${(index % 7) * 0.42}s` }}
            >
              <circle
                className="hermes-graph-halo"
                cx={node.x}
                cy={node.y}
                r={node.kind === 'folder' ? 9 : 6}
              />
              <circle
                className="hermes-graph-dot"
                cx={node.x}
                cy={node.y}
                r={node.kind === 'folder' ? 4 : 2.6}
              />
              {withLabels && (
                <text
                  className="hermes-graph-label"
                  x={node.x}
                  // Folder labels sit above the node and file labels below, so
                  // a folder's own caption cannot collide with its files'.
                  y={node.y + (node.kind === 'folder' ? -9 : 10)}
                  fontSize={view.fontSize}
                >
                  {truncate(node.label)}
                </text>
              )}
              <title>{node.label}</title>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
};

/** Memoised so mic-volume renders in App never reach the map. */
export default React.memo(HermesGraph);
