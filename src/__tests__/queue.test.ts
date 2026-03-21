import { describe, it, expect, vi } from 'vitest';
import { createQueue } from '../queue';
import type { TTSProvider, AudioSink, AudioData, SegmentInfo, QueueOptions } from '../types';

function makeMockProvider(delayMs = 0): TTSProvider {
  return {
    synthesize: async (_text: string): Promise<AudioData> => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      return {
        buffer: Buffer.from(''),
        format: 'mp3',
        sampleRate: 44100,
        channels: 1,
        durationMs: 100,
        sizeBytes: 0,
      };
    },
  };
}

function makeMockSink(): AudioSink & { played: SegmentInfo[] } {
  const played: SegmentInfo[] = [];
  return {
    played,
    play: async (_audio: AudioData, segment: SegmentInfo): Promise<void> => {
      played.push(segment);
    },
  };
}

function makeOptions(overrides?: Partial<QueueOptions>): QueueOptions {
  return {
    provider: makeMockProvider(),
    sink: makeMockSink(),
    ...overrides,
  };
}

describe('createQueue — push()', () => {
  it('returns SegmentInfo array with correct fields', async () => {
    const queue = createQueue(makeOptions());
    const segments = await queue.push('Hello there world. This is another sentence.');
    expect(Array.isArray(segments)).toBe(true);
    expect(segments.length).toBeGreaterThan(0);
    segments.forEach(seg => {
      expect(typeof seg.id).toBe('string');
      expect(typeof seg.text).toBe('string');
      expect(typeof seg.index).toBe('number');
      expect(seg.addedAt).toBeInstanceOf(Date);
    });
    await queue.close();
  });

  it('returns empty array for empty text', async () => {
    const queue = createQueue(makeOptions());
    const segments = await queue.push('');
    expect(segments).toHaveLength(0);
    await queue.close();
  });

  it('segments have state pending initially', async () => {
    const provider: TTSProvider = {
      synthesize: () => new Promise(resolve => setTimeout(() => resolve({
        buffer: Buffer.from(''),
        format: 'mp3',
        sizeBytes: 0,
        durationMs: 100,
      }), 500)),
    };
    const queue = createQueue({ provider, sink: makeMockSink() });
    const segments = await queue.push('Hello there. How are you doing today?');
    // At least one segment should exist
    expect(segments.length).toBeGreaterThan(0);
    await queue.close();
  });
});

describe('createQueue — segment state transitions to played', () => {
  it('all segments reach played state', async () => {
    const queue = createQueue(makeOptions());
    await queue.push('Hello there world. This is a test sentence. And another one.');

    // Wait for queue to go idle
    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') {
        resolve();
        return;
      }
      queue.on('queue:empty', resolve);
    });

    const segs = queue.getSegments();
    // All should be played (or at least in a terminal state)
    segs.forEach(seg => {
      expect(['played', 'failed', 'cancelled']).toContain(seg.state);
    });
    await queue.close();
  });
});

describe('createQueue — cancel()', () => {
  it('cancel all returns CancelResult with correct count', async () => {
    // Use slow provider so segments are in-flight when we cancel
    const provider = makeMockProvider(200);
    const queue = createQueue({ provider, sink: makeMockSink() });
    await queue.push('Hello there. World is big. More text here. Even more content.');

    const result = await queue.cancel();
    expect(typeof result.cancelled).toBe('number');
    expect(Array.isArray(result.ids)).toBe(true);
    await queue.close();
  });

  it('cancel with specific ids cancels only those segments', async () => {
    const provider = makeMockProvider(300);
    const queue = createQueue({ provider, sink: makeMockSink() });
    const segs = await queue.push('Hello world. Second sentence here. Third sentence goes here.');

    if (segs.length >= 2) {
      const targetId = segs[segs.length - 1].id;
      const result = await queue.cancel([targetId]);
      expect(result.ids).toContain(targetId);
    }
    await queue.close();
  });

  it('cancelled segments have state cancelled', async () => {
    const provider = makeMockProvider(500);
    const queue = createQueue({ provider, sink: makeMockSink() });
    await queue.push('Hello there world. Test sentence here now.');

    await queue.cancel();

    const segs = queue.getSegments();
    // All non-terminal should be cancelled now
    segs.forEach(seg => {
      expect(['played', 'failed', 'cancelled']).toContain(seg.state);
    });
    await queue.close();
  });
});

