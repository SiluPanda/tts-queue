import type { SegmentInfo } from './types';

export type TTSQueueStage = 'synthesis' | 'playback' | 'splitting' | 'internal';

export class TTSQueueError extends Error {
  readonly name = 'TTSQueueError';
  constructor(
    message: string,
    readonly stage: TTSQueueStage,
    readonly cause?: Error,
    readonly segment?: SegmentInfo,
  ) {
    super(message);
    Object.setPrototypeOf(this, TTSQueueError.prototype);
  }
}

export function synthError(message: string, cause?: Error, segment?: SegmentInfo): TTSQueueError {
  return new TTSQueueError(message, 'synthesis', cause, segment);
}

export function playbackError(message: string, cause?: Error, segment?: SegmentInfo): TTSQueueError {
  return new TTSQueueError(message, 'playback', cause, segment);
}

export function splittingError(message: string, cause?: Error, segment?: SegmentInfo): TTSQueueError {
  return new TTSQueueError(message, 'splitting', cause, segment);
}

export function internalError(message: string, cause?: Error, segment?: SegmentInfo): TTSQueueError {
  return new TTSQueueError(message, 'internal', cause, segment);
}
