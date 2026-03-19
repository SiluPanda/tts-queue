# tts-queue -- Task Breakdown

This file tracks all implementation tasks derived from SPEC.md. Each task is granular, actionable, and maps to specific spec requirements.

---

## Phase 1: Project Scaffolding and Type Definitions

- [ ] **Install dev dependencies** — Add `typescript` (^5.0), `vitest` (^1.0), and `eslint` (^8.0) as dev dependencies in `package.json`. Verify `npm run build`, `npm run test`, and `npm run lint` scripts are functional with the installed tooling. | Status: not_done

- [ ] **Create `src/types.ts` -- Core interfaces** — Define all core TypeScript interfaces and types: `TTSProvider`, `AudioSink`, `AudioData`, `AudioChunk`, `AudioFormat`, `QueueOptions`, `SplittingOptions`, `TTSQueue`, `SegmentInfo`, `SegmentState`, `QueueState`, `QueueStats`, `CancelResult`, `TTSQueueError`, and `TTSQueueEvents`. These must exactly match the type definitions in spec sections 7, 8, 9, 12, and 14. | Status: not_done

- [ ] **Create `src/errors.ts` -- Error types and utilities** — Implement the `TTSQueueError` class with fields: `stage` (`'synthesis' | 'playback' | 'splitting' | 'internal'`), `cause` (Error), `message` (string), and optional `segment` (SegmentInfo). Provide factory functions for creating errors at each stage. | Status: not_done

- [ ] **Create `src/index.ts` -- Public API barrel export** — Export `createQueue`, all type definitions, sink factory functions (`createCallbackSink`, `createBufferSink`, `createStreamSink`), and test utilities (`createMockProvider`, `createMockSink` from `tts-queue/test`). This is the single entry point for the package. | Status: not_done

---

## Phase 2: Segment Lifecycle

- [ ] **Create `src/segment.ts` -- Segment class** — Implement the `Segment` class representing a single unit of text-to-audio work. Fields: `index` (0-based), `text` (source string), `state` (SegmentState), `audioData` (Uint8Array or null), `durationMs` (number or null), `abortController` (AbortController or null). | Status: not_done

- [ ] **Implement segment state transitions** — Enforce the valid state transition graph: `pending -> generating -> ready -> playing -> done`, and `pending|generating|ready|playing -> cancelled` (via cancel). Throw an internal error on invalid transitions. | Status: not_done

- [ ] **Implement segment timing tracking** — Track timestamps for each lifecycle event on the segment: `synthesisStartedAt`, `firstAudioChunkAt`, `synthesisCompletedAt`, `playbackStartedAt`, `playbackEndedAt`. Compute `synthesisLatencyMs` as the delta between `synthesisStartedAt` and `firstAudioChunkAt`. | Status: not_done

- [ ] **Implement segment audio data management** — Allow appending audio chunks (for streaming providers) and setting complete audio buffers (for batch providers). Support releasing audio data after playback when `retainAudio` is false. | Status: not_done

- [ ] **Implement `toSegmentInfo()` method** — Return a `SegmentInfo` object from the segment's current state: `index`, `text`, `state`, `durationMs`, `synthesisLatencyMs`. | Status: not_done

---

## Phase 3: Sentence Splitting

- [ ] **Create `src/splitter.ts` -- Built-in sentence splitter** — Implement `splitSentences(text: string, options: SplittingOptions): string[]` that splits text into sentence-sized segments using heuristic rules. | Status: not_done

- [ ] **Implement primary boundary detection** — Detect sentence boundaries at period (`.`), question mark (`?`), and exclamation mark (`!`) followed by whitespace or end-of-string. | Status: not_done

