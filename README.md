# tts-queue

TTS audio streaming manager with sentence-boundary queuing, gapless playback, and fast interruption handling.

[![npm version](https://img.shields.io/npm/v/tts-queue.svg)](https://www.npmjs.com/package/tts-queue)
[![npm downloads](https://img.shields.io/npm/dt/tts-queue.svg)](https://www.npmjs.com/package/tts-queue)
[![license](https://img.shields.io/npm/l/tts-queue.svg)](https://github.com/SiluPanda/tts-queue/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/tts-queue.svg)](https://nodejs.org)
[![types](https://img.shields.io/npm/types/tts-queue.svg)](https://www.npmjs.com/package/tts-queue)

---

## Description

`tts-queue` is the orchestration layer between text that needs to be spoken and audio that the user hears. It accepts text -- either as complete strings or as streaming token sequences from an LLM -- splits it into sentence-sized segments, sends each segment to a pluggable TTS provider for audio synthesis, and plays the resulting audio back-to-back through a pluggable audio sink.

The package handles every concern that sits between those two endpoints: sentence boundary detection (abbreviations, decimals, ellipsis, URLs), ordered FIFO playback queuing, per-segment lifecycle state management, cancellation of in-flight synthesis calls via `AbortController`, pause/resume, and error recovery. It replaces the 200-400 lines of async queue management, timer coordination, and provider-specific plumbing that every voice AI application otherwise implements from scratch.

Zero runtime dependencies. TypeScript-first. Provider-agnostic.

---

## Installation

```bash
npm install tts-queue
```

Requires Node.js 18 or later.

---

## Quick Start

```typescript
import { createQueue } from 'tts-queue';
import type { TTSProvider, AudioSink, AudioData, SegmentInfo } from 'tts-queue';

// 1. Define a TTS provider (wrap any TTS SDK)
const provider: TTSProvider = {
  async synthesize(text: string): Promise<AudioData> {
    const response = await yourTTSClient.synthesize(text);
    return {
      buffer: response.audioBuffer,
      format: 'mp3',
      sizeBytes: response.audioBuffer.length,
      durationMs: response.durationMs,
    };
  },
};

// 2. Define an audio sink (where audio goes)
const sink: AudioSink = {
  async play(audio: AudioData, segment: SegmentInfo): Promise<void> {
    await speaker.play(audio.buffer);
  },
};

// 3. Create the queue and push text
const queue = createQueue({ provider, sink });

await queue.push('Hello there. How are you doing today? The weather is nice.');
// Sentences are split, synthesized, and played in order automatically.

// 4. Wait for all segments to finish
await queue.drain();

// 5. Clean up
await queue.close();
```

---

## Features

- **Sentence-boundary splitting** -- Automatically segments text at sentence boundaries with handling for abbreviations (Dr., Mr., Mrs., etc.), decimal numbers, ellipsis, and URLs/domains.
- **Clause-boundary fallback** -- Long sentences exceeding `maxChars` are split at semicolons, em dashes, and commas.
- **Short segment filtering** -- Segments shorter than `minChars` are filtered to prevent choppy single-word synthesis.
- **Provider-agnostic** -- Works with any TTS provider through a simple `TTSProvider` interface. Swap providers without rewriting queue logic.
- **Pluggable audio sinks** -- Route audio to speakers, files, WebSockets, or test buffers via the `AudioSink` interface.
- **Ordered FIFO playback** -- Segments play in strict sequential order.
- **Pause / Resume** -- Suspend and resume playback without losing queue position. Calls through to sink `pause()` / `resume()` when available.
- **Fast interruption** -- `cancel()` aborts all in-flight synthesis calls via `AbortController` and transitions the queue to idle.
- **Priority insertion** -- `pushImmediate()` cancels pending segments and inserts new text at the front of the queue.
- **Per-segment lifecycle** -- Each segment progresses through `pending`, `synthesizing`, `synthesized`, `playing`, `played` (or `failed` / `cancelled`) with timestamp tracking at every transition.
- **Typed events** -- Subscribe to `segment:start`, `segment:end`, `segment:error`, `queue:empty`, `queue:drain`, and `state:change` events with full TypeScript typing.
- **Callback hooks** -- Optional `onSegmentStart`, `onSegmentEnd`, `onSegmentError`, and `onQueueEmpty` callbacks on `QueueOptions`.
- **Queue statistics** -- `getStats()` returns total, completed, failed, cancelled, and pending segment counts, total duration, and total characters processed.
- **Custom splitting** -- Provide a custom `splitting.custom` function to override the built-in sentence splitter.
- **Zero runtime dependencies** -- Only dev dependencies for TypeScript, ESLint, and Vitest.

---

## API Reference

### `createQueue(options: QueueOptions): TTSQueue`

Factory function that creates and returns a `TTSQueue` instance.

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({
  provider,          // Required: TTSProvider
  sink,              // Required: AudioSink
  splitting: {       // Optional: splitting configuration
    maxChars: 200,
    minChars: 10,
    on: 'sentence',
    custom: (text) => text.split('\n'),
  },
  concurrency: 1,    // Optional: concurrent synthesis limit
  prefetchCount: 2,  // Optional: segments to pre-fetch
  onSegmentStart: (segment) => { /* ... */ },
  onSegmentEnd: (segment) => { /* ... */ },
  onSegmentError: (error, segment) => { /* ... */ },
  onQueueEmpty: () => { /* ... */ },
});
```

---

### TTSQueue

The queue instance returned by `createQueue`. Implements the `TTSQueue` interface.

#### `queue.push(text: string): Promise<SegmentInfo[]>`

Split text into sentences and append segments to the queue. Returns the created `SegmentInfo` objects. Processing begins immediately.

```typescript
const segments = await queue.push('First sentence. Second sentence. Third sentence.');
console.log(segments.length); // 3
```

#### `queue.pushImmediate(text: string): Promise<SegmentInfo[]>`

Cancel all pending and in-progress segments, then insert new text at the front of the queue. Use this for interruption-and-replace patterns (e.g., the user asks a new question while the previous answer is still playing).

```typescript
const segments = await queue.pushImmediate('Interrupting with new content.');
```

#### `queue.pause(): Promise<void>`

Pause playback. The queue transitions to `paused` state. If the sink implements `pause()`, it is called.

```typescript
await queue.pause();
console.log(queue.getState()); // 'paused'
```

#### `queue.resume(): Promise<void>`

Resume playback after a pause. The queue transitions back to `playing` state. If the sink implements `resume()`, it is called. Segment processing resumes automatically.

```typescript
await queue.resume();
console.log(queue.getState()); // 'playing'
```

#### `queue.cancel(ids?: string[]): Promise<CancelResult>`

Cancel segments. When called with no arguments, cancels all non-terminal segments, aborts in-flight synthesis via `AbortController`, and resets the queue to `idle`. When called with specific segment IDs, cancels only those segments.

```typescript
// Cancel everything
const result = await queue.cancel();
console.log(result.cancelled); // number of segments cancelled
console.log(result.ids);       // IDs of cancelled segments

// Cancel specific segments
const result2 = await queue.cancel(['segment-id-1', 'segment-id-2']);
```

#### `queue.drain(): Promise<void>`

Wait for all segments to finish processing. Transitions the queue to `draining` state while segments complete, then resolves when the queue reaches `idle`.

```typescript
await queue.push('Some text to speak.');
await queue.drain(); // resolves when all audio has finished playing
```

#### `queue.close(): Promise<void>`

Cancel all activity and permanently close the queue. Transitions to `closed` state. No more pushes are accepted after this call.

```typescript
await queue.close();
console.log(queue.getState()); // 'closed'
```

#### `queue.getState(): QueueState`

Returns the current queue state: `'idle'`, `'playing'`, `'paused'`, `'draining'`, or `'closed'`.

#### `queue.getStats(): QueueStats`

Returns cumulative statistics for all segments processed by the queue.

```typescript
const stats = queue.getStats();
// {
//   totalSegments: 5,
//   completedSegments: 3,
//   failedSegments: 0,
//   cancelledSegments: 2,
//   pendingSegments: 0,
//   totalDurationMs: 4500,
//   totalChars: 312,
// }
```

#### `queue.getSegments(): SegmentInfo[]`

Returns a snapshot (copy) of all segments and their current state.

#### `queue.on<K>(event: K, listener: TTSQueueEvents[K]): void`

Subscribe to a typed queue event.

#### `queue.off<K>(event: K, listener: TTSQueueEvents[K]): void`

Unsubscribe from a typed queue event.

---

### Events

| Event            | Payload                       | Description                                    |
|------------------|-------------------------------|------------------------------------------------|
| `segment:start`  | `SegmentInfo`                 | Fired when synthesis begins for a segment      |
| `segment:end`    | `SegmentInfo`                 | Fired when a segment finishes playing          |
| `segment:error`  | `TTSQueueError, SegmentInfo`  | Fired on synthesis or playback error           |
| `queue:empty`    | --                            | Fired when all segments have been played       |
| `queue:drain`    | --                            | Fired when the queue has been drained          |
| `state:change`   | `QueueState`                  | Fired on every queue state transition          |

---

### `splitSentences(text: string, options?: SplitOptions): string[]`

Standalone sentence splitter. Used internally by `createQueue`, but also exported for direct use.

```typescript
import { splitSentences } from 'tts-queue';

splitSentences('Dr. Smith went to the store. She bought apples.');
// ['Dr. Smith went to the store.', 'She bought apples.']

splitSentences('Hello. World.', { minLength: 1 });
// ['Hello.', 'World.']

splitSentences('');
// []
```

#### SplitOptions

| Property              | Type      | Default | Description                                                     |
|-----------------------|-----------|---------|-----------------------------------------------------------------|
| `minLength`           | `number`  | `10`    | Minimum segment length in characters. Shorter segments are filtered out. |
| `maxLength`           | `number`  | `200`   | Maximum segment length. Longer segments are split at clause boundaries. |
| `preserveWhitespace`  | `boolean` | `false` | When `true`, preserves leading/trailing whitespace in segments. |

The built-in splitter handles:

- **Abbreviations**: Mr., Mrs., Ms., Dr., Prof., St., Jr., Sr., vs., etc., e.g., i.e., Fig., Approx., Dept., Est., Govt., Inc., Corp., Ltd., Co., U.S., U.K., U.N.
- **Decimal numbers**: `98.6`, `3.14`, `$9.99` -- periods between digits are not treated as boundaries.
- **Ellipsis**: `...` -- consecutive periods are not treated as boundaries.
- **URLs and domains**: `example.com` -- periods followed immediately by a letter or digit (no space) are not treated as boundaries.
- **Single-letter initials**: `A. B. Smith` -- single uppercase letters followed by a period are not treated as boundaries.
- **Quoted strings**: Sentence boundaries inside quoted strings (double quotes, smart quotes) are ignored.
- **Long sentence fallback**: Sentences exceeding `maxLength` are split at semicolons, em dashes (`---`, unicode em dash), then commas (only when both halves meet `minLength`).

---

### `createSegment(text: string, index: number): SegmentInfo`

Create a new segment in `pending` state with a unique UUID, timestamp, and the given text and index.

```typescript
import { createSegment } from 'tts-queue';

const segment = createSegment('Hello world.', 0);
// { id: 'uuid', text: 'Hello world.', index: 0, state: 'pending', addedAt: Date }
```

---

### `transitionSegment(segment: SegmentInfo, newState: SegmentState, extra?: Partial<SegmentInfo>): SegmentInfo`

Immutably transition a segment to a new state. Enforces the valid state transition graph and sets appropriate timestamps (`synthesisStartedAt`, `synthesisCompletedAt`, `playbackStartedAt`, `playbackCompletedAt`). Throws `TTSQueueError` on invalid transitions. The original segment object is never mutated.

Valid transitions:

```
pending      -> synthesizing | cancelled
synthesizing -> synthesized  | failed | cancelled
synthesized  -> playing      | cancelled
playing      -> played       | failed | cancelled
played       -> (terminal)
failed       -> (terminal)
cancelled    -> (terminal)
```

---

### TTSQueueError

Custom error class for all errors originating from the queue. Extends `Error` with additional context fields.

```typescript
import { TTSQueueError } from 'tts-queue';

try {
  // ...
} catch (err) {
  if (err instanceof TTSQueueError) {
    console.log(err.name);    // 'TTSQueueError'
    console.log(err.stage);   // 'synthesis' | 'playback' | 'splitting' | 'internal'
    console.log(err.cause);   // underlying Error, if any
    console.log(err.segment); // SegmentInfo, if associated with a segment
  }
}
```

#### Error Factory Functions

| Function          | Stage        | Description                          |
|-------------------|--------------|--------------------------------------|
| `synthError`      | `synthesis`  | TTS provider synthesis failure       |
| `playbackError`   | `playback`   | Audio sink playback failure          |
| `splittingError`  | `splitting`  | Text splitting failure               |
| `internalError`   | `internal`   | Queue internal error (invalid state) |

Each factory accepts `(message: string, cause?: Error, segment?: SegmentInfo)` and returns a `TTSQueueError`.

```typescript
import { synthError } from 'tts-queue';

const err = synthError('Provider timeout', new Error('ETIMEDOUT'), segmentInfo);
```

---

## Configuration

### QueueOptions

| Property          | Type                                        | Required | Default     | Description                                              |
|-------------------|---------------------------------------------|----------|-------------|----------------------------------------------------------|
| `provider`        | `TTSProvider`                               | Yes      | --          | TTS synthesis provider                                   |
| `sink`            | `AudioSink`                                 | Yes      | --          | Audio output destination                                 |
| `splitting`       | `SplittingOptions`                          | No       | `{}`        | Sentence splitting configuration                         |
| `concurrency`     | `number`                                    | No       | `1`         | Maximum concurrent synthesis calls                       |
| `prefetchCount`   | `number`                                    | No       | `2`         | Number of segments to pre-fetch ahead of playback        |
| `onSegmentStart`  | `(segment: SegmentInfo) => void`            | No       | --          | Callback when a segment begins synthesis                 |
| `onSegmentEnd`    | `(segment: SegmentInfo) => void`            | No       | --          | Callback when a segment finishes playback                |
| `onSegmentError`  | `(error: TTSQueueError, segment) => void`   | No       | --          | Callback on segment-level errors                         |
| `onQueueEmpty`    | `() => void`                                | No       | --          | Callback when all segments have completed                |

### SplittingOptions

| Property   | Type                                    | Default      | Description                                           |
|------------|-----------------------------------------|--------------|-------------------------------------------------------|
| `maxChars` | `number`                                | `200`        | Maximum segment length before clause-boundary split   |
| `minChars` | `number`                                | `10`         | Minimum segment length; shorter segments are filtered |
| `on`       | `'sentence' \| 'word' \| 'paragraph'`  | `'sentence'` | Splitting strategy hint                               |
| `custom`   | `(text: string) => string[]`            | --           | Custom splitter function; overrides built-in logic    |

### TTSProvider Interface

```typescript
interface TTSProvider {
  synthesize(text: string, options?: SynthesisOptions): Promise<AudioData>;
  synthesizeStream?(text: string, options?: SynthesisOptions): AsyncIterable<AudioChunk>;
}
```

| Method             | Required | Description                                               |
|--------------------|----------|-----------------------------------------------------------|
| `synthesize`       | Yes      | Synthesize text into a complete audio buffer              |
| `synthesizeStream` | No       | Synthesize text as a stream of audio chunks               |

### SynthesisOptions

| Property     | Type          | Description                              |
|--------------|---------------|------------------------------------------|
| `voice`      | `string`      | Voice identifier for the TTS engine      |
| `speed`      | `number`      | Playback speed multiplier                |
| `format`     | `AudioFormat` | Desired output audio format              |
| `sampleRate` | `number`      | Desired output sample rate in Hz         |

### AudioSink Interface

```typescript
interface AudioSink {
  play(audio: AudioData, segment: SegmentInfo): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  stop?(): Promise<void>;
}
```

| Method   | Required | Description                                          |
|----------|----------|------------------------------------------------------|
| `play`   | Yes      | Play audio data for a given segment                  |
| `pause`  | No       | Pause current playback                               |
| `resume` | No       | Resume paused playback                               |
| `stop`   | No       | Immediately stop all playback                        |

### AudioData

| Property     | Type          | Required | Description                                   |
|--------------|---------------|----------|-----------------------------------------------|
| `buffer`     | `Buffer`      | Yes      | Raw audio bytes                               |
| `format`     | `AudioFormat` | Yes      | Audio codec: `'mp3' \| 'wav' \| 'ogg' \| 'pcm' \| 'aac' \| 'opus'` |
| `sizeBytes`  | `number`      | Yes      | Size of the audio buffer in bytes             |
| `sampleRate` | `number`      | No       | Sample rate in Hz                             |
| `channels`   | `number`      | No       | Number of audio channels                      |
| `durationMs` | `number`      | No       | Duration of the audio in milliseconds         |

### SegmentInfo

| Property                | Type           | Description                                         |
|-------------------------|----------------|-----------------------------------------------------|
| `id`                    | `string`       | Unique UUID for the segment                         |
| `text`                  | `string`       | Source text for the segment                         |
| `index`                 | `number`       | 0-based position in the queue                       |
| `state`                 | `SegmentState` | Current lifecycle state                             |
| `addedAt`               | `Date`         | Timestamp when the segment was created              |
| `synthesisStartedAt`    | `Date`         | Timestamp when synthesis began (optional)           |
| `synthesisCompletedAt`  | `Date`         | Timestamp when synthesis completed (optional)       |
| `playbackStartedAt`     | `Date`         | Timestamp when playback began (optional)            |
| `playbackCompletedAt`   | `Date`         | Timestamp when playback completed (optional)        |
| `durationMs`            | `number`       | Audio duration in milliseconds (optional)           |
| `error`                 | `Error`        | Error that caused failure (optional)                |

---

## Error Handling

All errors emitted by the queue are instances of `TTSQueueError` with a `stage` property indicating where the error originated.

### Synthesis Errors

When a TTS provider's `synthesize()` call throws or rejects, the segment transitions to `failed`, a `segment:error` event is emitted with `stage: 'synthesis'`, and the queue advances to the next segment. The queue does not stop.

```typescript
queue.on('segment:error', (error, segment) => {
  if (error.stage === 'synthesis') {
    console.error(`Synthesis failed for "${segment.text}":`, error.cause);
  }
});
```

### Playback Errors

When the audio sink's `play()` method throws, the segment transitions to `failed`, a `segment:error` event is emitted with `stage: 'playback'`, and the queue advances to the next segment.

### Cancellation Errors

If a synthesis call is aborted via `cancel()`, the `AbortController` signal fires and the segment transitions to `cancelled` without emitting an error event. This is the expected path for interruptions.

### Closed Queue

Calling `push()` or `pushImmediate()` on a closed queue throws a `TTSQueueError` with `stage: 'internal'` and the message `"Queue is closed"`.

### Invalid State Transitions

Attempting an invalid segment state transition (e.g., `pending` to `played`) throws a `TTSQueueError` with `stage: 'internal'`. This guards against programming errors in provider or sink implementations.

---

## Advanced Usage

### Priority Interruption

Replace the current playback with new content immediately:

```typescript
// User asks a new question while the previous answer is playing
await queue.pushImmediate('Here is the answer to your new question.');
// All pending/in-progress segments are cancelled, new text takes priority
```

### Selective Cancellation

Cancel specific segments by ID while allowing others to continue:

```typescript
const segments = await queue.push('Sentence one. Sentence two. Sentence three.');
// Cancel only the last segment
await queue.cancel([segments[2].id]);
```

### Custom Sentence Splitting

Override the built-in splitter with your own logic:

```typescript
const queue = createQueue({
  provider,
  sink,
  splitting: {
    custom: (text) => text.split(/\n\n/), // Split on double newlines
  },
});
```

### Event-Driven Progress Tracking

```typescript
queue.on('segment:start', (segment) => {
  console.log(`Synthesizing: "${segment.text}" (segment ${segment.index})`);
});

queue.on('segment:end', (segment) => {
  console.log(`Finished: "${segment.text}" (${segment.durationMs}ms)`);
});

queue.on('state:change', (state) => {
  console.log(`Queue state: ${state}`);
});

queue.on('queue:empty', () => {
  console.log('All segments processed');
});
```

### Monitoring with Callbacks

```typescript
const queue = createQueue({
  provider,
  sink,
  onSegmentStart: (seg) => metrics.trackSynthesisStart(seg.id),
  onSegmentEnd: (seg) => metrics.trackSynthesisEnd(seg.id, seg.durationMs),
  onSegmentError: (err, seg) => logger.error({ err, segmentId: seg.id }),
  onQueueEmpty: () => logger.info('Queue drained'),
});
```

### OpenAI TTS Provider Example

```typescript
import OpenAI from 'openai';
import type { TTSProvider, AudioData } from 'tts-queue';

const openai = new OpenAI();

const openaiProvider: TTSProvider = {
  async synthesize(text: string): Promise<AudioData> {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      format: 'mp3',
      sizeBytes: buffer.length,
    };
  },
};
```

### ElevenLabs TTS Provider Example

```typescript
import type { TTSProvider, AudioData } from 'tts-queue';

const elevenLabsProvider: TTSProvider = {
  async synthesize(text: string): Promise<AudioData> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' }),
      },
    );
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      format: 'mp3',
      sizeBytes: buffer.length,
    };
  },
};
```

### Test Buffer Sink

Collect all audio data in memory for assertions:

```typescript
import type { AudioSink, AudioData, SegmentInfo } from 'tts-queue';

function createTestSink(): AudioSink & { played: SegmentInfo[] } {
  const played: SegmentInfo[] = [];
  return {
    played,
    async play(audio: AudioData, segment: SegmentInfo): Promise<void> {
      played.push(segment);
    },
  };
}
```

---

## TypeScript

`tts-queue` is written in TypeScript and ships with full type declarations (`dist/index.d.ts`). All exports are fully typed.

### Exported Types

```typescript
import type {
  // Core interfaces
  TTSQueue,
  TTSProvider,
  AudioSink,
  QueueOptions,

  // Data types
  AudioData,
  AudioChunk,
  AudioFormat,        // 'mp3' | 'wav' | 'ogg' | 'pcm' | 'aac' | 'opus'
  SynthesisOptions,

  // Segment types
  SegmentInfo,
  SegmentState,       // 'pending' | 'synthesizing' | 'synthesized' | 'playing'
                      //   | 'played' | 'cancelled' | 'failed'

  // Queue types
  QueueState,         // 'idle' | 'playing' | 'paused' | 'draining' | 'closed'
  QueueStats,
  CancelResult,
  TTSQueueEvents,

  // Splitting
  SplittingOptions,
  SplitOptions,

  // Errors
  TTSQueueStage,      // 'synthesis' | 'playback' | 'splitting' | 'internal'
} from 'tts-queue';
```

### Exported Values

```typescript
import {
  createQueue,
  splitSentences,
  createSegment,
  transitionSegment,
  TTSQueueError,
  synthError,
  playbackError,
  splittingError,
  internalError,
} from 'tts-queue';
```

---

## License

[MIT](./LICENSE)
