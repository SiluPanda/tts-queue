import { describe, it, expect } from 'vitest';
import type {
  TTSQueue,
  QueueOptions,
  SplittingOptions,
  QueueStats,
  CancelResult,
  AudioFormat,
  SegmentState,
  TTSQueueEvents,
  SegmentInfo,
  TTSProvider,
  AudioSink,
  AudioData,
  QueueState,
} from '../types';
// ── Compile-time shape checks ────────────────────────────────────────

// TTSQueue interface can be mock-implemented
const mockQueue: TTSQueue = {
  push: async (_text: string) => [],
  pushImmediate: async (_text: string) => [],
  pause: async () => {},
  resume: async () => {},
  cancel: async (_ids?: string[]) => ({ cancelled: 0, ids: [] }),
  drain: async () => {},
  close: async () => {},
  getState: () => 'idle' as QueueState,
  getStats: () => ({
    totalSegments: 0,
    completedSegments: 0,
    failedSegments: 0,
    cancelledSegments: 0,
    pendingSegments: 0,
    totalDurationMs: 0,
    totalChars: 0,
  }),
  getSegments: () => [],
  on: <K extends keyof TTSQueueEvents>(_event: K, _listener: TTSQueueEvents[K]) => {},
  off: <K extends keyof TTSQueueEvents>(_event: K, _listener: TTSQueueEvents[K]) => {},
};

// QueueOptions requires provider and sink
const mockProvider: TTSProvider = {
  synthesize: async (_text: string) => ({
    buffer: Buffer.alloc(0),
    format: 'mp3' as AudioFormat,
    sizeBytes: 0,
  }),
};

const mockSink: AudioSink = {
  play: async (_audio: AudioData, _segment: SegmentInfo) => {},
};

const queueOptions: QueueOptions = {
  provider: mockProvider,
  sink: mockSink,
};

// SplittingOptions — all optional
const splittingOptionsEmpty: SplittingOptions = {};
const splittingOptionsFull: SplittingOptions = {
  maxChars: 200,
  minChars: 10,
  on: 'sentence',
  custom: (text: string) => [text],
};

// QueueStats has all count fields
const stats: QueueStats = {
  totalSegments: 0,
  completedSegments: 0,
  failedSegments: 0,
  cancelledSegments: 0,
  pendingSegments: 0,
  totalDurationMs: 0,
  totalChars: 0,
};

// CancelResult has cancelled (number) and ids (string[])
const cancelResult: CancelResult = {
  cancelled: 0,
  ids: [],
};

// AudioFormat union has at least 5 values
const formats: AudioFormat[] = ['mp3', 'wav', 'ogg', 'pcm', 'aac', 'opus'];

// SegmentState covers all expected states
const states: SegmentState[] = [
  'pending',
  'synthesizing',
  'synthesized',
  'playing',
  'played',
  'cancelled',
  'failed',
];

// TTSQueueEvents has all event keys
type EventKeys = keyof TTSQueueEvents;
const _eventKeys: EventKeys[] = [
  'segment:start',
  'segment:end',
  'segment:error',
  'queue:empty',
  'queue:drain',
  'state:change',
];

describe('types', () => {
  it('TTSQueue interface can be mock-implemented', () => {
    expect(mockQueue).toBeDefined();
    expect(typeof mockQueue.push).toBe('function');
    expect(typeof mockQueue.pushImmediate).toBe('function');
    expect(typeof mockQueue.pause).toBe('function');
    expect(typeof mockQueue.resume).toBe('function');
    expect(typeof mockQueue.cancel).toBe('function');
    expect(typeof mockQueue.drain).toBe('function');
    expect(typeof mockQueue.close).toBe('function');
    expect(typeof mockQueue.getState).toBe('function');
    expect(typeof mockQueue.getStats).toBe('function');
    expect(typeof mockQueue.getSegments).toBe('function');
    expect(typeof mockQueue.on).toBe('function');
    expect(typeof mockQueue.off).toBe('function');
  });

  it('QueueOptions requires provider and sink', () => {
    expect(queueOptions.provider).toBeDefined();
    expect(queueOptions.sink).toBeDefined();
  });

  it('SplittingOptions all-optional', () => {
    // Both empty and full versions are valid
    expect(splittingOptionsEmpty).toBeDefined();
    expect(splittingOptionsFull).toBeDefined();
    expect(splittingOptionsFull.maxChars).toBe(200);
    expect(splittingOptionsFull.minChars).toBe(10);
    expect(splittingOptionsFull.on).toBe('sentence');
    expect(typeof splittingOptionsFull.custom).toBe('function');
  });

  it('QueueStats has all count fields', () => {
    expect(typeof stats.totalSegments).toBe('number');
    expect(typeof stats.completedSegments).toBe('number');
    expect(typeof stats.failedSegments).toBe('number');
    expect(typeof stats.cancelledSegments).toBe('number');
    expect(typeof stats.pendingSegments).toBe('number');
    expect(typeof stats.totalDurationMs).toBe('number');
    expect(typeof stats.totalChars).toBe('number');
  });

  it('CancelResult has cancelled (number) and ids (string[])', () => {
    expect(typeof cancelResult.cancelled).toBe('number');
    expect(Array.isArray(cancelResult.ids)).toBe(true);
  });

  it('AudioFormat union has at least 5 values', () => {
    expect(formats.length).toBeGreaterThanOrEqual(5);
    expect(formats).toContain('mp3');
    expect(formats).toContain('wav');
    expect(formats).toContain('ogg');
    expect(formats).toContain('pcm');
    expect(formats).toContain('aac');
  });

  it('SegmentState covers all expected states', () => {
    expect(states).toContain('pending');
    expect(states).toContain('synthesizing');
    expect(states).toContain('synthesized');
    expect(states).toContain('playing');
    expect(states).toContain('played');
    expect(states).toContain('cancelled');
    expect(states).toContain('failed');
  });

  it('TTSQueueEvents has all event keys', () => {
    expect(_eventKeys).toContain('segment:start');
    expect(_eventKeys).toContain('segment:end');
    expect(_eventKeys).toContain('segment:error');
    expect(_eventKeys).toContain('queue:empty');
    expect(_eventKeys).toContain('queue:drain');
    expect(_eventKeys).toContain('state:change');
  });
});
