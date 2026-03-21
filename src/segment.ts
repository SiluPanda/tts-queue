import { randomUUID } from 'crypto';
import type { SegmentInfo, SegmentState } from './types';
import { internalError } from './errors';

// Valid state transitions map
const VALID_TRANSITIONS: Record<SegmentState, SegmentState[]> = {
  pending: ['synthesizing', 'cancelled'],
  synthesizing: ['synthesized', 'failed', 'cancelled'],
  synthesized: ['playing', 'cancelled'],
  playing: ['played', 'failed', 'cancelled'],
  played: [],
  failed: [],
  cancelled: [],
};

export function createSegment(text: string, index: number): SegmentInfo {
  return {
    id: randomUUID(),
    text,
    index,
    state: 'pending',
    addedAt: new Date(),
  };
}

export function transitionSegment(
  segment: SegmentInfo,
  newState: SegmentState,
  extra?: Partial<SegmentInfo>,
): SegmentInfo {
  const allowed = VALID_TRANSITIONS[segment.state];
  if (!allowed.includes(newState)) {
    throw internalError(
      `Invalid segment state transition: ${segment.state} -> ${newState}`,
      undefined,
      segment,
    );
  }

  const now = new Date();
  const updates: Partial<SegmentInfo> = { state: newState };

  if (newState === 'synthesizing') {
    updates.synthesisStartedAt = now;
  } else if (newState === 'synthesized') {
    updates.synthesisCompletedAt = now;
  } else if (newState === 'playing') {
    updates.playbackStartedAt = now;
  } else if (newState === 'played') {
    updates.playbackCompletedAt = now;
  }

  return { ...segment, ...updates, ...extra };
}
