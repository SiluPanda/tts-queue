import { describe, it, expect } from 'vitest';
import { createSegment, transitionSegment } from '../segment';
import { TTSQueueError } from '../errors';

describe('createSegment', () => {
  it('creates segment with correct fields', () => {
    const seg = createSegment('Hello world', 0);
    expect(seg.text).toBe('Hello world');
    expect(seg.index).toBe(0);
    expect(seg.state).toBe('pending');
    expect(typeof seg.id).toBe('string');
    expect(seg.id.length).toBeGreaterThan(0);
    expect(seg.addedAt).toBeInstanceOf(Date);
  });

  it('creates segment with correct index', () => {
    const seg = createSegment('Test', 5);
    expect(seg.index).toBe(5);
  });

  it('generates unique ids for different segments', () => {
    const seg1 = createSegment('Hello', 0);
    const seg2 = createSegment('World', 1);
    expect(seg1.id).not.toBe(seg2.id);
  });

  it('starts with no timestamps', () => {
    const seg = createSegment('Test', 0);
    expect(seg.synthesisStartedAt).toBeUndefined();
    expect(seg.synthesisCompletedAt).toBeUndefined();
    expect(seg.playbackStartedAt).toBeUndefined();
    expect(seg.playbackCompletedAt).toBeUndefined();
  });
});

describe('transitionSegment — valid transitions', () => {
  it('pending -> synthesizing', () => {
    const seg = createSegment('Hello', 0);
    const next = transitionSegment(seg, 'synthesizing');
    expect(next.state).toBe('synthesizing');
    expect(next.synthesisStartedAt).toBeInstanceOf(Date);
  });

  it('pending -> cancelled', () => {
    const seg = createSegment('Hello', 0);
    const next = transitionSegment(seg, 'cancelled');
    expect(next.state).toBe('cancelled');
  });

  it('synthesizing -> synthesized', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const next = transitionSegment(synth, 'synthesized');
    expect(next.state).toBe('synthesized');
    expect(next.synthesisCompletedAt).toBeInstanceOf(Date);
  });

  it('synthesizing -> failed', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const next = transitionSegment(synth, 'failed');
    expect(next.state).toBe('failed');
  });

  it('synthesizing -> cancelled', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const next = transitionSegment(synth, 'cancelled');
    expect(next.state).toBe('cancelled');
  });

  it('synthesized -> playing', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const ready = transitionSegment(synth, 'synthesized');
    const next = transitionSegment(ready, 'playing');
    expect(next.state).toBe('playing');
    expect(next.playbackStartedAt).toBeInstanceOf(Date);
  });

  it('synthesized -> cancelled', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const ready = transitionSegment(synth, 'synthesized');
    const next = transitionSegment(ready, 'cancelled');
    expect(next.state).toBe('cancelled');
  });

  it('playing -> played', () => {
    const seg = createSegment('Hello', 0);
    const s1 = transitionSegment(seg, 'synthesizing');
    const s2 = transitionSegment(s1, 'synthesized');
    const s3 = transitionSegment(s2, 'playing');
    const next = transitionSegment(s3, 'played');
    expect(next.state).toBe('played');
    expect(next.playbackCompletedAt).toBeInstanceOf(Date);
  });

  it('playing -> failed', () => {
    const seg = createSegment('Hello', 0);
    const s1 = transitionSegment(seg, 'synthesizing');
    const s2 = transitionSegment(s1, 'synthesized');
    const s3 = transitionSegment(s2, 'playing');
    const next = transitionSegment(s3, 'failed');
    expect(next.state).toBe('failed');
  });

  it('playing -> cancelled', () => {
    const seg = createSegment('Hello', 0);
    const s1 = transitionSegment(seg, 'synthesizing');
    const s2 = transitionSegment(s1, 'synthesized');
    const s3 = transitionSegment(s2, 'playing');
    const next = transitionSegment(s3, 'cancelled');
    expect(next.state).toBe('cancelled');
  });
});

describe('transitionSegment — immutability', () => {
  it('returns a new object, does not mutate original', () => {
    const seg = createSegment('Hello', 0);
    const next = transitionSegment(seg, 'synthesizing');
    expect(seg.state).toBe('pending');
    expect(next.state).toBe('synthesizing');
    expect(seg).not.toBe(next);
  });

  it('applies extra fields', () => {
    const seg = createSegment('Hello', 0);
    const synth = transitionSegment(seg, 'synthesizing');
    const next = transitionSegment(synth, 'synthesized', { durationMs: 1500 });
    expect(next.durationMs).toBe(1500);
  });
});

describe('transitionSegment — invalid transitions throw', () => {
  it('throws on pending -> played', () => {
    const seg = createSegment('Hello', 0);
    expect(() => transitionSegment(seg, 'played')).toThrow();
  });

  it('throws on pending -> synthesized', () => {
    const seg = createSegment('Hello', 0);
    expect(() => transitionSegment(seg, 'synthesized')).toThrow();
  });

  it('throws on synthesized -> synthesizing', () => {
    const seg = createSegment('Hello', 0);
    const s1 = transitionSegment(seg, 'synthesizing');
    const s2 = transitionSegment(s1, 'synthesized');
    expect(() => transitionSegment(s2, 'synthesizing')).toThrow();
  });

  it('throws on played -> playing', () => {
    const seg = createSegment('Hello', 0);
    const s1 = transitionSegment(seg, 'synthesizing');
    const s2 = transitionSegment(s1, 'synthesized');
    const s3 = transitionSegment(s2, 'playing');
    const s4 = transitionSegment(s3, 'played');
    expect(() => transitionSegment(s4, 'playing')).toThrow();
  });

  it('throws on cancelled -> pending', () => {
    const seg = createSegment('Hello', 0);
    const cancelled = transitionSegment(seg, 'cancelled');
    expect(() => transitionSegment(cancelled, 'pending' as never)).toThrow();
  });

  it('error is an instance of TTSQueueError', () => {
    const seg = createSegment('Hello', 0);
    expect(() => transitionSegment(seg, 'played')).toThrow(TTSQueueError);
  });
});