- [ ] **Implement abbreviation handling** — Maintain a default abbreviation list: `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `Prof.`, `U.S.`, `U.K.`, `St.`, `Jr.`, `Sr.`, `vs.`, `etc.`, `i.e.`, `e.g.`. Periods after these abbreviations must NOT be treated as sentence boundaries. Support additional user-provided abbreviations via `SplittingOptions.abbreviations`. | Status: not_done

- [ ] **Implement decimal number handling** — Periods within decimal numbers (e.g., `98.6`, `3.14`, `$99.99`) must not be treated as sentence boundaries. Detect digit-period-digit patterns. | Status: not_done

- [ ] **Implement ellipsis handling** — Three consecutive periods (`...`) must not be treated as a sentence boundary. | Status: not_done

- [ ] **Implement URL and email handling** — Periods within URLs (e.g., `example.com`) and email addresses must not be treated as sentence boundaries. | Status: not_done

- [ ] **Implement long sentence fallback (clause-boundary splitting)** — When a sentence exceeds `maxSegmentLength` (default 200 chars), split at clause boundaries in priority order: (1) semicolon + whitespace, (2) colon + whitespace (not within time expressions), (3) em dash (`" -- "` or `"\u2014"`), (4) comma + whitespace (only if both resulting segments meet `minSegmentLength`). | Status: not_done

- [ ] **Implement short segment merging** — When a segment is shorter than `minSegmentLength` (default 10 chars), merge it with the next segment. If it is the last segment, send as-is. | Status: not_done

- [ ] **Implement custom splitter override** — When `SplittingOptions.splitSentences` is provided, use it instead of the built-in splitter. Pass the full text string and use the returned string array as segments. | Status: not_done

- [ ] **Implement streaming sentence aggregation** — Create a `StreamingSplitter` class that accumulates tokens into a buffer and emits complete sentences. Algorithm: append each token, scan for boundary markers, use one-token lookahead for ambiguous periods (wait for next token to confirm), emit completed sentences, flush remaining buffer when stream ends. Apply the same long-sentence fallback and short-segment merging rules. | Status: not_done

---

## Phase 4: Core Queue State Machine

- [ ] **Create `src/queue.ts` -- TTSQueue class** — Implement the `TTSQueue` class that manages the four-stage pipeline: text ingestion, TTS generation, playback queue, and audio output. Extend Node.js `EventEmitter` for typed event emission. | Status: not_done

- [ ] **Implement queue state management** — Track the four queue states: `idle`, `playing`, `paused`, `draining`. Implement `getState(): QueueState`. Emit `stateChange(from, to)` events on every transition. | Status: not_done

- [ ] **Implement queue state transitions** — Enforce valid transitions: `idle -> playing` (on enqueue/play), `playing -> paused` (on pause), `paused -> playing` (on resume), `playing -> draining` (on drain with input ended), `draining -> idle` (last segment done), `playing|paused|draining -> idle` (on cancel). | Status: not_done

- [ ] **Implement `enqueue(text: string): Promise<void>`** — Accept a complete text string. Split into sentences using the configured splitter. Create a `Segment` for each sentence in `pending` state. Append segments to the queue. Trigger the generation loop. Return a promise that resolves when segments are added (blocks if queue is at `maxQueueSize`). | Status: not_done

- [ ] **Implement `enqueueStream(stream): Promise<void>`** — Accept `AsyncIterable<string>` (raw tokens) or `AsyncIterable<{ content: string }>` (stream-tokens output). Detect the input type by checking the shape of yielded values. For raw tokens, use the streaming splitter. For stream-tokens output, extract `.content` directly. Create segments as sentences complete. Return a promise that resolves when the source stream ends. | Status: not_done

- [ ] **Implement `play(): void`** — If the queue has segments in `ready` state, begin playing the first one. If the queue is empty, set a flag so playback begins automatically when the first segment becomes ready. Transition queue to `playing` state. | Status: not_done

- [ ] **Implement `pause(): void`** — Suspend playback. Call `sink.pause()` if available. Transition queue to `paused` state. Pre-buffering continues (generation loop does NOT pause). | Status: not_done

- [ ] **Implement `resume(): void`** — Resume playback after pause. Call `sink.resume()` if available. Transition queue to `playing` state. | Status: not_done

- [ ] **Implement `drain(): void`** — Signal that no more text will be enqueued. Transition to `draining` state. When the last segment finishes playing, emit `ended` and transition to `idle`. Without `drain()`, the queue waits indefinitely for more input after the last segment finishes. | Status: not_done

- [ ] **Implement `getStats(): QueueStats`** — Return cumulative statistics: `totalSegments`, `completedSegments`, `cancelledSegments`, `failedSegments`, `totalPlaybackDurationMs`, `averageSynthesisLatencyMs`, `averageGapMs`, `bufferingCount`, `cancellationCount`. Track these values incrementally as segments progress through their lifecycle. | Status: not_done

- [ ] **Implement `getCurrentSegment(): SegmentInfo | null`** — Return info about the currently playing segment, or null if nothing is playing. | Status: not_done

- [ ] **Implement `pendingCount` readonly property** — Return the number of segments in the queue excluding those in `done` or `cancelled` state. | Status: not_done

- [ ] **Implement `isPlaying` readonly property** — Return true if the queue state is `playing`. | Status: not_done

- [ ] **Implement `setProvider(provider: TTSProvider): void`** — Replace the TTS provider at runtime. The new provider is used for all subsequent segments. Segments already in `generating` or `ready` state continue with the old provider. | Status: not_done

- [ ] **Implement `destroy(): void`** — Cancel all activity, remove all event listeners, release all references. The queue must not be used after `destroy()`. | Status: not_done

- [ ] **Implement typed event emission** — Emit all events defined in `TTSQueueEvents`: `playing`, `segmentStart(segment)`, `segmentEnd(segment)`, `ended`, `buffering`, `bufferingEnd`, `stateChange(from, to)`, `drain`, `error(error)`. Implement `on()` and `off()` with proper typing. | Status: not_done

- [ ] **Implement autoplay behavior** — When `autoplay` is true (default), begin playback automatically when the first segment becomes `ready`. When false, require an explicit `play()` call. | Status: not_done

- [ ] **Implement external AbortSignal support** — Accept an optional `signal` in `QueueOptions`. When the external signal is aborted, call `cancel()` on the queue. | Status: not_done

---

## Phase 5: TTS Generation Loop

- [ ] **Create `src/generation.ts` -- Generation loop** — Implement the generation loop that watches for `pending` segments within the pre-buffer window and sends them to the TTS provider for synthesis. | Status: not_done

- [ ] **Implement pre-buffer window tracking** — Maintain `playbackIndex` and `generationIndex` pointers. The pre-buffer window is `[playbackIndex + 1, playbackIndex + preBufferCount]`. Segments within this window that are in `pending` state should start generating. | Status: not_done

- [ ] **Implement batch provider handling** — Detect batch mode by checking if the return value of `synthesize()` has a `.then` method (is a Promise). Await the promise. On resolve, transition the segment from `generating` to `ready` with the complete audio buffer. | Status: not_done

- [ ] **Implement streaming provider handling** — Detect streaming mode by checking if the return value has `[Symbol.asyncIterator]`. Consume chunks as they arrive, appending them to the segment's audio buffer. Transition to `ready` when the final chunk arrives (or the iterator completes). | Status: not_done

- [ ] **Implement per-segment AbortController** — Create a new `AbortController` for each segment when it transitions from `pending` to `generating`. Pass the signal to `TTSProvider.synthesize()`. Store the controller on the segment for cancellation. | Status: not_done

- [ ] **Implement synthesis timeout** — If a TTS synthesis call does not complete within `synthesisTimeoutMs` (default 30000ms), abort the segment's `AbortController`, transition the segment to `cancelled`, emit an `error` event with a timeout description, and advance to the next segment. | Status: not_done

- [ ] **Implement generation window advancement** — When `playbackIndex` advances (segment finishes playing), re-check the pre-buffer window for new `pending` segments that have entered the window and start their generation. | Status: not_done

- [ ] **Implement provider `warmup()` call** — During `createQueue()`, if the provider has a `warmup()` method, call it (non-blocking). This allows providers to establish connections or pre-load models to reduce first-synthesis latency. | Status: not_done

- [ ] **Implement format compatibility check** — At queue creation, compare `provider.outputFormat` with `sink.expectedFormat` (if both are defined). If they do not match, emit a warning via the `error` event with `stage: 'internal'`. | Status: not_done

---

## Phase 6: Playback Loop

- [ ] **Create `src/playback.ts` -- Playback loop** — Implement the playback loop that feeds audio data from `ready` segments to the audio sink in order and handles gapless transitions. | Status: not_done

- [ ] **Implement ordered segment playback** — When a segment becomes `ready` and it is the next in line (its index matches `playbackIndex`), transition it to `playing` and feed its audio to the sink via `sink.write()`. | Status: not_done

- [ ] **Implement gapless transitions** — Register the `onEnd` callback on the sink. When the sink signals that the current segment's audio has finished, immediately check if the next segment is `ready`. If so, transition it to `playing` and begin feeding its audio. Measure the gap time between segments for `averageGapMs` stats. | Status: not_done

- [ ] **Implement buffering detection** — If the next segment is not `ready` when the current segment ends (it is still `pending` or `generating`), emit a `buffering` event. When the segment eventually becomes `ready`, emit `bufferingEnd` and begin playback. Increment `bufferingCount` in stats. | Status: not_done

- [ ] **Implement streaming playback (partial audio)** — For streaming TTS providers, a segment can transition to `playing` before all chunks have arrived. Feed chunks to the sink as they arrive. The segment is fully done when all chunks have been written and the sink signals `onEnd`. | Status: not_done

- [ ] **Implement `ended` emission** — When the last segment in the queue finishes playing and the queue is in `draining` state (or `drain()` was called), emit the `ended` event and transition to `idle`. | Status: not_done

- [ ] **Implement sink timeout** — If the sink never calls `onEnd` after receiving audio, detect this after a configurable `sinkTimeoutMs` (default 60000ms). Treat the segment as done, emit a warning via `error` event, and advance to the next segment. | Status: not_done

---

## Phase 7: Interruption and Cancellation

- [ ] **Implement `cancel(): CancelResult`** — Execute the full cancellation sequence within the <20ms target: (1) call `sink.stop()`, (2) abort all in-flight `AbortController` instances for segments in `generating` state, (3) transition all non-done segments (`pending`, `generating`, `ready`, `playing`) to `cancelled`, (4) record interruption metadata, (5) reset queue state to `idle`. | Status: not_done

- [ ] **Implement `CancelResult` construction** — Build and return the `CancelResult` object: `playingSegment` (text, index, progress if available), `pendingTexts` (texts of all queued-but-unplayed segments), `cancelledCount` (total segments cancelled). | Status: not_done

- [ ] **Implement playback progress tracking on cancel** — If the sink supports reporting playback position, include the approximate progress (0.0 to 1.0) of the segment that was playing at the time of cancellation. If not supported, set `progress` to `null`. | Status: not_done

- [ ] **Implement top-level AbortController for enqueueStream** — Maintain a top-level `AbortController` that is aborted on `cancel()`. The `enqueueStream()` consumer uses this signal to stop pulling from the source async iterable. | Status: not_done

- [ ] **Implement audio data release on cancel** — When segments transition to `cancelled`, release their audio data references for garbage collection. | Status: not_done

---

## Phase 8: Backpressure

- [ ] **Implement `maxQueueSize` enforcement** — Track the number of active segments (excluding `done` and `cancelled`). When this count reaches `maxQueueSize` (default 20), block new additions. | Status: not_done

- [ ] **Implement blocking `enqueue()` on backpressure** — When the queue is full, `enqueue()` returns a promise that resolves only when space becomes available (a segment transitions to `done` or `cancelled` and the count drops below `maxQueueSize`). | Status: not_done

- [ ] **Implement `enqueueStream()` backpressure** — When the queue is full, pause consumption of the source async iterable. Resume pulling when space becomes available. | Status: not_done

---

## Phase 9: Audio Duration Estimation

- [ ] **Implement PCM duration estimation** — For PCM audio where the provider does not report `durationMs`, estimate it from buffer size and format metadata: `durationMs = (bufferSize / (sampleRate * channels * (bitDepth / 8))) * 1000`. | Status: not_done

- [ ] **Implement compressed format duration estimation** — For compressed formats (MP3, Opus, OGG, AAC, WAV) where duration is not reported, estimate duration based on average bitrate. Document that this is approximate. | Status: not_done

---

## Phase 10: Built-In Sink Adapters

- [ ] **Create `src/sinks/callback.ts` -- `createCallbackSink(options)`** — Implement a minimal sink that invokes `options.onAudio(audio: Uint8Array)` for each audio chunk. Invokes the `onEnd` callback when appropriate. Supports `stop()` to halt. | Status: not_done

- [ ] **Create `src/sinks/buffer.ts` -- `createBufferSink()`** — Implement a sink that collects all audio data into an in-memory `Uint8Array` buffer. Provide a `getBuffer(): Uint8Array` method to retrieve accumulated audio. Does not play audio. Useful for testing and file output. | Status: not_done

- [ ] **Create `src/sinks/stream.ts` -- `createStreamSink(writable)`** — Implement a sink that wraps a Node.js `Writable` stream. Write audio data to the stream via `writable.write()`. Call the `onEnd` callback when the current segment's audio finishes. Implement `stop()` to halt writes. | Status: not_done

---

## Phase 11: Queue Statistics

- [ ] **Implement cumulative stats tracking** — Track `totalSegments`, `completedSegments`, `cancelledSegments`, `failedSegments` as segments progress through their lifecycle. Increment counters on each relevant state transition. | Status: not_done

- [ ] **Implement `totalPlaybackDurationMs` tracking** — Sum the `durationMs` of all segments that reach `done` state. | Status: not_done

- [ ] **Implement `averageSynthesisLatencyMs` tracking** — Compute the running average of `synthesisLatencyMs` across all segments that completed synthesis (time from synthesis request to first audio chunk). | Status: not_done

- [ ] **Implement `averageGapMs` tracking** — Track the gap time between the end of one segment's playback and the start of the next. Compute the running average. Zero means gapless. | Status: not_done

- [ ] **Implement `bufferingCount` tracking** — Increment each time a `buffering` event is emitted (next segment not ready when current segment ended). | Status: not_done

- [ ] **Implement `cancellationCount` tracking** — Increment each time `cancel()` is called. | Status: not_done

---

## Phase 12: Segment Cleanup

- [ ] **Implement audio data release for completed segments** — When a segment reaches `done` state and `retainAudio` is `false` (default), release its audio buffer reference (`audioData = null`) to allow garbage collection. Retain metadata (text, timing, duration). | Status: not_done

- [ ] **Implement `retainAudio` configuration** — When `retainAudio` is `true`, keep audio data for completed segments in memory for potential replay or scrubbing. | Status: not_done

---

## Phase 13: Error Handling

- [ ] **Implement TTS synthesis error handling** — When `TTSProvider.synthesize()` throws or rejects, transition the segment to `cancelled`, emit an `error` event with `stage: 'synthesis'`, and advance to the next segment. The queue must not enter a stuck state. | Status: not_done

- [ ] **Implement TTS empty audio handling** — When a provider returns an empty audio buffer (zero bytes), transition the segment to `done` (zero-duration), emit a warning via `error` event, and advance immediately to the next segment. | Status: not_done

- [ ] **Implement sink write error handling** — When `sink.write()` throws, transition the current segment to `cancelled`, emit an `error` event with `stage: 'playback'`, and advance to the next segment. | Status: not_done

- [ ] **Implement source stream error handling** — When the async iterable passed to `enqueueStream()` throws, emit an `error` event with `stage: 'splitting'`. Segments already enqueued continue playing normally. No new segments are added. | Status: not_done

- [ ] **Implement cancel-during-error-recovery safety** — If `cancel()` is called during error recovery, the queue must transition cleanly to `idle` without emitting additional errors. | Status: not_done

---

## Phase 14: Test Utilities

- [ ] **Create `src/__tests__/helpers.ts` -- Mock provider** — Implement `createMockProvider(options)` with configurable `delayMs` (synthesis delay), `audioDurationMs` (audio duration per segment), `streaming` (boolean for chunk vs. batch mode), and `failWhen` (predicate to simulate failures). The mock must respect `AbortSignal`. | Status: not_done

- [ ] **Create mock sink in `helpers.ts`** — Implement `createMockSink(options)` with configurable `playbackSpeed` (multiplier; `Infinity` for instant). Track all `write()` calls, `stop()` calls, and `onEnd` invocations for test assertions. | Status: not_done

- [ ] **Export test utilities from `tts-queue/test`** — Configure `package.json` exports to expose `createMockProvider` and `createMockSink` from a `/test` subpath so consumers can use them in their own tests. | Status: not_done

---

## Phase 15: Unit Tests -- Sentence Splitter

- [ ] **Test basic sentence splitting** — Period, question mark, and exclamation mark followed by whitespace or end-of-string produce correct splits. E.g., `"Hello. World"` -> `["Hello.", "World"]`. | Status: not_done

- [ ] **Test abbreviation handling** — Periods after `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `Prof.`, `U.S.`, `U.K.`, `St.`, `Jr.`, `Sr.`, `vs.`, `etc.`, `i.e.`, `e.g.` are NOT treated as sentence boundaries. | Status: not_done