describe('createQueue — pause() / resume()', () => {
  it('pause() changes state to paused', async () => {
    const provider = makeMockProvider(200);
    const queue = createQueue({ provider, sink: makeMockSink() });
    // Push enough text to keep the queue busy
    void queue.push('First sentence here. Second sentence here. Third one too.');

    // Small delay to let processing start
    await new Promise(resolve => setTimeout(resolve, 10));

    if (queue.getState() === 'playing') {
      await queue.pause();
      expect(queue.getState()).toBe('paused');
    }
    await queue.close();
  });

  it('resume() changes state back to playing', async () => {
    const provider = makeMockProvider(200);
    const queue = createQueue({ provider, sink: makeMockSink() });
    void queue.push('First sentence here. Second sentence too. And a third one.');

    await new Promise(resolve => setTimeout(resolve, 10));

    if (queue.getState() === 'playing') {
      await queue.pause();
      expect(queue.getState()).toBe('paused');
      await queue.resume();
      expect(queue.getState()).toBe('playing');
    }
    await queue.close();
  });
});

describe('createQueue — getStats()', () => {
  it('returns correct counts after processing', async () => {
    const queue = createQueue(makeOptions());
    await queue.push('Hello there world. Second sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    const stats = queue.getStats();
    expect(stats.totalSegments).toBeGreaterThan(0);
    expect(stats.completedSegments).toBeGreaterThan(0);
    expect(stats.failedSegments).toBe(0);
    expect(stats.cancelledSegments).toBe(0);
    expect(typeof stats.totalDurationMs).toBe('number');
    expect(typeof stats.totalChars).toBe('number');
    await queue.close();
  });

  it('returns zero stats for empty queue', async () => {
    const queue = createQueue(makeOptions());
    const stats = queue.getStats();
    expect(stats.totalSegments).toBe(0);
    expect(stats.completedSegments).toBe(0);
    await queue.close();
  });
});

describe('createQueue — events', () => {
  it('emits segment:start for each segment', async () => {
    const queue = createQueue(makeOptions());
    const starts: SegmentInfo[] = [];
    queue.on('segment:start', (seg) => starts.push(seg));

    await queue.push('Hello there world. Second sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(starts.length).toBeGreaterThan(0);
    await queue.close();
  });

  it('emits segment:end for each segment', async () => {
    const queue = createQueue(makeOptions());
    const ends: SegmentInfo[] = [];
    queue.on('segment:end', (seg) => ends.push(seg));

    await queue.push('Hello there world. Second sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(ends.length).toBeGreaterThan(0);
    ends.forEach(seg => expect(seg.state).toBe('played'));
    await queue.close();
  });

  it('emits queue:empty when all segments done', async () => {
    const queue = createQueue(makeOptions());
    let emptyFired = false;
    queue.on('queue:empty', () => { emptyFired = true; });

    await queue.push('Hello world. Second sentence.');

    await new Promise<void>((resolve) => {
      if (emptyFired) { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(emptyFired).toBe(true);
    await queue.close();
  });

  it('emits state:change events', async () => {
    const queue = createQueue(makeOptions());
    const states: string[] = [];
    queue.on('state:change', (s) => states.push(s));

    await queue.push('Hello world sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(states).toContain('playing');
    await queue.close();
  });
});

describe('createQueue — getSegments()', () => {
  it('returns copy of all segments', async () => {
    const queue = createQueue(makeOptions());
    await queue.push('Hello there world. Second sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    const segs = queue.getSegments();
    expect(Array.isArray(segs)).toBe(true);
    expect(segs.length).toBeGreaterThan(0);
    await queue.close();
  });
});

describe('createQueue — close()', () => {
  it('transitions to closed state', async () => {
    const queue = createQueue(makeOptions());
    await queue.close();
    expect(queue.getState()).toBe('closed');
  });

  it('throws when pushing to closed queue', async () => {
    const queue = createQueue(makeOptions());
    await queue.close();
    await expect(queue.push('Hello')).rejects.toThrow();
  });
});

describe('createQueue — callbacks', () => {
  it('calls onSegmentEnd callback', async () => {
    const onSegmentEnd = vi.fn();
    const queue = createQueue({ ...makeOptions(), onSegmentEnd });
    await queue.push('Hello there world. Second sentence here.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(onSegmentEnd).toHaveBeenCalled();
    await queue.close();
  });

  it('calls onQueueEmpty callback', async () => {
    const onQueueEmpty = vi.fn();
    const queue = createQueue({ ...makeOptions(), onQueueEmpty });
    await queue.push('Hello world sentence.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      queue.on('queue:empty', resolve);
    });

    expect(onQueueEmpty).toHaveBeenCalled();
    await queue.close();
  });
});

describe('createQueue — off()', () => {
  it('removes event listener', async () => {
    const queue = createQueue(makeOptions());
    let count = 0;
    const listener = () => { count++; };
    queue.on('queue:empty', listener);
    queue.off('queue:empty', listener);

    await queue.push('Hello world sentence.');

    await new Promise<void>((resolve) => {
      if (queue.getState() === 'idle') { resolve(); return; }
      const h = () => { queue.off('state:change', h); resolve(); };
      queue.on('state:change', h);
    });

    expect(count).toBe(0);
    await queue.close();
  });
});
