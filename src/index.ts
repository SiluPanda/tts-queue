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
// createQueue, createCallbackSink, createBufferSink, createStreamSink,
// createMockProvider, createMockSink — to be implemented in later phases