- [ ] **Test decimal number handling** — `"The temperature is 98.6 degrees."` is not split at `98.6`. | Status: not_done

- [ ] **Test ellipsis handling** — `"Well... I'm not sure."` is not split at `...`. | Status: not_done

- [ ] **Test URL and email handling** — `"Visit example.com for details."` is not split at `example.com`. | Status: not_done

- [ ] **Test minimum segment length merging** — Segments shorter than `minSegmentLength` (default 10) are merged with the next segment. | Status: not_done

- [ ] **Test maximum segment length splitting** — Sentences exceeding `maxSegmentLength` (default 200) are split at clause boundaries (semicolon, colon, em dash, comma). | Status: not_done

- [ ] **Test empty string input** — `""` returns an empty array. | Status: not_done

- [ ] **Test single sentence (no boundaries)** — `"Hello world"` returns `["Hello world"]`. | Status: not_done

- [ ] **Test custom splitter override** — When `splitSentences` is provided, it is used instead of the built-in splitter. | Status: not_done

- [ ] **Test user-provided abbreviations** — Additional abbreviations from `SplittingOptions.abbreviations` are respected. | Status: not_done

---

## Phase 16: Unit Tests -- Queue State Machine

- [ ] **Test idle -> playing -> idle transition** — Enqueue text, verify state goes to `playing`, wait for `ended`, verify state returns to `idle`. | Status: not_done

