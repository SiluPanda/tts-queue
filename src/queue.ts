import { EventEmitter } from 'events';
import type {
  QueueOptions,
  TTSQueue,
  QueueState,
  QueueStats,
  SegmentInfo,
  CancelResult,
  TTSQueueEvents,
} from './types';
import { splitSentences } from './splitter';
import { createSegment, transitionSegment } from './segment';
import { synthError, playbackError, internalError } from './errors';
import type { TTSQueueError } from './errors';

interface InternalSegment {
  info: SegmentInfo;
  abortController: AbortController;
}

export function createQueue(options: QueueOptions): TTSQueue {
  const { provider, sink } = options;
  const splittingOpts = options.splitting ?? {};
  const minLength = splittingOpts.minChars ?? 10;
  const maxLength = splittingOpts.maxChars ?? 200;

  const emitter = new EventEmitter();

  let state: QueueState = 'idle';
  let paused = false;
  let closed = false;
  let processing = false;

  // All segments ever created, keyed by id
  const allSegments: Map<string, InternalSegment> = new Map();
  // Pending queue (not yet started synthesis)
  const pendingQueue: string[] = []; // segment ids

  function setState(newState: QueueState): void {
    if (state === newState) return;
    state = newState;
    emitter.emit('state:change', newState);
  }

  function emitEvent<K extends keyof TTSQueueEvents>(
    event: K,
    ...args: Parameters<TTSQueueEvents[K]>
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (emitter.emit as any)(event, ...args);
  }

  function updateSegment(id: string, updated: SegmentInfo): void {
    const entry = allSegments.get(id);
    if (entry) {
      allSegments.set(id, { ...entry, info: updated });
    }
  }

  async function processSegment(id: string): Promise<void> {
    const entry = allSegments.get(id);
    if (!entry) return;

    let seg = entry.info;
    if (seg.state !== 'pending') return;

    const ac = entry.abortController;

    // pending -> synthesizing
    try {
      seg = transitionSegment(seg, 'synthesizing');
      updateSegment(id, seg);
      emitEvent('segment:start', seg);
      options.onSegmentStart?.(seg);
    } catch {
      return;
    }

    // Synthesize
    let audioData;
    try {
      audioData = await provider.synthesize(seg.text, { signal: ac.signal } as never);
    } catch (err) {
      if (ac.signal.aborted) {
        // Cancelled — transition already handled
        return;
      }
      const cause = err instanceof Error ? err : new Error(String(err));
      const ttsErr = synthError(`Synthesis failed for segment ${id}`, cause, seg);
      seg = transitionSegment(seg, 'failed', { error: cause });
      updateSegment(id, seg);
      emitEvent('segment:error', ttsErr, seg);
      options.onSegmentError?.(ttsErr, seg);
      return;
    }

    if (ac.signal.aborted) return;

    // synthesizing -> synthesized
    try {
      seg = transitionSegment(seg, 'synthesized', {
        durationMs: audioData.durationMs,
      });
      updateSegment(id, seg);
    } catch {
      return;
    }

    // synthesized -> playing
    if (paused || closed) return;

    try {
      seg = transitionSegment(seg, 'playing');
      updateSegment(id, seg);
    } catch {
      return;
    }

    // Play
    try {
      await sink.play(audioData, seg);
    } catch (err) {
      if (ac.signal.aborted) return;
      const cause = err instanceof Error ? err : new Error(String(err));
      const pbErr = playbackError(`Playback failed for segment ${id}`, cause, seg);
      seg = transitionSegment(seg, 'failed', { error: cause });
      updateSegment(id, seg);
      emitEvent('segment:error', pbErr, seg);
      options.onSegmentError?.(pbErr, seg);
      return;
    }

    if (ac.signal.aborted) return;

    // playing -> played
    try {
      seg = transitionSegment(seg, 'played');
      updateSegment(id, seg);
    } catch {
      return;
    }

    emitEvent('segment:end', seg);
    options.onSegmentEnd?.(seg);
  }

  async function _processNext(): Promise<void> {
    if (processing) return;
    if (paused || closed) return;
    if (pendingQueue.length === 0) {
      // Check if all segments are done
      if (state === 'playing' || state === 'draining') {
        const allDone = [...allSegments.values()].every(
          e => e.info.state === 'played' || e.info.state === 'failed' || e.info.state === 'cancelled',
        );
        if (allDone && allSegments.size > 0) {
          emitEvent('queue:empty');
          options.onQueueEmpty?.();
          setState('idle');
        }
      }
      return;
    }

    processing = true;
    if (state === 'idle') {
      setState('playing');
    }

    while (pendingQueue.length > 0 && !paused && !closed) {
      const id = pendingQueue.shift()!;
      await processSegment(id);

      // After each segment, check if more remain
      if (pendingQueue.length === 0) {
        // Check if all are in terminal state
        const allDone = [...allSegments.values()].every(
          e => e.info.state === 'played' || e.info.state === 'failed' || e.info.state === 'cancelled',
        );
        if (allDone) {
          emitEvent('queue:empty');
          options.onQueueEmpty?.();
          setState('idle');
        }
      }
    }

    processing = false;
  }

  function enqueueSegments(texts: string[], prepend = false): SegmentInfo[] {
    if (closed) {
      throw internalError('Queue is closed');
    }

    const existingCount = allSegments.size;
    const infos: SegmentInfo[] = [];

    texts.forEach((text, i) => {
      const seg = createSegment(text, existingCount + i);
      const ac = new AbortController();
      allSegments.set(seg.id, { info: seg, abortController: ac });
      infos.push(seg);

      if (prepend) {
        pendingQueue.unshift(seg.id);
      } else {
        pendingQueue.push(seg.id);
      }
    });

    return infos;
  }

  const queue: TTSQueue = {
    async push(text: string): Promise<SegmentInfo[]> {
      if (closed) throw internalError('Queue is closed');

      let sentences: string[];
      if (splittingOpts.custom) {
        sentences = splittingOpts.custom(text);
      } else {
        sentences = splitSentences(text, { minLength, maxLength });
      }

      if (sentences.length === 0) return [];

      const infos = enqueueSegments(sentences);
      void _processNext();
      return infos;
    },

    async pushImmediate(text: string): Promise<SegmentInfo[]> {
      if (closed) throw internalError('Queue is closed');

      // Cancel any pending/in-flight/playing segments for immediate interruption
      for (const [id, entry] of allSegments.entries()) {
        const s = entry.info.state;
        if (s === 'pending' || s === 'synthesizing' || s === 'synthesized' || s === 'playing') {
          entry.abortController.abort();
          const cancelled = transitionSegment(entry.info, 'cancelled');
          allSegments.set(id, { ...entry, info: cancelled });
          // Remove from pending queue
          const idx = pendingQueue.indexOf(id);
          if (idx !== -1) pendingQueue.splice(idx, 1);
        }
      }

      let sentences: string[];
      if (splittingOpts.custom) {
        sentences = splittingOpts.custom(text);
      } else {
        sentences = splitSentences(text, { minLength, maxLength });
      }

      if (sentences.length === 0) return [];

      const infos = enqueueSegments(sentences, true);
      void _processNext();
      return infos;
    },

    async pause(): Promise<void> {
      if (state === 'playing') {
        paused = true;
        setState('paused');
        await sink.pause?.();
      }
    },

    async resume(): Promise<void> {
      if (state === 'paused') {
        paused = false;
        setState('playing');
        await sink.resume?.();
        void _processNext();
      }
    },

    async cancel(ids?: string[]): Promise<CancelResult> {
      const cancelledIds: string[] = [];

      if (ids && ids.length > 0) {
        for (const id of ids) {
          const entry = allSegments.get(id);
          if (!entry) continue;
          const s = entry.info.state;
          if (s === 'pending' || s === 'synthesizing' || s === 'synthesized' || s === 'playing') {
            entry.abortController.abort();
            try {
              const cancelled = transitionSegment(entry.info, 'cancelled');
              allSegments.set(id, { ...entry, info: cancelled });
              cancelledIds.push(id);
            } catch {
              // already in terminal state
            }
            const idx = pendingQueue.indexOf(id);
            if (idx !== -1) pendingQueue.splice(idx, 1);
          }
        }
      } else {
        // Cancel all non-terminal segments
        for (const [id, entry] of allSegments.entries()) {
          const s = entry.info.state;
          if (s === 'pending' || s === 'synthesizing' || s === 'synthesized' || s === 'playing') {
            entry.abortController.abort();
            try {
              const cancelled = transitionSegment(entry.info, 'cancelled');
              allSegments.set(id, { ...entry, info: cancelled });
              cancelledIds.push(id);
            } catch {
              // already terminal
            }
          }
        }
        pendingQueue.length = 0;

        if (state !== 'idle' && state !== 'closed') {
          setState('idle');
        }
      }

      return { cancelled: cancelledIds.length, ids: cancelledIds };
    },

    async drain(): Promise<void> {
      if (state === 'playing') {
        setState('draining');
      }
      // Wait until queue goes idle
      await new Promise<void>((resolve) => {
        if (state === 'idle') {
          resolve();
          return;
        }
        const cleanup = () => {
          emitter.off('queue:empty', onEmpty);
          emitter.off('state:change', onState);
        };
        const onEmpty = () => {
          cleanup();
          resolve();
        };
        emitter.on('queue:empty', onEmpty);
        // Also listen for state change to idle
        const onState = (newState: QueueState) => {
          if (newState === 'idle') {
            cleanup();
            resolve();
          }
        };
        emitter.on('state:change', onState);
      });
    },

    async close(): Promise<void> {
      closed = true;
      await queue.cancel();
      setState('closed');
    },

    getState(): QueueState {
      return state;
    },

    getStats(): QueueStats {
      let totalSegments = 0;
      let completedSegments = 0;
      let failedSegments = 0;
      let cancelledSegments = 0;
      let pendingSegments = 0;
      let totalDurationMs = 0;
      let totalChars = 0;

      for (const { info } of allSegments.values()) {
        totalSegments++;
        totalChars += info.text.length;

        if (info.state === 'played') {
          completedSegments++;
          totalDurationMs += info.durationMs ?? 0;
        } else if (info.state === 'failed') {
          failedSegments++;
        } else if (info.state === 'cancelled') {
          cancelledSegments++;
        } else {
          pendingSegments++;
        }
      }

      return {
        totalSegments,
        completedSegments,
        failedSegments,
        cancelledSegments,
        pendingSegments,
        totalDurationMs,
        totalChars,
      };
    },

    getSegments(): SegmentInfo[] {
      return [...allSegments.values()].map(e => ({ ...e.info }));
    },

    on<K extends keyof TTSQueueEvents>(event: K, listener: TTSQueueEvents[K]): void {
      emitter.on(event, listener as (...args: unknown[]) => void);
    },

    off<K extends keyof TTSQueueEvents>(event: K, listener: TTSQueueEvents[K]): void {
      emitter.off(event, listener as (...args: unknown[]) => void);
    },
  };

  // Suppress unhandled error events on the internal emitter
  emitter.on('error', (_err: TTSQueueError) => { /* handled via segment:error */ });

  return queue;
}
