export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'pcm' | 'aac' | 'opus';

export type SegmentState =
  | 'pending'
  | 'synthesizing'
  | 'synthesized'
  | 'playing'
  | 'played'
  | 'cancelled'
  | 'failed';

export type QueueState = 'idle' | 'playing' | 'paused' | 'draining' | 'closed';

export interface AudioData {
  buffer: Buffer;
  format: AudioFormat;
  sampleRate?: number;
  channels?: number;
  durationMs?: number;
  sizeBytes: number;
}

export interface AudioChunk {
  data: Uint8Array;
  isFinal: boolean;
}

export interface SegmentInfo {
  id: string;
  text: string;
  index: number;
  state: SegmentState;
  addedAt: Date;
  synthesisStartedAt?: Date;
  synthesisCompletedAt?: Date;
  playbackStartedAt?: Date;
  playbackCompletedAt?: Date;
  durationMs?: number;
  error?: Error;
}

export interface TTSProvider {
  synthesize(text: string, options?: SynthesisOptions): Promise<AudioData>;
  synthesizeStream?(text: string, options?: SynthesisOptions): AsyncIterable<AudioChunk>;
}

export interface SynthesisOptions {
  voice?: string;
  speed?: number;
  format?: AudioFormat;
  sampleRate?: number;
}

export interface AudioSink {
  play(audio: AudioData, segment: SegmentInfo): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface SplittingOptions {
  maxChars?: number;
  minChars?: number;
  on?: 'sentence' | 'word' | 'paragraph';
  custom?: (text: string) => string[];
}

export interface QueueOptions {
  provider: TTSProvider;
  sink: AudioSink;
  splitting?: SplittingOptions;
  concurrency?: number;
  prefetchCount?: number;
  onSegmentStart?: (segment: SegmentInfo) => void;
  onSegmentEnd?: (segment: SegmentInfo) => void;
  onSegmentError?: (error: TTSQueueError, segment: SegmentInfo) => void;
  onQueueEmpty?: () => void;
}

export interface QueueStats {
  totalSegments: number;
  completedSegments: number;
  failedSegments: number;
  cancelledSegments: number;
  pendingSegments: number;
  totalDurationMs: number;
  totalChars: number;
}

export interface CancelResult {
  cancelled: number;
  ids: string[];
}

export interface TTSQueueEvents {
  'segment:start': (segment: SegmentInfo) => void;
  'segment:end': (segment: SegmentInfo) => void;
  'segment:error': (error: TTSQueueError, segment: SegmentInfo) => void;
  'queue:empty': () => void;
  'queue:drain': () => void;
  'state:change': (state: QueueState) => void;
}

import type { TTSQueueError } from './errors';

export interface TTSQueue {
  push(text: string): Promise<SegmentInfo[]>;
  pushImmediate(text: string): Promise<SegmentInfo[]>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(ids?: string[]): Promise<CancelResult>;
  drain(): Promise<void>;
  close(): Promise<void>;
  getState(): QueueState;
  getStats(): QueueStats;
  getSegments(): SegmentInfo[];
  on<K extends keyof TTSQueueEvents>(event: K, listener: TTSQueueEvents[K]): void;
  off<K extends keyof TTSQueueEvents>(event: K, listener: TTSQueueEvents[K]): void;
}