- [ ] **Test idle -> playing -> paused -> playing -> idle** — Enqueue, play, pause, resume, wait for ended. Verify all state transitions and `stateChange` events. | Status: not_done

- [ ] **Test playing -> idle on cancel** — Enqueue text, start playing, call `cancel()`, verify immediate transition to `idle`. | Status: not_done

- [ ] **Test segment lifecycle** — Verify a single segment progresses through: `pending -> generating -> ready -> playing -> done`. | Status: not_done

- [ ] **Test cancel transitions all active segments to cancelled** — Enqueue multiple segments, cancel mid-playback, verify all non-done segments are `cancelled`. | Status: not_done

---

## Phase 17: Unit Tests -- Pre-Buffering and Generation

- [ ] **Test correct number of segments start generating** — With `preBufferCount: 2`, enqueue 5 segments, verify that the first 3 (current + 2 ahead) start generating. | Status: not_done

- [ ] **Test generation window advances on playback** — When segment 0 finishes playing, verify that segment 3 (newly within the window) starts generating. | Status: not_done

- [ ] **Test pre-buffered segments cancelled on cancel()** — Verify that all in-flight `AbortController` instances are aborted when `cancel()` is called. | Status: not_done

- [ ] **Test synthesis timeout** — Configure a short `synthesisTimeoutMs`, use a mock provider with a longer delay, verify the segment is cancelled and an `error` event is emitted. | Status: not_done

