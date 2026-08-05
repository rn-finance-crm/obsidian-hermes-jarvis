import React, { useEffect, useRef } from 'react';
import { HudState } from '../utils/useHudState';
import { ConversationGraph, GraphTouch } from '../utils/useConversationGraph';
import HermesGraph from './HermesGraph';

export type HudTheme = 'jarvis' | 'gold';
export type HudMode = 'strip' | 'full';

interface HermesHUDProps {
  state: HudState;
  theme: HudTheme;
  mode: HudMode;
  /** Shown in the readout; the assistant answers to this name too. */
  name: string;
  /**
   * Mic amplitude as a ref rather than a prop value: it updates at audio rate,
   * and passing it as a prop would re-render this component tens of times a
   * second. Read here in an animation frame and written straight to CSS.
   */
  volumeRef: React.MutableRefObject<number>;
  onToggleMode: () => void;
  /** Omitted when the reactive map is switched off in settings. */
  graph?: ConversationGraph;
  touch?: GraphTouch;
}

const STATE_LABEL: Record<HudState, string> = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  ERROR: 'ERROR',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  LISTENING: 'LISTENING',
  ONLINE: 'ONLINE',
};

/** States where the mic ring should track the incoming audio level. */
const LIVE_STATES: ReadonlySet<HudState> = new Set<HudState>([
  'ONLINE',
  'LISTENING',
  'SPEAKING',
  'THINKING',
]);

/** Smoothing factor for the ring: low enough to look like breathing, not jitter. */
const VOLUME_EASING = 0.18;

/** Raw RMS is small; this maps a normal speaking level to roughly full scale. */
const VOLUME_GAIN = 6;

/**
 * Writes a CSS custom property that the stylesheet reads. This is deliberately
 * not a class change: the value is rewritten every animation frame, and routing
 * it through React state would re-render the tree at that rate.
 */
const setCssVar = (element: HTMLElement, name: string, value: string): void => {
  element.style.setProperty(name, value);
};

const HermesHUD: React.FC<HermesHUDProps> = ({
  state,
  theme,
  mode,
  name,
  volumeRef,
  onToggleMode,
  graph,
  touch,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  // Drive the ring straight through a CSS variable. This never calls setState,
  // so a loud conversation does not cause a single React render.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !LIVE_STATES.has(state)) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let smoothed = 0;

    const tick = () => {
      const target = Math.min(1, Math.max(0, volumeRef.current * VOLUME_GAIN));
      smoothed += (target - smoothed) * VOLUME_EASING;
      setCssVar(root, '--hud-volume', smoothed.toFixed(3));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      setCssVar(root, '--hud-volume', '0');
    };
  }, [state, volumeRef]);

  return (
    <div
      ref={rootRef}
      className="hermes-hud"
      data-hud-state={state}
      data-hud-theme={theme}
      data-hud-mode={mode}
    >
      <button
        type="button"
        className="hermes-hud-dial"
        onClick={onToggleMode}
        aria-label={mode === 'strip' ? 'Expand HUD' : 'Collapse HUD'}
        title={mode === 'strip' ? 'Expand HUD' : 'Collapse HUD'}
      >
        <svg className="hermes-hud-svg" viewBox="0 0 100 100" aria-hidden="true">
          {/* Static outer track the moving parts read against. */}
          <circle className="hermes-hud-track" cx="50" cy="50" r="45" />

          {/* Counter-rotating arcs: the "scanning" motion. */}
          <circle className="hermes-hud-sweep" cx="50" cy="50" r="45" />
          <circle className="hermes-hud-sweep-alt" cx="50" cy="50" r="38" />

          {/* Tick marks, dashed so they read as a measuring scale. */}
          <circle className="hermes-hud-ticks" cx="50" cy="50" r="31" />

          {/* Breathes with the mic level. */}
          <circle className="hermes-hud-pulse" cx="50" cy="50" r="24" />
          <circle className="hermes-hud-core" cx="50" cy="50" r="16" />
        </svg>
      </button>

      <div className="hermes-hud-readout">
        <div className="hermes-hud-title">{name.toUpperCase()}</div>
        <div className="hermes-hud-state">
          <span className="hermes-hud-dot" aria-hidden="true" />
          {STATE_LABEL[state]}
        </div>
      </div>

      {graph && touch && <HermesGraph graph={graph} touch={touch} state={state} />}
    </div>
  );
};

/**
 * Memoised because App re-renders on every mic-volume update; without this the
 * HUD would re-render at audio rate for no visual gain.
 */
export default React.memo(HermesHUD);
