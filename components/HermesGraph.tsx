import React, { useEffect, useRef } from 'react';
import { HudState } from '../utils/useHudState';
import { ConversationGraph, GraphNode, GraphTouch } from '../utils/useConversationGraph';

interface HermesGraphProps {
  graph: ConversationGraph;
  touch: GraphTouch;
  state: HudState;
}

/** How long a node stays lit after a tool touches it. */
const GLOW_MS = 1600;

const HermesGraph: React.FC<HermesGraphProps> = ({ graph, touch, state }) => {
  const groupRef = useRef<SVGGElement>(null);
  const timers = useRef<Map<string, number>>(new Map());

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
      <svg className="hermes-graph-svg" viewBox="0 0 200 200" aria-hidden="true">
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