---

## Phase 18: Integration Tests

- [ ] **Test gapless playback** — Enqueue three sentences with a mock provider. Verify that the sink receives audio for segment 2 within 1ms of segment 1 ending (or near-zero gap). | Status: not_done

- [ ] **Test buffering event** — Enqueue two sentences with a mock provider that takes longer than the first segment's playback duration. Verify that a `buffering` event is emitted between segments, followed by `bufferingEnd` when the next segment is ready. | Status: not_done

- [ ] **Test interruption** — Enqueue five sentences. After segment 1 starts playing, call `cancel()`. Verify: `sink.stop()` was called, all generating segments' `AbortController`s were aborted, `CancelResult` contains correct metadata (playing segment, pending texts, cancelled count). | Status: not_done

- [ ] **Test streaming input** — Create an async iterable that yields tokens with delays. Pass to `enqueueStream()`. Verify that segments are created as sentences complete and playback begins after the first segment is ready. | Status: not_done

- [ ] **Test stream-tokens integration** — Create an async iterable that yields `{ content: string }` objects. Pass to `enqueueStream()`. Verify segments are created from the `.content` values. | Status: not_done

- [ ] **Test error recovery** — Configure mock provider to throw on segment 2 of 5. Verify that segment 2 is skipped, segments 1, 3, 4, 5 play successfully, and an `error` event is emitted for segment 2. | Status: not_done

