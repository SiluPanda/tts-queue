import { describe, it, expect } from 'vitest';
import {
  TTSQueueError,
  synthError,
  playbackError,
  splittingError,
  internalError,
} from '../errors';
import type { SegmentInfo } from '../types';

const mockSegment: SegmentInfo = {
  id: 'seg-1',
  text: 'Hello world',
  index: 0,
  state: 'pending',
  addedAt: new Date(),
};

describe('TTSQueueError', () => {
  it('extends Error', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(err).toBeInstanceOf(Error);
  });

  it('name is TTSQueueError', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(err.name).toBe('TTSQueueError');
  });

  it('stage is accessible', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(err.stage).toBe('synthesis');
  });

  it('cause is accessible when provided', () => {
    const cause = new Error('root cause');
    const err = new TTSQueueError('test message', 'synthesis', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(err.cause).toBeUndefined();
  });

  it('segment is accessible when provided', () => {
    const err = new TTSQueueError('test message', 'synthesis', undefined, mockSegment);
    expect(err.segment).toBe(mockSegment);
  });

  it('instanceof Error and TTSQueueError', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof TTSQueueError).toBe(true);
  });

  it('prototype chain is correct', () => {
    const err = new TTSQueueError('test message', 'synthesis');
    expect(Object.getPrototypeOf(err)).toBe(TTSQueueError.prototype);
  });

  it('preserves error message', () => {
    const msg = 'something went wrong in synthesis';
    const err = new TTSQueueError(msg, 'synthesis');
    expect(err.message).toBe(msg);
  });
});

describe('synthError', () => {
  it('creates error with stage synthesis', () => {
    const err = synthError('synthesis failed');
    expect(err.stage).toBe('synthesis');
  });

  it('returns TTSQueueError instance', () => {
    const err = synthError('synthesis failed');
    expect(err).toBeInstanceOf(TTSQueueError);
  });

  it('preserves message', () => {
    const err = synthError('synthesis failed');
    expect(err.message).toBe('synthesis failed');
  });

  it('passes cause through', () => {
    const cause = new Error('network error');
    const err = synthError('synthesis failed', cause);
    expect(err.cause).toBe(cause);
  });

  it('passes segment through', () => {
    const err = synthError('synthesis failed', undefined, mockSegment);
    expect(err.segment).toBe(mockSegment);
  });
});

describe('playbackError', () => {
  it('creates error with stage playback', () => {
    const err = playbackError('playback failed');
    expect(err.stage).toBe('playback');
  });

  it('returns TTSQueueError instance', () => {
    const err = playbackError('playback failed');
    expect(err).toBeInstanceOf(TTSQueueError);
  });

  it('preserves message', () => {
    const err = playbackError('speaker unavailable');
    expect(err.message).toBe('speaker unavailable');
  });

  it('passes cause through', () => {
    const cause = new Error('audio device error');
    const err = playbackError('playback failed', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('splittingError', () => {
  it('creates error with stage splitting', () => {
    const err = splittingError('split failed');
    expect(err.stage).toBe('splitting');
  });

  it('returns TTSQueueError instance', () => {
    const err = splittingError('split failed');
    expect(err).toBeInstanceOf(TTSQueueError);
  });

  it('preserves message', () => {
    const err = splittingError('invalid text input');
    expect(err.message).toBe('invalid text input');
  });
});

describe('internalError', () => {
  it('creates error with stage internal', () => {
    const err = internalError('internal error');
    expect(err.stage).toBe('internal');
  });

  it('returns TTSQueueError instance', () => {
    const err = internalError('internal error');
    expect(err).toBeInstanceOf(TTSQueueError);
  });

  it('preserves message', () => {
    const err = internalError('queue state corrupted');
    expect(err.message).toBe('queue state corrupted');
  });

  it('passes cause and segment through', () => {
    const cause = new Error('state error');
    const err = internalError('internal error', cause, mockSegment);
    expect(err.cause).toBe(cause);
    expect(err.segment).toBe(mockSegment);
  });
});

describe('All factory functions', () => {
  it('all return TTSQueueError instances', () => {
    expect(synthError('x')).toBeInstanceOf(TTSQueueError);
    expect(playbackError('x')).toBeInstanceOf(TTSQueueError);
    expect(splittingError('x')).toBeInstanceOf(TTSQueueError);
    expect(internalError('x')).toBeInstanceOf(TTSQueueError);
  });
});
