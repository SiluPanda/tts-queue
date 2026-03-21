export type {
  AudioFormat, SegmentState, QueueState,
  AudioData, AudioChunk, SegmentInfo,
  TTSProvider, SynthesisOptions, AudioSink,
  SplittingOptions, QueueOptions, QueueStats,
  CancelResult, TTSQueueEvents, TTSQueue,
} from './types';
export {
  TTSQueueError, synthError, playbackError, splittingError, internalError,
} from './errors';
export type { TTSQueueStage } from './errors';
export { createQueue } from './queue';
export { splitSentences } from './splitter';
export type { SplitOptions } from './splitter';
export { createSegment, transitionSegment } from './segment';