- [ ] **Test backpressure** — Set `maxQueueSize: 3`. Enqueue segments rapidly. Verify that `enqueue()` blocks when the queue is full and resumes when space becomes available. | Status: not_done

- [ ] **Test `enqueueStream()` backpressure** — Set a low `maxQueueSize`. Stream tokens that produce many segments. Verify the stream consumption pauses when the queue is full. | Status: not_done

---

## Phase 19: Playback and Sink Tests

- [ ] **Test `createCallbackSink`** — Verify that `onAudio` callback receives all audio chunks, `stop()` halts delivery, and `onEnd` fires at the right time. | Status: not_done

- [ ] **Test `createBufferSink`** — Verify that `getBuffer()` returns concatenated audio from all segments. Verify `stop()` clears the buffer. | Status: not_done

- [ ] **Test `createStreamSink`** — Verify that audio is written to the provided `Writable` stream. Verify `stop()` halts writes. | Status: not_done

- [ ] **Test sink `pause()` / `resume()` forwarding** — When the queue is paused, verify `sink.pause()` is called (if available). On resume, verify `sink.resume()` is called. | Status: not_done

- [ ] **Test sink without `pause()` / `resume()`** — Verify the queue handles sinks that do not implement optional `pause()` / `resume()` methods gracefully (stops writing but does not throw). | Status: not_done

