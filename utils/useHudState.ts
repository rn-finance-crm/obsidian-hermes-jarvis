import { useEffect, useMemo, useState } from 'react';
import { ConnectionStatus, TranscriptionEntry } from '../types';

export type HudState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'ERROR'
  | 'THINKING'
  | 'SPEAKING'
  | 'LISTENING'
  | 'ONLINE';

/**
 * onTranscription resets activeSpeaker to 'none' on every completed chunk, so
 * reading it directly makes the HUD strobe between chunks of a single reply.
 * Holding the last real speaker for a moment smooths that out.
 */
const SPEAKER_HOLD_MS = 600;

/** Only recent entries can hold a running tool; avoids scanning long histories. */
const PENDING_SCAN_DEPTH = 12;

/**
 * A tool whose status never advanced past 'pending' (a crash mid-call) would
 * otherwise pin the HUD to THINKING forever.
 */
const PENDING_MAX_AGE_MS = 60_000;

interface UseHudStateArgs {
  status: ConnectionStatus;
  activeSpeaker: 'user' | 'model' | 'none';
  transcripts: TranscriptionEntry[];
}

/**
 * Derives the HUD's display state from state App already tracks. Deliberately
 * read-only: it adds no logic to the voice session and cannot affect it.
 */
export const useHudState = ({ status, activeSpeaker, transcripts }: UseHudStateArgs): HudState => {
  const [heldSpeaker, setHeldSpeaker] = useState<'user' | 'model' | 'none'>('none');

  useEffect(() => {
    if (activeSpeaker !== 'none') {
      setHeldSpeaker(activeSpeaker);
      return;
    }

    const timer = setTimeout(() => setHeldSpeaker('none'), SPEAKER_HOLD_MS);
    return () => clearTimeout(timer);
  }, [activeSpeaker]);

  const hasRunningTool = useMemo(() => {
    const now = Date.now();
    return transcripts
      .slice(-PENDING_SCAN_DEPTH)
      .some(
        (entry) =>
          entry.toolData?.status === 'pending' &&
          now - entry.timestamp < PENDING_MAX_AGE_MS,
      );
  }, [transcripts]);

  // Order is priority order: connection trouble outranks anything else, and a
  // running tool outranks speech because that is the moment worth showing.
  if (status === ConnectionStatus.DISCONNECTED) return 'OFFLINE';
  if (status === ConnectionStatus.ERROR) return 'ERROR';
  if (status === ConnectionStatus.CONNECTING) return 'CONNECTING';
  if (hasRunningTool) return 'THINKING';
  if (heldSpeaker === 'model') return 'SPEAKING';
  if (heldSpeaker === 'user') return 'LISTENING';
  return 'ONLINE';
};
