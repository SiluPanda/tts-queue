# tts-queue

Text-to-speech audio queue with sentence splitting, pre-buffering, and gapless playback.

## Install

```bash
npm install tts-queue
```

## Quick Start

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({ provider, sink });
queue.push('Hello world. How are you today?');
```

## API

### `createQueue(options: QueueOptions): TTSQueue`

Creates a new TTS queue. Requires `provider` and `sink`.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `TTSProvider` | required | TTS synthesis provider |
| `sink` | `AudioSink` | required | Audio output sink |
| `splitting.minChars` | `number` | `10` | Minimum sentence length to keep |
| `splitting.maxChars` | `number` | `200` | Maximum sentence length before clause-splitting |
| `splitting.custom` | `(text) => string[]` | — | Override built-in sentence splitter |
| `onSegmentStart` | `(seg) => void` | — | Called when a segment starts synthesizing |
| `onSegmentEnd` | `(seg) => void` | — | Called when a segment finishes playing |
| `onSegmentError` | `(err, seg) => void` | — | Called on synthesis or playback error |
| `onQueueEmpty` | `() => void` | — | Called when all segments have played |

### `TTSQueue` methods

#### `push(text): Promise<SegmentInfo[]>`

Split text into sentences and append to the queue. Returns the created segment descriptors.

```typescript
const segs = await queue.push('First sentence. Second sentence.');
```

#### `pushImmediate(text): Promise<SegmentInfo[]>`

Same as `push` but cancels all pending/in-flight segments and prepends the new ones to the front. Useful for interrupting the current queue.

#### `pause(): Promise<void>`

Pause playback. Synthesis continues in background (pre-buffering is not paused). Transitions state to `'paused'`.

#### `resume(): Promise<void>`

Resume playback after a pause. Transitions state back to `'playing'`.

#### `cancel(ids?: string[]): Promise<CancelResult>`

Cancel segments. If `ids` is provided, cancels only those segments. If omitted, cancels all active segments and resets the queue to `'idle'`.

Returns `{ cancelled: number, ids: string[] }`.

#### `drain(): Promise<void>`

Wait for all currently-queued segments to finish playing. Resolves when the queue goes idle.

#### `close(): Promise<void>`

Cancel all activity and permanently close the queue. No more pushes are accepted after this.

#### `getState(): QueueState`

Returns the current queue state: `'idle' | 'playing' | 'paused' | 'draining' | 'closed'`.

#### `getStats(): QueueStats`

Returns cumulative statistics:

```typescript
{
  totalSegments: number,
  completedSegments: number,
  failedSegments: number,
  cancelledSegments: number,
  pendingSegments: number,
  totalDurationMs: number,
  totalChars: number,
}
```

#### `getSegments(): SegmentInfo[]`

Returns a snapshot copy of all segments ever created by this queue.

#### `on(event, listener)` / `off(event, listener)`

Subscribe/unsubscribe to typed events.

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `segment:start` | `SegmentInfo` | Fired when synthesis begins for a segment |
| `segment:end` | `SegmentInfo` | Fired when a segment finishes playing |
| `segment:error` | `TTSQueueError, SegmentInfo` | Fired on synthesis or playback error |
| `queue:empty` | — | Fired when all segments have been played |
| `state:change` | `QueueState` | Fired on every queue state transition |

## Sentence Splitting

`splitSentences` is also exported for standalone use:

```typescript
import { splitSentences } from 'tts-queue';

const sentences = splitSentences('Dr. Smith said hello. How are you?', {
  minLength: 10,   // filter segments shorter than this
  maxLength: 200,  // split long sentences at clause boundaries
});
// => ["Dr. Smith said hello.", "How are you?"]
```

Handles:
- Abbreviations: `Mr.`, `Mrs.`, `Dr.`, `St.`, `vs.`, `etc.`, `e.g.`, `i.e.`, and more
- Decimal numbers: `3.14`, `$9.99`
- Ellipsis: `...`
- Long sentence splitting at `;`, em-dash, `,`

## Segment Lifecycle

```
pending -> synthesizing -> synthesized -> playing -> played
                                    \-> failed
         \-> cancelled (from any non-terminal state)
```

## Provider Interface

```typescript
interface TTSProvider {
  synthesize(text: string, options?: SynthesisOptions): Promise<AudioData>;
}
```

## Sink Interface

```typescript
interface AudioSink {
  play(audio: AudioData, segment: SegmentInfo): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  stop?(): Promise<void>;
}
```

## License

MIT