---

## Phase 20: Cancel and Error Tests

- [ ] **Test cancel returns correct `CancelResult`** — Verify `playingSegment` (text, index, progress), `pendingTexts`, and `cancelledCount` are accurate. | Status: not_done

- [ ] **Test cancel with nothing playing** — Call `cancel()` when the queue is idle. Verify `CancelResult` has `playingSegment: null`, `pendingTexts: []`, `cancelledCount: 0`. | Status: not_done

- [ ] **Test cancel during buffering** — When the queue is in `buffering` state (waiting for next segment), call `cancel()`. Verify clean transition to `idle`. | Status: not_done

- [ ] **Test empty audio from provider** — Provider returns zero-byte buffer. Verify segment is treated as done (zero-duration), warning emitted, queue advances. | Status: not_done

- [ ] **Test sink never calls `onEnd`** — Verify that after `sinkTimeoutMs`, the queue treats the segment as done and advances with a warning. | Status: not_done

- [ ] **Test source stream error** — The async iterable throws mid-stream. Verify `error` event with `stage: 'splitting'`, already-enqueued segments continue playing. | Status: not_done

---

## Phase 21: Performance Tests

- [ ] **Test interruption latency** — Measure time from `cancel()` call to `sink.stop()` invocation. Verify it is under 20ms. | Status: not_done

- [ ] **Test queue management overhead** — Measure time for `enqueue()`, state transitions, and event emission. Verify operations complete within 1ms. | Status: not_done

- [ ] **Test latency stats accuracy** — Enqueue a sentence with a mock provider that has a known delay. Verify `getStats().averageSynthesisLatencyMs` matches the expected delay within tolerance. | Status: not_done

- [ ] **Test memory behavior with `retainAudio: false`** — Verify that completed segments release their audio buffers (audio data references are nulled out). | Status: not_done

- [ ] **Test backpressure effectiveness** — Feed text faster than the mock provider can synthesize. Verify the queue size never exceeds `maxQueueSize`. | Status: not_done

---

## Phase 22: Configuration Validation

- [ ] **Validate required options** — `createQueue()` must throw a clear error if `provider` or `sink` is missing or undefined. | Status: not_done

- [ ] **Validate `preBufferCount` range** — Accept values 0 to 10. Throw on values outside this range. | Status: not_done

- [ ] **Validate `maxQueueSize` range** — Accept values 1 to 100. Throw on values outside this range. | Status: not_done

- [ ] **Validate `synthesisTimeoutMs`** — Must be a positive number. Throw on zero or negative values. | Status: not_done

- [ ] **Validate `minSegmentLength` and `maxSegmentLength`** — `minSegmentLength` must be >= 1. `maxSegmentLength` must be > `minSegmentLength`. Throw on invalid values. | Status: not_done

- [ ] **Apply defaults for all optional options** — Verify defaults match the spec: `preBufferCount: 2`, `maxQueueSize: 20`, `autoplay: true`, `retainAudio: false`, `synthesisTimeoutMs: 30000`, `minSegmentLength: 10`, `maxSegmentLength: 200`. | Status: not_done

---

## Phase 23: `createQueue` Factory Function

- [ ] **Implement `createQueue(options: QueueOptions): TTSQueue`** — Validate options, apply defaults, instantiate the `TTSQueue` class, call `provider.warmup()` if available, check format compatibility between provider and sink, and return the queue instance. | Status: not_done

---

## Phase 24: Documentation

- [ ] **Create README.md** — Write a comprehensive README with: package description, installation, quick start example, API reference (createQueue, TTSQueue methods, events), configuration options table, provider adapter examples (OpenAI, ElevenLabs), sink adapter examples, integration with `stream-tokens` and `voice-turn`, error handling guidance, and test utility usage. | Status: not_done

---

## Phase 25: Package Configuration and Publishing Prep

- [ ] **Update `package.json` version** — Bump version per semver (this is the initial implementation, so `0.1.0` may be appropriate or bump to `1.0.0` depending on readiness). | Status: not_done

- [ ] **Configure `package.json` exports** — Ensure main entry point (`dist/index.js`), types (`dist/index.d.ts`), and test utilities subpath (`tts-queue/test`) are properly configured in the `exports` field. | Status: not_done

- [ ] **Verify `files` field** — Ensure `dist` directory is included in the published package. Ensure `src`, tests, and spec files are excluded. | Status: not_done

- [ ] **Verify `engines` field** — Confirm `node: ">=18"` since the package uses `AbortController`, `EventEmitter`, and modern JS APIs. | Status: not_done

- [ ] **Verify zero runtime dependencies** — Confirm `dependencies` field in `package.json` is empty or absent. The package must have zero runtime dependencies per spec. | Status: not_done

- [ ] **Run full build and test** — Execute `npm run build`, `npm run test`, and `npm run lint`. All must pass with zero errors. | Status: not_done
