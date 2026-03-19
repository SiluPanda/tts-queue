# tts-queue -- Specification

## 1. Overview

`tts-queue` is a TTS audio streaming manager that accepts text -- either as complete strings or as a streaming token sequence from an LLM -- splits it into sentence-sized segments, sends each segment to a pluggable TTS provider for audio synthesis, buffers the resulting audio, and plays the segments back-to-back through a pluggable audio sink with gapless playback, pre-buffering, pause/resume, and fast interruption handling. It is the orchestration layer between "text that needs to be spoken" and "audio that the user hears," handling every concern that sits between those two endpoints: sentence boundary detection, parallel TTS generation, ordered playback queuing, backpressure, cancellation of in-flight API calls, and cross-provider normalization. The result is a single `TTSQueue` instance that replaces the 200-400 lines of async queue management, timer coordination, and provider-specific plumbing that every voice AI application otherwise implements from scratch.

The gap this package fills is specific and well-defined. Individual TTS SDKs (OpenAI TTS, ElevenLabs, Google Cloud Text-to-Speech, Azure Cognitive Services Speech, Amazon Polly) provide a simple API: text in, audio out. But in a streaming voice AI application -- where an LLM generates text token by token, the text must be spoken aloud in real time, and the user can interrupt at any moment -- a raw TTS SDK is insufficient. The application must solve sentence-boundary splitting (TTS quality degrades with sub-sentence fragments and degrades differently with multi-paragraph input), parallel generation (while sentence 1 plays, sentence 2 should already be synthesizing), ordered playback (sentences must play in sequence with no gaps or overlaps), pre-buffering (audio for the next sentence must be ready before the current one finishes), interruption (when the user speaks, all playback and in-flight TTS calls must cancel within 100ms), and provider normalization (switching from OpenAI TTS to ElevenLabs should not require rewriting queue logic). Every team building a voice assistant, read-aloud feature, or accessibility tool solves these problems independently, producing ad-hoc implementations that are inconsistently tested, tightly coupled to a single TTS provider, and missing edge cases around cancellation, backpressure, and error recovery.

No existing npm package provides TTS queue management as a standalone concern. `say.js` provides a Node.js binding to the operating system's built-in TTS engine (macOS `say`, Windows SAPI, Linux eSpeak) but operates synchronously on complete strings, provides no streaming, no queuing, and no interruption handling. `google-tts-api` generates Google Translate TTS URLs but does not manage playback or queuing. The Vercel AI SDK provides `streamText()` for LLM token streaming but does not address TTS at all. Python frameworks for voice AI (Pipecat, Vocode, LiveKit Agents) include TTS queue management internally, but they are Python-only, framework-level (not library-level), and tightly coupled to their own pipeline abstractions. In the JavaScript/TypeScript ecosystem, there is no standalone, provider-agnostic library that manages the TTS queue as an independent concern. `tts-queue` fills this gap: a focused library that accepts any TTS provider through a simple interface and handles all queuing, buffering, playback, and cancellation logic.

`tts-queue` provides a TypeScript API only (no CLI). The primary entry point is `createQueue(options)`, which returns a `TTSQueue` instance. The queue accepts text input via `enqueue(text)` for complete strings or `enqueueStream(stream)` for streaming token sources (such as an LLM response piped through `stream-tokens`). It splits text into sentence-sized segments, sends each to the configured TTS provider, buffers the resulting audio, and plays segments through the configured audio sink in order. The queue emits typed events for playback milestones (`playing`, `ended`, `buffering`, `segmentStart`, `segmentEnd`), errors, and state changes. Interruption is handled via `cancel()`, which stops current playback, cancels all in-flight TTS API calls via `AbortController`, flushes the queue, and returns the queue to an idle state -- all within a 100ms target. The queue integrates with `voice-turn` as the TTS playback layer and with `stream-tokens` as the sentence aggregation layer, but neither dependency is required: `tts-queue` works standalone with any text source and any TTS provider.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createQueue(options)` function that accepts a `TTSProvider` and an `AudioSink` and returns a `TTSQueue` instance that manages the full lifecycle of text-to-audio playback: splitting, synthesis, buffering, and ordered playback.
- Accept text input in two modes: `enqueue(text)` for complete strings (pre-split or auto-split into sentences) and `enqueueStream(stream)` for `AsyncIterable<string>` token streams that are aggregated into sentences as they arrive.
- Implement sentence-boundary splitting for auto-segmentation of input text, with configurable minimum and maximum segment lengths, smart clause-boundary fallback for long sentences, and integration with `stream-tokens` when available.
- Manage a FIFO queue of audio segments with per-segment lifecycle states (`pending`, `generating`, `ready`, `playing`, `done`, `cancelled`) and ordered playback.
- Implement pre-buffering: while the current segment plays, generate audio for the next N segments (configurable lookahead, default 2) so that audio is ready when the current segment ends.
- Implement gapless playback: start the next segment immediately when the current segment ends. If the next segment is not ready, emit a `buffering` event and wait.
- Implement fast interruption via `cancel()`: stop current playback, cancel all in-flight TTS API calls via `AbortController`, discard queued audio, and return to idle state within 100ms.
- Provide a `TTSProvider` interface that normalizes across TTS providers: streaming providers (return audio chunks as they generate), batch providers (return complete audio buffers), and providers with different audio formats.
- Provide an `AudioSink` interface that abstracts audio output: Node.js speaker, Web Audio API, file output, raw stream passthrough, or custom implementations.
- Emit typed events for all queue milestones: `playing` (segment started), `segmentStart` (segment N started), `segmentEnd` (segment N finished), `ended` (all segments done), `buffering` (waiting for next segment), `error` (provider or playback error), `stateChange` (queue state transition), `drain` (queue emptied).
- Provide `pause()` and `resume()` for suspending and resuming playback without losing queue position.
- Provide `getState()` and `getStats()` for introspecting queue status, segment progress, playback position, and cumulative statistics (segments played, total audio duration, average latency).
- Track partial playback on interruption: report which segment was playing and how much of it was played when `cancel()` is called.
- Handle backpressure: if the text source produces segments faster than TTS can synthesize them, limit the queue to a configurable maximum size and apply backpressure to the source.
- Handle errors at every stage without crashing the queue: TTS synthesis failures skip the failed segment and continue, playback errors emit an event and transition to the next segment, provider timeouts are detected and handled.
- Target Node.js 18+ and modern JavaScript runtimes. No browser-specific APIs in the core library (browser audio sinks are provided as separate adapters).

### Non-Goals

- **Not a TTS engine.** This package does not synthesize speech. It accepts a `TTSProvider` interface that wraps any TTS SDK. The provider handles the actual text-to-audio conversion. Use the OpenAI TTS SDK, ElevenLabs SDK, Google Cloud Text-to-Speech client, Azure Cognitive Services Speech SDK, Amazon Polly SDK, or any other TTS service to implement the provider.
- **Not an audio player.** This package does not directly produce sound output. It accepts an `AudioSink` interface that abstracts audio output. The application provides a sink implementation that plays audio through speakers, writes to files, or pipes to a WebSocket. Built-in sink adapters are provided as starting points, but the core queue has no dependency on any audio library.
- **Not an NLP library.** Sentence boundary detection uses heuristic rules (punctuation patterns, abbreviation lists, minimum/maximum length constraints), not machine learning models. For higher-accuracy sentence detection, pipe input through `stream-tokens` with its sentence aggregation mode, which handles abbreviations, decimal numbers, URLs, and other false positives more thoroughly.
- **Not an LLM client.** This package does not call LLM APIs or stream LLM tokens. It accepts streaming text input via `enqueueStream()`, which can be connected to any LLM SDK's streaming output. The `voice-turn` package handles the LLM-to-TTS pipeline; `tts-queue` handles the TTS-to-playback pipeline.
- **Not a voice activity detector.** This package does not detect when the user is speaking. Interruption is triggered by the application calling `cancel()`. For VAD-based interruption detection, use `voice-turn` or `audio-chunker`, which call `cancel()` on the TTS queue when barge-in is detected.
- **Not an audio codec or transcoder.** This package does not convert between audio formats (PCM to MP3, resampling, etc.). If the TTS provider's output format does not match the audio sink's expected format, the application must provide a format-converting sink wrapper or a provider adapter that outputs the correct format.
- **Not a conversation manager.** This package manages audio playback for a sequence of text segments. It does not manage conversation state, turn-taking, endpointing, or any conversational logic. Use `voice-turn` for conversation orchestration.
- **Not a media server.** This package does not manage WebRTC, RTP, or WebSocket audio transport. For real-time media infrastructure, use LiveKit, Twilio, or Daily. `tts-queue` produces audio data that the application can route through any transport.

---

## 3. Target Users and Use Cases

### Voice Assistant Builders

Developers building conversational voice assistants (smart speakers, mobile voice companions, desktop AI assistants, phone agents) where an LLM generates text responses that must be spoken aloud in real time. The LLM streams tokens, the assistant must begin speaking the first sentence while later sentences are still generating, and the user can interrupt at any moment. A typical integration: `const queue = createQueue({ provider: openaiTTS, sink: speakerSink }); queue.enqueueStream(llmTokenStream);`. The queue handles sentence splitting, parallel TTS generation, gapless playback, and cancellation on barge-in. Without `tts-queue`, the developer writes 200-400 lines of async queue management, abort controller coordination, and segment state tracking.

### Read-Aloud Feature Developers

Developers building read-aloud functionality for articles, documents, emails, or chat messages. The user clicks a "read aloud" button, and the application speaks the content. The content may be a single paragraph or a 10-page document. `tts-queue` splits the content into sentences, synthesizes them with pre-buffering so that playback is continuous, and provides pause/resume controls. The developer does not need to manually split text, manage a TTS call queue, or implement gapless transitions between segments.

### Accessibility Tool Builders

Teams building screen readers, voice-enabled navigation, or assistive interfaces for users with visual impairments or motor disabilities. Accessibility tools require responsive, interruptible speech output: the user navigates to a new UI element, the current speech must stop immediately, and the new element's description must begin speaking within 100ms. `tts-queue` provides the `cancel()` and `enqueue()` primitives that make this pattern trivial.

### Interactive Tutoring Systems

Developers building AI tutoring applications where an AI tutor explains concepts verbally. The tutor's explanations can be long (multiple sentences, sometimes multiple paragraphs), and the student may interrupt with a question. The queue handles the long-form playback with pre-buffering to avoid gaps between sentences, and fast cancellation when the student speaks.

### Podcast and Narration Generators

Developers building tools that generate podcast episodes, audiobook chapters, or narrated content from text. The text is pre-written (not streaming), but the application still benefits from sentence-level TTS to avoid sending entire paragraphs to a TTS API (which degrades prosody) and from queued playback that handles the sequential nature of narration.

### Multi-Modal Chat Applications

Developers building chat applications that optionally read messages aloud. When the user enables audio mode, incoming messages are spoken. Multiple messages may arrive in quick succession, and the queue ensures they are spoken in order without overlapping. The user can mute (cancel) at any time.

### Prototype and Hackathon Builders

Individual developers rapidly prototyping voice AI applications who need a drop-in TTS playback solution. They provide a TTS provider adapter (10-20 lines wrapping the OpenAI or ElevenLabs SDK) and an audio sink (or use a built-in one), and the queue handles everything else. Focus stays on the application logic rather than async queue engineering.

---

## 4. Core Concepts

### Segment

A segment is the fundamental unit of work in the TTS queue. Each segment represents a single piece of text (typically one sentence) that is sent to the TTS provider for synthesis and played back as a discrete audio unit. A segment progresses through a lifecycle of states:

- **`pending`**: The segment has been added to the queue but TTS synthesis has not started. It is waiting for its turn in the pre-buffer window.
- **`generating`**: The segment's text has been sent to the TTS provider and audio data is being produced. For streaming providers, audio chunks are arriving incrementally. For batch providers, the full audio buffer is being generated.
- **`ready`**: TTS synthesis is complete and the segment's audio data is fully buffered, waiting for playback.
- **`playing`**: The segment's audio is currently being played through the audio sink.
- **`done`**: The segment has been fully played. Its audio data may be released for garbage collection.
- **`cancelled`**: The segment was cancelled before completing playback. This occurs when `cancel()` is called while the segment is in `pending`, `generating`, `ready`, or `playing` state.

Each segment carries metadata: its index in the queue (0-based), the source text, the audio data (once generated), the audio duration (once known), and timing information (when synthesis started, when the first audio chunk arrived, when synthesis completed, when playback started, when playback ended).

### TTS Queue

The TTS queue is a FIFO (first-in, first-out) data structure that manages the ordered sequence of segments from creation through playback to completion. The queue coordinates three concurrent activities: (1) ingesting text and creating new segments, (2) sending segments to the TTS provider for audio synthesis (pre-buffering), and (3) playing completed segments through the audio sink in order. The queue maintains a head pointer (the segment currently playing or the next segment to play), a generation pointer (the next segment to send to TTS), and a tail pointer (where new segments are added). The distance between the generation pointer and the head pointer is the pre-buffer depth.

### Pre-Buffering

Pre-buffering is the strategy of generating audio for upcoming segments before they are needed for playback. While segment N is playing, the queue sends segments N+1 and N+2 (configurable) to the TTS provider for synthesis. When segment N finishes, segment N+1's audio is already fully or partially buffered, enabling gapless transition. Without pre-buffering, each segment transition would incur the full TTS synthesis latency (100-500ms depending on provider), producing audible gaps between sentences. Pre-buffering trades memory (storing buffered audio) and provider concurrency (multiple in-flight TTS requests) for seamless playback.

The pre-buffer depth (default 2) is the number of segments ahead of the current playback position that the queue keeps in `generating` or `ready` state. If the TTS provider is slow and segments are not ready in time despite pre-buffering, the queue emits a `buffering` event and waits. If the TTS provider is fast and segments are ready well ahead of time, the queue holds them in `ready` state without requesting more until the generation pointer falls within the pre-buffer window again.

### Gapless Playback

Gapless playback means that when one segment finishes playing, the next segment begins immediately with no perceptible silence between them. This is critical for natural-sounding speech: a 200ms gap between sentences sounds like a system stutter, not a natural pause. (Natural inter-sentence pauses are already encoded in the TTS audio itself -- the TTS engine adds appropriate pausing based on punctuation.) Gapless playback requires that the next segment's audio is available (`ready` or `generating` with enough buffered chunks) when the current segment ends. The audio sink signals playback completion via a callback, and the queue immediately begins feeding the next segment's audio.

### Interruption

Interruption is the act of immediately stopping all TTS activity: halting current playback, cancelling in-flight TTS API calls, and discarding all queued segments. In voice AI, interruption occurs when the user speaks (barge-in) and the system must stop talking to listen. The interruption must be fast -- the target is under 100ms from the `cancel()` call to actual silence -- because any lingering AI speech during a barge-in feels broken and confusing.

Interruption uses `AbortController` to cancel in-flight TTS API requests. Each TTS synthesis call receives an `AbortSignal`; when `cancel()` is called, all active `AbortController` instances are aborted, which causes the TTS provider to stop generating and release resources. The audio sink's `stop()` method is called to halt playback immediately. The queue transitions all non-done segments to `cancelled` state and resets to idle.

### Audio Sink

An audio sink is the output destination for synthesized audio. The queue does not play audio directly; it pushes audio data to a sink, which handles the actual output. This abstraction decouples the queue from any specific audio library, runtime, or output mechanism. A sink for a Node.js server might pipe audio to a `speaker` library that drives the system's sound output. A sink for a WebSocket-based voice assistant might stream audio chunks to the client. A sink for testing might collect audio data into a buffer for assertion. The sink interface is minimal: `write(audio)` to push audio data, `stop()` to halt playback, and a callback when the current audio has finished playing.

### Sentence Splitting

Sentence splitting is the process of dividing input text into segments suitable for TTS synthesis. TTS engines produce the best prosody (natural rhythm, intonation, and pacing) when given complete sentences. Single words produce choppy, robotic output. Multi-paragraph text produces overly long audio with poor pacing and high latency (the TTS API must process the entire text before returning any audio). Sentences are the optimal unit: long enough for natural prosody, short enough for manageable latency.

The queue provides built-in sentence splitting for `enqueue(text)` calls and supports integration with `stream-tokens` for streaming sentence aggregation via `enqueueStream()`. The built-in splitter handles common cases (period/question mark/exclamation mark followed by whitespace), abbreviations (Dr., Mr., Mrs., U.S., etc.), decimal numbers (3.14), and ellipsis (...). For long sentences that exceed a configurable maximum length, the splitter falls back to clause-boundary splitting at commas, semicolons, colons, and em dashes.

---

## 5. Queue Architecture

### Pipeline Overview

The TTS queue operates as a four-stage pipeline:

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     TTSQueue                            │
                    │                                                         │
  Text Input ──────>│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐  │
  (string or        │  │ Sentence │   │     TTS      │   │    Playback    │  │──> Audio Output
   AsyncIterable)   │  │ Splitter │──>│  Generation  │──>│     Queue      │  │   (AudioSink)
                    │  │          │   │  (Provider)  │   │                │  │
                    │  └──────────┘   └──────────────┘   └────────────────┘  │
                    │                                                         │
                    │  Events: playing, segmentStart, segmentEnd, ended,      │
                    │          buffering, error, stateChange, drain           │
                    └─────────────────────────────────────────────────────────┘
```

**Stage 1: Text Ingestion and Sentence Splitting.** Text enters the queue via `enqueue(text)` or `enqueueStream(stream)`. For `enqueue(text)`, the text is synchronously split into sentences using the built-in splitter or a user-provided `splitSentences` function. Each sentence becomes a segment in `pending` state. For `enqueueStream(stream)`, tokens are accumulated and sentences are emitted as they complete (either via the built-in streaming splitter or via an external `stream-tokens` sentence aggregator). Each completed sentence becomes a segment in `pending` state.

**Stage 2: TTS Generation (Pre-Buffering).** The queue maintains a generation loop that watches for `pending` segments within the pre-buffer window. When a `pending` segment falls within the window (its index is within `preBufferCount` of the current playback position), it transitions to `generating` and is sent to the TTS provider. The provider returns audio data (either as a complete buffer or as a stream of chunks). When all audio data is received, the segment transitions to `ready`. Multiple segments may be in `generating` state simultaneously if the pre-buffer window spans more than one segment.

**Stage 3: Playback Queue.** The playback loop watches for the next segment to play. When the queue is in `playing` state and the current segment finishes (the sink signals completion), the queue checks whether the next segment is `ready`. If yes, it transitions the segment to `playing` and feeds its audio to the sink. If no (the segment is still `generating` or `pending`), the queue emits a `buffering` event and waits. When the last segment in the queue finishes playing, the queue emits an `ended` event and transitions to `idle`.

**Stage 4: Audio Output.** The audio sink receives audio data from the playing segment and outputs it. The sink is responsible for actual audio rendering: driving a speaker, writing to a file, streaming over a network, or accumulating in a test buffer. The sink signals when it has finished playing the current audio, which triggers the queue to advance to the next segment.

### Segment Lifecycle

```
                enqueue() / enqueueStream()
                         │
                         ▼
                   ┌──────────┐
                   │ pending  │
                   └────┬─────┘
                        │ within pre-buffer window
                        ▼
                   ┌──────────────┐
           ┌──────│ generating   │
           │      └──────┬───────┘
           │             │ TTS synthesis complete
           │             ▼
           │      ┌──────────┐
           │      │  ready   │
           │      └────┬─────┘
           │           │ previous segment ended
           │           ▼
           │      ┌──────────┐
           │      │ playing  │
           │      └────┬─────┘
           │           │ playback complete
           │           ▼
           │      ┌──────────┐
           │      │   done   │
           │      └──────────┘
           │
           │  cancel() called at any point
           │           │
           └──────────>▼
                   ┌──────────────┐
                   │  cancelled   │
                   └──────────────┘
```

### Queue States

The queue itself (distinct from individual segments) has four states:

- **`idle`**: No segments are queued or playing. The queue is waiting for input.
- **`playing`**: At least one segment is playing, and the queue is actively advancing through segments.
- **`paused`**: Playback is suspended via `pause()`. The current segment's playback position is preserved. Generation of upcoming segments continues (pre-buffering does not pause).
- **`draining`**: No new text is expected (the input stream has ended or `drain()` was called), and the queue is playing through remaining segments. After the last segment finishes, the queue transitions to `idle` and emits `ended`.

```
                ┌─────────────────────────────────┐
                │                                 │
                ▼                                 │
          ┌──────────┐                            │
          │   idle   │◄─────── cancel() ──────────┤
          └────┬─────┘                            │
               │ enqueue() or                     │
               │ enqueueStream()                  │
               ▼                                  │
          ┌──────────┐      pause()         ┌─────┴────┐
          │ playing  │─────────────────────>│  paused  │
          └────┬─────┘<────────────────────┘──────────┘
               │              resume()
               │ input stream ends
               ▼
          ┌──────────────┐
          │  draining    │
          └──────┬───────┘
                 │ last segment done
                 ▼
          ┌──────────┐
          │   idle   │
          └──────────┘
```

### Concurrency Model

The queue manages three concurrent activities:

1. **Ingestion**: Text arrives asynchronously (via `enqueue()` calls or an async iterable consumed by `enqueueStream()`). Each call may produce one or more segments.

2. **Generation**: The generation loop runs independently, watching for `pending` segments that fall within the pre-buffer window. When it finds one, it starts a TTS synthesis call. Multiple synthesis calls may be in-flight simultaneously (up to `preBufferCount` concurrent calls).

3. **Playback**: The playback loop runs independently, advancing through segments in order. It waits for the next segment to become `ready`, then feeds its audio to the sink.

These three activities are coordinated through the segment state machine. Ingestion creates `pending` segments. Generation transitions them to `generating` then `ready`. Playback transitions them to `playing` then `done`. All transitions are atomic (no intermediate states). The `cancel()` method interrupts all three activities simultaneously.

---

## 6. Sentence Splitting

### The Splitting Problem

TTS engines produce the best results when given complete sentences. The reasons are prosodic: a TTS engine modulates pitch, timing, and emphasis based on the full syntactic structure of the input. A question rises in pitch at the end. A list item has level intonation. An exclamation has emphasis. These prosodic patterns require the engine to see the complete sentence before it begins synthesizing (or at least a substantial portion of it in streaming mode). Sub-sentence fragments -- individual words or half-sentences -- produce flat, robotic prosody because the engine has no syntactic context.

Conversely, sending very long text (multiple sentences, entire paragraphs) to a TTS engine creates different problems. Latency increases because the engine must process more text before returning any audio. Prosody can degrade because the engine attempts to maintain coherent intonation across an unnaturally long utterance. Interruption becomes slow because more audio is in-flight. Sentences are the sweet spot.

### Built-In Sentence Splitter

The queue includes a built-in sentence boundary detector for `enqueue(text)` calls. It uses heuristic rules that cover common English text:

**Primary boundary markers:**
- Period followed by whitespace or end-of-string: `"Hello. World"` splits into `["Hello.", "World"]`
- Question mark followed by whitespace or end-of-string: `"How are you? Fine."` splits into `["How are you?", "Fine."]`
- Exclamation mark followed by whitespace or end-of-string: `"Wow! That's great."` splits into `["Wow!", "That's great."]`

**False positive handling (boundaries that are NOT sentence endings):**
- Abbreviations: `"Dr. Smith"`, `"Mr. Jones"`, `"Mrs. Brown"`, `"Ms. Lee"`, `"Prof. Davis"`, `"U.S. Army"`, `"U.K."`, `"St. Louis"`, `"Jr."`, `"Sr."`, `"vs."`, `"etc."`, `"i.e."`, `"e.g."` -- the period after these abbreviations is not a sentence boundary. The splitter maintains a configurable abbreviation list.
- Decimal numbers: `"The temperature is 98.6 degrees"` -- the period in `98.6` is not a sentence boundary.
- Ellipsis: `"Well... I'm not sure"` -- the periods in `...` are not sentence boundaries.
- URLs and email addresses: `"Visit example.com for details"` -- the period in `example.com` is not a sentence boundary.

**Long sentence fallback:**
When a sentence exceeds `maxSegmentLength` (default 200 characters), the splitter falls back to clause-boundary splitting. It searches for the following delimiters within the sentence, in order of preference:
1. Semicolon followed by whitespace: `"; "`
2. Colon followed by whitespace (not within a time expression like "10:30"): `": "`
3. Em dash: `" -- "` or `"—"`
4. Comma followed by whitespace, but only at a position that produces two segments of at least `minSegmentLength` characters each

**Short segment merging:**
When a segment is shorter than `minSegmentLength` (default 10 characters), it is merged with the next segment. This prevents single-word or very short segments (like "Yes." or "OK.") from being sent to TTS independently, which would produce choppy playback. If the short segment is the last segment (no next segment to merge with), it is sent as-is.

### Streaming Sentence Aggregation

For `enqueueStream(stream)`, where text arrives token by token from an LLM, the queue needs a streaming sentence boundary detector -- one that accumulates tokens in a buffer and emits complete sentences as they form.

**With `stream-tokens` integration:** If the input to `enqueueStream()` is already an `AsyncIterable<AggregatedChunk>` from `stream-tokens` in sentence mode, the queue uses the pre-aggregated sentences directly. Each `AggregatedChunk` with `unit: 'sentence'` becomes a segment. This is the recommended approach because `stream-tokens` has a more sophisticated sentence boundary detector that handles abbreviations, lookahead, and edge cases better than the queue's built-in splitter.

**Built-in streaming splitter (fallback):** When `enqueueStream()` receives an `AsyncIterable<string>` of raw tokens (not pre-aggregated), the queue applies its own streaming sentence boundary detection. The algorithm maintains an internal buffer and works as follows:

1. Each incoming token is appended to the buffer.
2. After each append, the buffer is scanned for sentence boundary markers (`.`, `?`, `!` followed by whitespace or followed by the next token starting with a capital letter or whitespace).
3. When a boundary is found, the content up to and including the boundary marker is emitted as a complete sentence and removed from the buffer.
4. When the source stream ends, any remaining buffer content is emitted as a final sentence.
5. The same long-sentence fallback and short-segment merging rules apply.

The streaming splitter uses a one-token lookahead strategy for ambiguous boundaries. When a period is encountered, the splitter does not immediately emit -- it waits for the next token to confirm whether the period ends a sentence (next token starts with whitespace + capital letter) or is part of an abbreviation (next token continues the word). This introduces at most one token of latency, which is negligible in practice (typically 1-5ms).

### Configuration

```typescript
createQueue({
  // ...
  splitting: {
    /** Minimum segment length in characters. Shorter segments are merged
     *  with the next segment. Default: 10. */
    minSegmentLength: 10,

    /** Maximum segment length in characters. Longer segments are split
     *  at clause boundaries. Default: 200. */
    maxSegmentLength: 200,

    /** Additional abbreviations to add to the built-in list.
     *  Periods after these strings are not treated as sentence boundaries. */
    abbreviations: ['Corp.', 'Inc.', 'Ltd.'],

    /** Custom sentence splitting function. Overrides the built-in splitter.
     *  Receives a string and returns an array of segments. */
    splitSentences: (text: string) => string[],
  },
});
```

---

## 7. TTS Provider Interface

### Interface Definition

The `TTSProvider` interface is the contract between the queue and any TTS engine. A provider is a thin adapter (typically 10-30 lines of code) that wraps a TTS SDK and normalizes its API to match the interface.

```typescript
/**
 * TTS provider interface. Wraps any TTS SDK to provide a uniform
 * synthesis API for the queue.
 */
interface TTSProvider {
  /**
   * Synthesize speech audio from text.
   *
   * The provider may return audio in one of two modes:
   * - Batch: returns a complete audio buffer (Promise<AudioData>)
   * - Streaming: returns an async iterable of audio chunks
   *   (AsyncIterable<AudioChunk>)
   *
   * The provider MUST respect the AbortSignal: when the signal is
   * aborted, the provider should stop synthesis, release resources,
   * and either reject the promise or end the async iterable.
   *
   * @param text - The text to synthesize.
   * @param signal - AbortSignal for cancellation.
   * @returns Audio data (batch mode) or an async iterable of audio chunks
   *          (streaming mode).
   */
  synthesize(
    text: string,
    signal: AbortSignal,
  ): Promise<AudioData> | AsyncIterable<AudioChunk>;

  /**
   * Optional: warm up the provider connection.
   * Called once during queue creation to reduce latency on the first
   * synthesis call. Providers can use this to establish HTTP/2
   * connections, authenticate, or pre-load models.
   */
  warmup?(): Promise<void> | void;

  /**
   * Optional: the audio format that this provider outputs.
   * Used by the queue for duration estimation and sink compatibility
   * checking. If not provided, the queue assumes PCM 16-bit 24kHz mono.
   */
  readonly outputFormat?: AudioFormat;
}
```

### Audio Data Types

```typescript
/** Complete audio buffer returned by batch TTS providers. */
interface AudioData {
  /** Raw audio bytes. */
  buffer: Uint8Array;

  /** Duration of the audio in milliseconds. Providers should include
   *  this if known; the queue estimates it from buffer size if missing. */
  durationMs?: number;

  /** Audio format metadata. */
  format?: AudioFormat;
}

/** Incremental audio chunk returned by streaming TTS providers. */
interface AudioChunk {
  /** Raw audio bytes for this chunk. */
  buffer: Uint8Array;

  /** Whether this is the final chunk. */
  isFinal?: boolean;
}

/** Audio format descriptor. */
interface AudioFormat {
  /** Audio codec. Default: 'pcm'. */
  codec: 'pcm' | 'mp3' | 'opus' | 'ogg' | 'wav' | 'aac';

  /** Sample rate in Hz. Default: 24000. */
  sampleRate: number;

  /** Number of audio channels. Default: 1 (mono). */
  channels: number;

  /** Bit depth for PCM audio. Default: 16. */
  bitDepth?: number;
}
```

### Batch vs. Streaming Providers

The queue detects the provider mode by checking the return type of `synthesize()`:

- **Batch mode** (returns `Promise<AudioData>`): The queue awaits the promise. When it resolves, the segment transitions directly from `generating` to `ready` with the complete audio buffer. This mode is simpler but adds latency because no audio is available until synthesis completes. Providers like Google Cloud TTS (standard voices) and Amazon Polly (non-streaming mode) operate in batch mode.

- **Streaming mode** (returns `AsyncIterable<AudioChunk>`): The queue consumes chunks as they arrive, appending them to the segment's audio buffer. The segment can transition to `playing` before all chunks have arrived (the queue feeds chunks to the sink as they arrive, and the sink plays them continuously). This mode provides lower perceived latency because playback can begin as soon as the first chunk arrives. Providers like OpenAI TTS, ElevenLabs, and Azure Cognitive Services Speech support streaming mode.

The queue distinguishes the two modes by checking whether the return value has a `[Symbol.asyncIterator]` method (streaming) or a `.then` method (batch).

### Provider Adapter Examples

**OpenAI TTS adapter:**

```typescript
import { TTSProvider, AudioData } from 'tts-queue';
import OpenAI from 'openai';

function createOpenAITTSProvider(options: {
  apiKey: string;
  model?: string;
  voice?: string;
}): TTSProvider {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    outputFormat: { codec: 'mp3', sampleRate: 24000, channels: 1 },

    async synthesize(text: string, signal: AbortSignal): Promise<AudioData> {
      const response = await client.audio.speech.create(
        {
          model: options.model ?? 'tts-1',
          voice: options.voice ?? 'alloy',
          input: text,
          response_format: 'mp3',
        },
        { signal },
      );
      const buffer = new Uint8Array(await response.arrayBuffer());
      return { buffer };
    },
  };
}
```

**ElevenLabs streaming adapter:**

```typescript
import { TTSProvider, AudioChunk } from 'tts-queue';

function createElevenLabsTTSProvider(options: {
  apiKey: string;
  voiceId: string;
  modelId?: string;
}): TTSProvider {
  return {
    outputFormat: { codec: 'mp3', sampleRate: 44100, channels: 1 },

    async *synthesize(
      text: string,
      signal: AbortSignal,
    ): AsyncIterable<AudioChunk> {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${options.voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': options.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: options.modelId ?? 'eleven_monolingual_v1',
          }),
          signal,
        },
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield { buffer: value, isFinal: false };
        }
        yield { buffer: new Uint8Array(0), isFinal: true };
      } finally {
        reader.releaseLock();
      }
    },
  };
}
```

### Voice and Model Configuration

Voice and model selection are the provider's responsibility, not the queue's. Each provider adapter accepts voice/model configuration in its constructor. This design keeps the queue interface simple (text in, audio out) and avoids the queue needing to know about provider-specific parameters like voice IDs, model names, speaking rates, or pitch adjustments. If the application needs to change voices mid-conversation, it creates a new provider adapter with the desired voice and either creates a new queue or updates the queue's provider via `queue.setProvider(newProvider)`.

---

## 8. Audio Sink Interface

### Interface Definition

The `AudioSink` interface abstracts audio output. The queue pushes audio data to the sink; the sink handles the actual rendering.

```typescript
/**
 * Audio output sink. Receives audio data from the queue and plays,
 * streams, or stores it.
 */
interface AudioSink {
  /**
   * Write audio data to the sink. The sink should begin playing
   * or processing the data immediately.
   *
   * For sinks that play audio through speakers, this method should
   * resolve when the audio data has been accepted into the playback
   * buffer (not when playback completes).
   *
   * @param audio - Raw audio bytes.
   * @returns A promise that resolves when the data has been accepted.
   */
  write(audio: Uint8Array): Promise<void>;

  /**
   * Stop current playback immediately. Discard any buffered audio.
   * Must complete within 50ms.
   */
  stop(): void;

  /**
   * Pause current playback. Audio position is preserved.
   * Calling write() while paused should buffer the data.
   */
  pause?(): void;

  /**
   * Resume playback after pause.
   */
  resume?(): void;

  /**
   * Register a callback that fires when all written audio has finished
   * playing. This signals the queue to advance to the next segment.
   */
  onEnd(callback: () => void): void;

  /**
   * Optional: the audio format this sink expects. If provided, the
   * queue warns if the provider's output format does not match.
   */
  readonly expectedFormat?: AudioFormat;
}
```

### Built-In Sink Adapters

`tts-queue` provides the following built-in sink adapter factories. Each returns an `AudioSink` implementation. These are convenience starting points; most production applications will implement a custom sink.

**`createCallbackSink(callback)`:** A minimal sink that invokes a callback with each audio chunk. The callback is responsible for playback. Useful for integrating with custom audio pipelines or forwarding audio over a WebSocket.

```typescript
const sink = createCallbackSink({
  onAudio: (audio: Uint8Array) => {
    websocket.send(audio);
  },
  onEnd: () => {
    console.log('Segment playback complete');
  },
});
```

**`createBufferSink()`:** Collects all audio data into an in-memory buffer. Does not play audio. Useful for testing, file generation, or scenarios where the application wants to accumulate audio and handle output separately.

```typescript
const sink = createBufferSink();
const queue = createQueue({ provider, sink });
queue.enqueue('Hello, world!');
queue.on('ended', () => {
  const allAudio = sink.getBuffer();  // Uint8Array of all audio
  fs.writeFileSync('output.mp3', allAudio);
});
```

**`createStreamSink(writable)`:** Wraps a Node.js `Writable` stream. Audio data is written to the stream. Useful for piping audio to files, network sockets, or the `speaker` npm package.

```typescript
import Speaker from 'speaker';

const speaker = new Speaker({
  channels: 1,
  bitDepth: 16,
  sampleRate: 24000,
});
const sink = createStreamSink(speaker);
```

### Custom Sink Implementation

Applications implement the `AudioSink` interface for their specific audio output needs. The contract is straightforward:

1. `write(audio)` is called with audio chunks. Accept them into a playback buffer.
2. `stop()` is called for interruption. Immediately halt playback and discard buffered data.
3. Call the `onEnd` callback when all written audio has finished playing. This is the critical signal that tells the queue to advance to the next segment.
4. `pause()` and `resume()` are optional. If not implemented, `queue.pause()` stops writing to the sink but does not pause in-progress playback of the current segment.

The `onEnd` callback must be called exactly once per segment (between the last `write()` call for a segment and the first `write()` call for the next segment). Calling it too early causes the queue to advance prematurely. Not calling it causes the queue to stall.

---

## 9. Audio Queue Management

### FIFO Queue Mechanics

The queue maintains an ordered array of segments. Segments are appended to the tail (via ingestion) and consumed from the head (via playback). Three pointers track progress:

- **`playbackIndex`**: The index of the segment currently being played (or the next segment to play if nothing is currently playing). Advances by one each time a segment's playback completes.
- **`generationIndex`**: The index of the next segment to send to the TTS provider. Advances by one each time a segment is sent to the provider. Always ahead of `playbackIndex` by at most `preBufferCount`.
- **`tailIndex`**: The index where the next segment will be added. Always >= `generationIndex`.

Invariant: `playbackIndex <= generationIndex <= tailIndex`.

### Pre-Buffer Window

The pre-buffer window is the range `[playbackIndex + 1, playbackIndex + preBufferCount]`. Segments within this window should be in `generating` or `ready` state. The generation loop periodically checks whether any `pending` segments fall within the window and starts their TTS synthesis.

When `playbackIndex` advances (a segment finishes playing), the window shifts forward, potentially bringing a new `pending` segment into range. The generation loop picks it up on its next check.

### Backpressure

If segments accumulate faster than TTS can synthesize and playback can consume, the queue applies backpressure:

- **Maximum queue size (`maxQueueSize`, default 20)**: When the number of segments in the queue (excluding `done` segments) reaches this limit, `enqueue()` blocks (returns a promise that resolves when space is available) and `enqueueStream()` pauses consumption of the source async iterable. This prevents unbounded memory growth from a fast text source paired with a slow TTS provider.
- **Backpressure release**: When a segment transitions to `done` and the queue size drops below `maxQueueSize`, the backpressure is released: `enqueue()` resolves and `enqueueStream()` resumes pulling from the source.

### Segment Cleanup

Once a segment reaches `done` state, its audio data is eligible for garbage collection. The queue does not retain audio data for completed segments unless `retainAudio` is set to `true` in the configuration (useful for replay or scrubbing functionality). By default, completed segments retain only their metadata (text, timing, duration) and release their audio buffers.

### Queue Statistics

The queue tracks cumulative statistics available via `getStats()`:

```typescript
interface QueueStats {
  /** Total number of segments enqueued since queue creation. */
  totalSegments: number;

  /** Number of segments that completed playback. */
  completedSegments: number;

  /** Number of segments cancelled. */
  cancelledSegments: number;

  /** Number of segments that failed (TTS error). */
  failedSegments: number;

  /** Total audio duration played in milliseconds. */
  totalPlaybackDurationMs: number;

  /** Average TTS synthesis latency (time from request to first audio chunk)
   *  in milliseconds. */
  averageSynthesisLatencyMs: number;

  /** Average gap between segments in milliseconds. Zero means gapless.
   *  A positive value indicates buffering occurred. */
  averageGapMs: number;

  /** Number of times buffering occurred (next segment not ready when
   *  current segment ended). */
  bufferingCount: number;

  /** Number of times cancel() was called. */
  cancellationCount: number;
}
```

---

## 10. Pre-Buffering Strategy

### Fixed Lookahead

The default pre-buffering strategy uses a fixed lookahead count. While segment N plays, the queue ensures that segments N+1 through N+`preBufferCount` (default 2) are in `generating` or `ready` state. This means up to `preBufferCount` TTS API calls may be in-flight simultaneously.

**Why default 2:** With a pre-buffer of 1, there is exactly one segment being synthesized ahead of the current playback. If that synthesis is slow (TTS provider latency spike, network hiccup), the queue stalls. With a pre-buffer of 2, there are two segments ahead, providing a deeper buffer against latency variance. A pre-buffer of 3 or more is rarely needed -- it increases concurrent API calls and memory usage without significant benefit because most TTS providers have consistent latency for sentence-length input.

### Adaptive Lookahead (Future Enhancement)

An adaptive strategy adjusts the lookahead based on observed TTS latency:

- If recent synthesis calls have been slow (above a threshold), increase the lookahead by 1, up to `maxPreBufferCount`.
- If recent synthesis calls have been consistently fast (below a threshold), decrease the lookahead by 1, down to `minPreBufferCount`.

This optimization is documented here for completeness but is not included in the initial implementation. The fixed lookahead handles the vast majority of use cases well.

### Cancellation on Flush

When `cancel()` is called, all segments in `generating` state have their `AbortController` aborted. This sends an abort signal to the TTS provider, which should terminate the in-flight HTTP request and stop generating audio. The segments transition to `cancelled`. Cancelling pre-buffered segments is critical for two reasons: (1) it releases provider resources immediately (important for rate-limited APIs), and (2) it ensures no stale audio data arrives after cancellation (which would confuse the queue's state).

### Configuration

```typescript
createQueue({
  // ...

  /** Number of segments to pre-buffer ahead of current playback.
   *  Default: 2. */
  preBufferCount: 2,

  /** Maximum number of segments in the queue before backpressure
   *  is applied. Default: 20. */
  maxQueueSize: 20,
});
```

---

## 11. Interruption Handling

### The Interruption Problem

In a voice AI application, when the user begins speaking (barge-in), the AI must stop talking immediately. "Immediately" means within 100ms -- any longer, and the user hears overlapping speech, which breaks the conversational illusion. The interruption must cancel everything: stop the audio currently playing through the speaker, cancel TTS API calls that are in-flight (generating audio for upcoming sentences), and discard any queued segments that have not yet played. After interruption, the queue must be in a clean state, ready to enqueue and play new text (the AI's next response, which will be generated based on the user's interrupting speech).

### Cancellation Sequence

When `cancel()` is called, the following sequence executes:

1. **Stop audio sink (target: <10ms).** Call `sink.stop()`. The sink must immediately halt playback. For speaker-based sinks, this means stopping the audio driver. For stream-based sinks, this means stopping writes.

2. **Abort in-flight TTS calls (target: <5ms).** For every segment in `generating` state, call `abort()` on its `AbortController`. This sends the abort signal to the TTS provider's `synthesize()` call, which should terminate the HTTP request. The segments transition to `cancelled`.

3. **Discard queued segments (target: <1ms).** All segments in `pending` and `ready` state transition to `cancelled`. Their audio data references are released.

4. **Record interruption metadata (target: <1ms).** The queue records which segment was playing at the time of cancellation, how much of its audio had been played (if the sink supports reporting playback position), and the text of all segments that were cancelled (for the application's reference, e.g., to note how much of the AI's response was not delivered).

5. **Reset queue state (target: <1ms).** The queue transitions to `idle`. Pointers are reset. The queue is ready to accept new `enqueue()` or `enqueueStream()` calls.

**Total target: <20ms.** The 100ms budget includes the application's detection latency (time from user speech to the application calling `cancel()`) and the queue's cancellation latency. The queue targets under 20ms for its portion, leaving comfortable margin for the application.

### Cancellation Return Value

`cancel()` returns a `CancelResult` object with information about what was cancelled:

```typescript
interface CancelResult {
  /** The segment that was playing when cancel() was called, or null
   *  if nothing was playing. */
  playingSegment: {
    /** The segment's text. */
    text: string;

    /** The segment's index in the queue. */
    index: number;

    /** Approximate playback progress as a ratio (0.0 to 1.0).
     *  Null if the sink does not report playback position. */
    progress: number | null;
  } | null;

  /** Texts of segments that were in the queue but had not been played. */
  pendingTexts: string[];

  /** Total number of segments cancelled (including the playing segment). */
  cancelledCount: number;
}
```

This information is useful for `voice-turn` to report what portion of the AI's response was spoken before interruption (the `BargeInEvent.spokenResponse` field).

### Abort Controller Architecture

Each segment has its own `AbortController` instance. The controller is created when the segment transitions from `pending` to `generating`, and its signal is passed to the TTS provider's `synthesize()` call. When `cancel()` is called, each active controller's `abort()` method is called. This is more precise than a shared controller because it allows individual segments to be cancelled independently (future enhancement: selective cancellation of specific segments without affecting others).

The queue also maintains a top-level `AbortController` that is aborted on `cancel()`. This provides a coarse-grained abort signal that the `enqueueStream()` consumer uses to stop pulling from the source stream.

---

## 12. Playback Interface

### Playback Control Methods

```typescript
interface TTSQueue {
  /**
   * Start or resume playback. If the queue has segments in `ready`
   * state, begin playing the first one. If the queue is empty,
   * playback begins automatically when the first segment becomes ready.
   */
  play(): void;

  /**
   * Pause playback. The current segment stops playing (if the sink
   * supports pause). Pre-buffering continues. Call resume() to continue.
   */
  pause(): void;

  /**
   * Resume playback after pause.
   */
  resume(): void;

  /**
   * Cancel all playback and queued segments. See Interruption Handling.
   * Returns metadata about what was cancelled.
   */
  cancel(): CancelResult;

  /**
   * Signal that no more text will be enqueued. The queue plays through
   * remaining segments and emits 'ended' when the last one finishes.
   * Without calling drain(), the queue waits indefinitely for more input
   * after the last segment finishes.
   */
  drain(): void;
}
```

### Playback Flow

A typical playback flow proceeds as follows:

1. Application calls `queue.enqueue("Hello! How can I help you today? I'm ready to assist with anything you need.")`.
2. The splitter produces four segments: `"Hello!"`, `"How can I help you today?"`, `"I'm ready to assist with anything you need."`.
3. Segments 0, 1, and 2 enter the pre-buffer window (pre-buffer count is 2, so segments 0, 1, 2 start generating). Segment 0 generates first.
4. Segment 0 becomes `ready`. The queue starts playing it through the sink. Segment 0 transitions to `playing`.
5. While segment 0 plays, segments 1 and 2 continue generating.
6. Segment 0 finishes playing. The sink signals `onEnd`. Segment 0 transitions to `done`.
7. Segment 1 is `ready`. The queue immediately starts playing it. Gapless transition.
8. Segment 1 finishes. Segment 2 plays. Segment 2 finishes. All segments are `done`.
9. The queue emits `ended` (if `drain()` was called) or waits for more input (if not).

### Streaming Playback Flow

For streaming input via `enqueueStream()`:

1. Application calls `queue.enqueueStream(llmTokenStream)`.
2. Tokens arrive: `"Hello"`, `"!"`, `" How"`, `" can"`, `" I"`, ...
3. The streaming splitter accumulates tokens. After `"!"` arrives (followed by a token starting with whitespace), `"Hello!"` is emitted as a complete sentence. Segment 0 is created in `pending` state.
4. Segment 0 enters the pre-buffer window and starts generating.
5. More tokens arrive, eventually completing `"How can I help you today?"`. Segment 1 is created.
6. Segment 0 becomes `ready` and starts playing.
7. The process continues until the LLM stream ends. The remaining buffer is flushed as the final segment.

### Autoplay

By default, the queue begins playback automatically when the first segment becomes `ready`. This is the expected behavior for voice AI: the AI should start speaking as soon as possible. Autoplay can be disabled via `autoplay: false` in the configuration, in which case the application must explicitly call `queue.play()` to begin playback.

---

## 13. Cross-Provider Normalization

### The Normalization Problem

Different TTS providers output audio in different formats:

| Provider | Default Format | Sample Rate | Streaming |
|----------|---------------|-------------|-----------|
| OpenAI TTS | MP3 or PCM | 24,000 Hz | Yes (chunked HTTP) |
| ElevenLabs | MP3 | 44,100 Hz | Yes (chunked HTTP) |
| Google Cloud TTS | LINEAR16 (PCM) or MP3 | 24,000 Hz | No (batch) |
| Azure Cognitive Services | WAV, MP3, or Opus | 16,000-48,000 Hz | Yes (WebSocket) |
| Amazon Polly | MP3, OGG, or PCM | 8,000-24,000 Hz | Yes (HTTP) |

An application that switches between providers (or uses different providers for different languages/voices) must handle these format differences. The audio sink expects a consistent format.

### Queue's Role in Normalization

The queue itself does not transcode audio. Transcoding is complex, requires codec libraries, and belongs in a dedicated audio processing layer. Instead, the queue provides the following normalization support:

**Format metadata propagation:** The provider declares its `outputFormat` (codec, sample rate, channels, bit depth). The sink declares its `expectedFormat`. The queue checks compatibility at initialization and warns if they do not match.

**Duration estimation:** For providers that do not report audio duration, the queue estimates duration from the audio buffer size and format metadata. For PCM audio: `durationMs = (bufferSize / (sampleRate * channels * (bitDepth / 8))) * 1000`. For compressed formats (MP3, Opus), duration estimation is approximate and based on average bitrate.

**Provider switching:** `queue.setProvider(newProvider)` allows changing the TTS provider at runtime. The new provider is used for all subsequent segments. Segments already in `generating` or `ready` state continue with the old provider. This enables scenarios like switching to a different voice mid-conversation or falling back to a different provider on error.

### Application-Level Normalization

For applications that need true audio format normalization (sample rate conversion, codec transcoding), the recommended pattern is to implement the normalization in the provider adapter or sink adapter:

```typescript
// Provider adapter that normalizes output to PCM 24kHz
function createNormalizedProvider(
  innerProvider: TTSProvider,
  targetFormat: AudioFormat,
): TTSProvider {
  return {
    outputFormat: targetFormat,
    async synthesize(text, signal) {
      const audio = await innerProvider.synthesize(text, signal);
      return convertFormat(audio, innerProvider.outputFormat, targetFormat);
    },
  };
}
```

---

## 14. API Surface

### Installation

```bash
npm install tts-queue
```

### Primary Function: `createQueue`

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({
  provider: myTTSProvider,
  sink: myAudioSink,
});

queue.enqueue('Hello! How can I help you today?');

queue.on('ended', () => {
  console.log('Playback complete');
});
```

### Type Definitions

```typescript
// ── Queue Options ───────────────────────────────────────────────────

/** Configuration for createQueue(). */
interface QueueOptions {
  /** TTS provider for audio synthesis. Required. */
  provider: TTSProvider;

  /** Audio output sink. Required. */
  sink: AudioSink;

  /** Number of segments to pre-buffer ahead of playback.
   *  Default: 2. */
  preBufferCount?: number;

  /** Maximum segments in queue before backpressure is applied.
   *  Default: 20. */
  maxQueueSize?: number;

  /** Begin playback automatically when the first segment is ready.
   *  Default: true. */
  autoplay?: boolean;

  /** Retain audio data for completed segments (for replay).
   *  Default: false. */
  retainAudio?: boolean;

  /** Sentence splitting configuration. */
  splitting?: SplittingOptions;

  /** Timeout for TTS synthesis per segment in milliseconds.
   *  If synthesis takes longer, the segment is marked as failed.
   *  Default: 30000. */
  synthesisTimeoutMs?: number;

  /** AbortSignal for external cancellation of the entire queue. */
  signal?: AbortSignal;
}

/** Sentence splitting configuration. */
interface SplittingOptions {
  /** Minimum segment length in characters. Default: 10. */
  minSegmentLength?: number;

  /** Maximum segment length in characters. Default: 200. */
  maxSegmentLength?: number;

  /** Additional abbreviations (periods after these are not sentence
   *  boundaries). Merged with the built-in list. */
  abbreviations?: string[];

  /** Custom sentence splitting function. Overrides the built-in splitter. */
  splitSentences?: (text: string) => string[];
}

// ── TTSQueue Instance ───────────────────────────────────────────────

/** The queue instance returned by createQueue(). */
interface TTSQueue {
  /**
   * Enqueue text for synthesis and playback. The text is split into
   * segments (sentences) and each segment is queued for synthesis.
   * Returns a promise that resolves when the segments have been
   * added to the queue (not when they finish playing).
   * Blocks if the queue is at maxQueueSize (backpressure).
   */
  enqueue(text: string): Promise<void>;

  /**
   * Enqueue a streaming text source. Tokens are accumulated into
   * sentences and each sentence is queued as a segment.
   * The returned promise resolves when the source stream ends.
   * Applies backpressure if the queue is full.
   *
   * Accepts either raw token strings (AsyncIterable<string>), which
   * are split using the built-in streaming splitter, or pre-aggregated
   * sentence chunks from stream-tokens (AsyncIterable<{ content: string }>).
   */
  enqueueStream(
    stream: AsyncIterable<string> | AsyncIterable<{ content: string }>,
  ): Promise<void>;

  /** Start or resume playback. */
  play(): void;

  /** Pause playback. Pre-buffering continues. */
  pause(): void;

  /** Resume playback after pause. */
  resume(): void;

  /** Cancel all playback and pending synthesis. Returns cancellation
   *  metadata. */
  cancel(): CancelResult;

  /** Signal that no more text will be added. Plays through remaining
   *  segments and emits 'ended' when done. */
  drain(): void;

  /** Get the current queue state. */
  getState(): QueueState;

  /** Get cumulative queue statistics. */
  getStats(): QueueStats;

  /** Get information about the currently playing segment, or null. */
  getCurrentSegment(): SegmentInfo | null;

  /** Get the number of segments in the queue (excluding done/cancelled). */
  readonly pendingCount: number;

  /** Whether the queue is currently playing. */
  readonly isPlaying: boolean;

  /** Replace the TTS provider. Applies to subsequent segments only. */
  setProvider(provider: TTSProvider): void;

  /** Register an event listener. */
  on<E extends keyof TTSQueueEvents>(
    event: E,
    handler: TTSQueueEvents[E],
  ): this;

  /** Remove an event listener. */
  off<E extends keyof TTSQueueEvents>(
    event: E,
    handler: TTSQueueEvents[E],
  ): this;

  /** Destroy the queue, releasing all resources. */
  destroy(): void;
}

// ── Queue State ─────────────────────────────────────────────────────

type QueueState = 'idle' | 'playing' | 'paused' | 'draining';

// ── Segment Info ────────────────────────────────────────────────────

/** Information about a segment. */
interface SegmentInfo {
  /** Segment index (0-based within the current queue). */
  index: number;

  /** The text that was sent to TTS. */
  text: string;

  /** Current segment state. */
  state: SegmentState;

  /** Audio duration in milliseconds (null if not yet known). */
  durationMs: number | null;

  /** TTS synthesis latency in milliseconds: time from synthesis request
   *  to first audio data. Null if not yet generated. */
  synthesisLatencyMs: number | null;
}

type SegmentState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'done'
  | 'cancelled';

// ── Events ──────────────────────────────────────────────────────────

/** Event signatures for the TTSQueue event emitter. */
interface TTSQueueEvents {
  /** Playback started (first segment begins playing). */
  playing: () => void;

  /** A specific segment started playing. */
  segmentStart: (segment: SegmentInfo) => void;

  /** A specific segment finished playing. */
  segmentEnd: (segment: SegmentInfo) => void;

  /** All segments have finished playing. */
  ended: () => void;

  /** Next segment is not ready; waiting for TTS synthesis. */
  buffering: () => void;

  /** Buffering ended; playback resumed. */
  bufferingEnd: () => void;

  /** Queue state changed. */
  stateChange: (from: QueueState, to: QueueState) => void;

  /** Queue has been drained (all segments done, no more input). */
  drain: () => void;

  /** Error in TTS synthesis or playback. */
  error: (error: TTSQueueError) => void;
}

// ── Error Types ─────────────────────────────────────────────────────

interface TTSQueueError {
  /** Which stage the error occurred in. */
  stage: 'synthesis' | 'playback' | 'splitting' | 'internal';

  /** The underlying error. */
  cause: Error;

  /** Human-readable description. */
  message: string;

  /** The segment that was being processed, if applicable. */
  segment?: SegmentInfo;
}

// ── Cancel Result ───────────────────────────────────────────────────

interface CancelResult {
  playingSegment: {
    text: string;
    index: number;
    progress: number | null;
  } | null;
  pendingTexts: string[];
  cancelledCount: number;
}

// ── Queue Stats ─────────────────────────────────────────────────────

interface QueueStats {
  totalSegments: number;
  completedSegments: number;
  cancelledSegments: number;
  failedSegments: number;
  totalPlaybackDurationMs: number;
  averageSynthesisLatencyMs: number;
  averageGapMs: number;
  bufferingCount: number;
  cancellationCount: number;
}
```

### `createQueue` Function

```typescript
/**
 * Create a TTS playback queue.
 *
 * @param options - Configuration including provider, sink, and queue options.
 * @returns A TTSQueue instance.
 */
function createQueue(options: QueueOptions): TTSQueue;
```

---

## 15. Configuration

### Full Configuration Reference

```typescript
const queue = createQueue({
  // ── Required ──────────────────────────────────────────────────────

  /** TTS provider. See TTSProvider interface. */
  provider: myProvider,

  /** Audio output sink. See AudioSink interface. */
  sink: mySink,

  // ── Queue Behavior ────────────────────────────────────────────────

  /** Segments to pre-buffer ahead of playback. Default: 2.
   *  Range: 0 (no pre-buffering) to 10. */
  preBufferCount: 2,

  /** Maximum segments in queue. Default: 20.
   *  Range: 1 to 100. */
  maxQueueSize: 20,

  /** Start playback automatically. Default: true. */
  autoplay: true,

  /** Keep audio data for completed segments. Default: false. */
  retainAudio: false,

  /** TTS synthesis timeout per segment (ms). Default: 30000. */
  synthesisTimeoutMs: 30000,

  // ── Sentence Splitting ────────────────────────────────────────────

  splitting: {
    /** Minimum segment length (characters). Default: 10. */
    minSegmentLength: 10,

    /** Maximum segment length (characters). Default: 200. */
    maxSegmentLength: 200,

    /** Extra abbreviations. Default: []. */
    abbreviations: ['Corp.', 'Inc.'],

    /** Custom splitter. Default: built-in heuristic splitter. */
    splitSentences: undefined,
  },

  // ── External Cancellation ─────────────────────────────────────────

  /** AbortSignal for external cancellation. */
  signal: abortController.signal,
});
```

### Defaults

| Option | Default | Notes |
|--------|---------|-------|
| `preBufferCount` | 2 | Two segments ahead. Balances latency vs. API concurrency. |
| `maxQueueSize` | 20 | ~20 sentences. Enough for a long AI response without unbounded growth. |
| `autoplay` | `true` | Voice AI expects immediate playback. |
| `retainAudio` | `false` | Release audio data after playback to save memory. |
| `synthesisTimeoutMs` | 30000 | 30 seconds. TTS providers rarely take longer than 10 seconds per sentence. |
| `minSegmentLength` | 10 | Prevents "Yes." or "OK." from being standalone segments. |
| `maxSegmentLength` | 200 | Prevents paragraph-length segments that degrade TTS quality. |

---

## 16. Integration

### With `voice-turn`

`voice-turn` manages the full conversational pipeline: STT, LLM, and TTS. It uses `tts-queue` as the TTS playback layer. The integration works as follows:

1. `voice-turn` receives complete sentences from its internal sentence splitter (after aggregating LLM tokens).
2. Each sentence is passed to `tts-queue` via `queue.enqueue(sentence)`.
3. `tts-queue` synthesizes the sentence via the TTS provider and plays the audio through the sink.
4. When the user interrupts (barge-in), `voice-turn` calls `queue.cancel()`.
5. The `CancelResult` tells `voice-turn` which sentences were spoken and which were not, populating the `BargeInEvent`.
6. `voice-turn` listens to `queue.on('ended')` to know when the AI's response has been fully spoken, triggering the transition from `ai-speaking` to `idle`.

```typescript
import { createTurnManager } from 'voice-turn';
import { createQueue } from 'tts-queue';

const ttsQueue = createQueue({ provider: openaiTTS, sink: speakerSink });

const manager = createTurnManager({
  stt: mySTT,
  llm: myLLM,
  tts: {
    speak(text, signal) {
      ttsQueue.enqueue(text);
      return {
        audio: new ReadableStream(), // Queue handles playback via sink
        cancel: () => ttsQueue.cancel(),
      };
    },
  },
});
```

### With `stream-tokens`

`stream-tokens` aggregates raw LLM tokens into complete sentences. `tts-queue` can consume sentence output from `stream-tokens` directly:

```typescript
import { sentences } from 'stream-tokens';
import { createQueue } from 'tts-queue';

const queue = createQueue({ provider: myTTS, sink: mySink });

// llmStream is AsyncIterable<string> from an LLM SDK
const sentenceStream = sentences(llmStream);

// enqueueStream accepts AsyncIterable<{ content: string }> from stream-tokens
await queue.enqueueStream(sentenceStream);
```

This is the recommended integration pattern because `stream-tokens` has more sophisticated sentence boundary detection than the queue's built-in splitter.

### Standalone Usage (No Dependencies)

`tts-queue` works independently of `voice-turn` and `stream-tokens`:

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({
  provider: myTTSProvider,
  sink: myAudioSink,
});

// Enqueue complete text (auto-split into sentences)
queue.enqueue('Welcome to the demo. This text will be split into sentences. Each sentence is synthesized and played in order.');

// Or enqueue pre-split segments
queue.enqueue('First sentence.');
queue.enqueue('Second sentence.');
queue.enqueue('Third sentence.');

queue.drain();

queue.on('ended', () => {
  console.log('All done');
  console.log(queue.getStats());
});
```

---

## 17. Error Handling

### Error Philosophy

The queue never enters a stuck state. All error paths either skip the failed segment and continue or transition the queue to `idle`. The queue emits `error` events for all errors but does not throw or crash. This is critical for voice AI: a TTS failure for one sentence should not silence the entire response.

### Error Scenarios

| Scenario | Queue Behavior |
|----------|---------------|
| TTS provider throws during `synthesize()` | Segment transitions to `cancelled`. Queue emits `error` event with `stage: 'synthesis'`. Queue advances to next segment. If no more segments, emits `ended`. |
| TTS provider times out (no response within `synthesisTimeoutMs`) | `AbortController` is aborted. Segment transitions to `cancelled`. Queue emits `error` event with timeout description. Queue advances to next segment. |
| TTS provider returns empty audio | Segment transitions to `done` (treated as zero-duration). Queue advances to next segment immediately. Warning emitted via `error` event. |
| Audio sink throws during `write()` | Segment transitions to `cancelled`. Queue emits `error` event with `stage: 'playback'`. Queue advances to next segment. |
| Audio sink never calls `onEnd` | After `sinkTimeoutMs` (default: 60000ms), the queue treats the segment as done and advances. Warning emitted via `error` event. |
| Source stream errors during `enqueueStream()` | Queue emits `error` event with `stage: 'splitting'`. Any segments already enqueued continue playing. No new segments are added. |
| `cancel()` called during error recovery | Queue transitions to `idle` cleanly. No additional errors emitted. |

### Error Event

```typescript
queue.on('error', (error: TTSQueueError) => {
  console.error(`[${error.stage}] ${error.message}`, error.cause);
  if (error.segment) {
    console.error(`  Segment ${error.segment.index}: "${error.segment.text}"`);
  }
});
```

### Retry

The queue does not implement automatic retry. Retry logic belongs in the TTS provider adapter, where the provider can implement provider-specific retry strategies (exponential backoff, different API endpoints, fallback voices). The queue's role is to skip failed segments and continue, not to retry them.

---

## 18. Testing Strategy

### Unit Tests

**Sentence splitter tests:**
- Split basic sentences (period, question mark, exclamation mark).
- Handle abbreviations (Dr., Mr., U.S., etc.).
- Handle decimal numbers (3.14, $99.99).
- Handle ellipsis (...).
- Handle URLs and email addresses.
- Enforce minimum segment length (merge short segments).
- Enforce maximum segment length (split at clause boundaries).
- Handle empty string input.
- Handle input with no sentence boundaries (single sentence).
- Handle input with only punctuation.

**Queue state machine tests:**
- Verify state transitions: idle -> playing -> idle (after ended).
- Verify state transitions: idle -> playing -> paused -> playing -> idle.
- Verify state transitions: playing -> idle (after cancel).
- Verify segment lifecycle: pending -> generating -> ready -> playing -> done.
- Verify cancel transitions all active segments to cancelled.
- Verify backpressure: enqueue blocks when queue is full.

**Pre-buffering tests:**
- Verify correct number of segments start generating (preBufferCount).
- Verify generation window advances when playback advances.
- Verify pre-buffered segments are cancelled on cancel().

### Integration Tests (Mock Provider and Sink)

**Gapless playback test:**
- Enqueue three sentences with a mock provider that returns audio after a configurable delay. Verify that the sink receives audio for segment 2 within 1ms of segment 1 ending (gapless).

**Buffering test:**
- Enqueue two sentences with a mock provider that takes longer than the first segment's playback duration. Verify that a `buffering` event is emitted between segments.

**Interruption test:**
- Enqueue five sentences. After segment 1 starts playing, call `cancel()`. Verify: sink.stop() was called, all generating segments' AbortControllers were aborted, CancelResult contains correct metadata.

**Streaming input test:**
- Create an async iterable that yields tokens with delays. Pass to `enqueueStream()`. Verify that segments are created as sentences complete and playback begins after the first segment is ready.

**Error recovery test:**
- Configure mock provider to throw on segment 2 of 5. Verify that segment 2 is skipped, segments 1, 3, 4, 5 play successfully, and an `error` event is emitted for segment 2.

### End-to-End Tests

**Real TTS provider test (optional, requires API key):**
- Create an OpenAI TTS provider adapter. Enqueue a paragraph. Verify that audio data is received and has valid MP3 headers.

**Latency measurement test:**
- Enqueue a sentence with a mock provider that has a known delay. Verify that `getStats().averageSynthesisLatencyMs` matches the expected delay within tolerance.

### Test Utilities

The package exports test utilities for consumers:

```typescript
import { createMockProvider, createMockSink } from 'tts-queue/test';

const provider = createMockProvider({
  /** Simulated synthesis delay in milliseconds. */
  delayMs: 100,
  /** Audio duration per segment in milliseconds. */
  audioDurationMs: 500,
  /** Whether to simulate streaming (chunks) or batch (single buffer). */
  streaming: false,
  /** Simulate failure for segments matching this predicate. */
  failWhen: (text) => text.includes('fail'),
});

const sink = createMockSink({
  /** Simulated playback speed multiplier. 1 = real-time, Infinity = instant. */
  playbackSpeed: Infinity,
});
```

---

## 19. Performance

### Queue Management Overhead

The queue itself performs minimal computation: maintaining an array of segments, tracking state transitions, and coordinating timers. The overhead is negligible compared to TTS API latency and audio playback duration. Target: queue management operations (enqueue, state transitions, event emission) complete within 1ms.

### Pre-Buffer Effectiveness

Pre-buffering effectiveness is measured by the gap rate: the fraction of segment transitions where the next segment was not ready and a `buffering` event was emitted. With a pre-buffer of 2 and a TTS provider with consistent sub-second latency, the gap rate should be <1% for normal conversational speech (sentences of 5-20 words). The `getStats().bufferingCount` metric tracks this.

### Interruption Latency

The queue targets <20ms from `cancel()` call to the sink's `stop()` being called and all `AbortController` instances being aborted. This is measured in integration tests with high-resolution timers. The total user-perceived interruption latency includes the application's barge-in detection time (typically 100-200ms) plus the queue's cancellation time.

### Memory Usage

Each segment consumes memory proportional to its audio data. For PCM 16-bit mono at 24kHz, one second of audio is 48KB. A typical sentence (2-4 seconds) consumes 96-192KB. With a pre-buffer of 2 and `retainAudio: false`, the queue holds at most 3 segments' audio in memory at any time (playing + 2 pre-buffered), which is approximately 300-600KB. For compressed formats (MP3), memory usage is approximately 10x less.

### Backpressure Effectiveness

When the TTS provider is slower than text ingestion, the queue applies backpressure by blocking `enqueue()` or pausing `enqueueStream()` consumption. The backpressure is tested by feeding text faster than the mock provider can synthesize and verifying that the queue size never exceeds `maxQueueSize`.

---

## 20. Dependencies

### Runtime Dependencies

- **None.** The core queue is implemented entirely with built-in Node.js APIs (EventEmitter, AbortController, timers, typed arrays). The queue has zero runtime dependencies.

### Peer Dependencies

- **None.** `stream-tokens` and `voice-turn` are optional integration targets, not dependencies. The queue works standalone.

### Dev Dependencies

- **`typescript`** (^5.0): TypeScript compiler.
- **`vitest`** (^1.0): Test runner.
- **`eslint`** (^8.0): Linter.

---

## 21. File Structure

```
tts-queue/
├── src/
│   ├── index.ts              # Public API: createQueue, types, sink factories
│   ├── queue.ts              # TTSQueue class: core queue logic, state machine
│   ├── segment.ts            # Segment class: lifecycle, state transitions, timing
│   ├── splitter.ts           # Sentence splitting: built-in + streaming splitter
│   ├── generation.ts         # Generation loop: pre-buffering, TTS provider calls
│   ├── playback.ts           # Playback loop: sink coordination, gapless transitions
│   ├── sinks/
│   │   ├── callback.ts       # createCallbackSink
│   │   ├── buffer.ts         # createBufferSink
│   │   └── stream.ts         # createStreamSink
│   ├── types.ts              # All TypeScript interfaces and type definitions
│   └── errors.ts             # TTSQueueError class and error utilities
├── src/__tests__/
│   ├── splitter.test.ts      # Sentence splitter unit tests
│   ├── queue.test.ts         # Queue state machine tests
│   ├── generation.test.ts    # Pre-buffering and TTS generation tests
│   ├── playback.test.ts      # Playback loop and gapless transition tests
│   ├── cancel.test.ts        # Interruption and cancellation tests
│   ├── streaming.test.ts     # enqueueStream and streaming splitter tests
│   ├── backpressure.test.ts  # Backpressure and maxQueueSize tests
│   ├── errors.test.ts        # Error handling and recovery tests
│   └── helpers.ts            # Mock provider, mock sink, test utilities
├── package.json
├── tsconfig.json
├── SPEC.md
└── README.md
```

---

## 22. Implementation Roadmap

### Phase 1: Core Queue (MVP)

1. **Types and interfaces**: Define `TTSProvider`, `AudioSink`, `QueueOptions`, `TTSQueue`, `SegmentInfo`, and all event types in `types.ts`.
2. **Segment lifecycle**: Implement the `Segment` class with state transitions and timing tracking.
3. **Sentence splitter**: Implement the built-in sentence splitter with abbreviation handling, long sentence fallback, and short segment merging.
4. **Queue state machine**: Implement the `TTSQueue` class with `enqueue()`, `play()`, `pause()`, `resume()`, `cancel()`, `drain()`, and state transitions.
5. **Generation loop**: Implement pre-buffering with fixed lookahead and `AbortController`-based cancellation.
6. **Playback loop**: Implement ordered playback with gapless transitions and buffering detection.
7. **Built-in sinks**: Implement `createCallbackSink`, `createBufferSink`, and `createStreamSink`.
8. **Error handling**: Implement segment-level error isolation, timeout detection, and error event emission.
9. **Tests**: Unit tests for splitter, state machine, pre-buffering, playback, cancellation, and error recovery. Integration tests with mock provider and sink.

### Phase 2: Streaming and Integration

10. **Streaming splitter**: Implement the streaming sentence boundary detector for `enqueueStream()` with raw token input.
11. **`stream-tokens` integration**: Accept `AsyncIterable<AggregatedChunk>` in `enqueueStream()` and extract sentence content directly.
12. **Backpressure**: Implement `maxQueueSize` enforcement with blocking `enqueue()` and pausing `enqueueStream()`.
13. **Statistics**: Implement `getStats()` with cumulative metrics.
14. **Provider switching**: Implement `setProvider()` for runtime provider replacement.
15. **Tests**: Streaming input tests, backpressure tests, integration tests with `stream-tokens`.

### Phase 3: Polish and Performance

16. **Duration estimation**: Implement audio duration estimation from buffer size and format metadata for providers that do not report duration.
17. **Sink timeout**: Implement detection of sinks that never call `onEnd`, with configurable timeout.
18. **Test utilities**: Export `createMockProvider` and `createMockSink` for consumer testing.
19. **Performance tests**: Latency measurement, memory usage validation, backpressure effectiveness tests.
20. **Documentation**: README with usage examples, provider adapter guides, and integration recipes.

---

## 23. Example Use Cases

### Voice Assistant Playback

The most common use case. An LLM generates a response token by token. The tokens flow through `stream-tokens` for sentence aggregation, then into `tts-queue` for synthesis and playback. The user can interrupt at any time.

```typescript
import { createQueue } from 'tts-queue';
import { sentences } from 'stream-tokens';

const queue = createQueue({
  provider: createOpenAITTSProvider({ apiKey, voice: 'nova' }),
  sink: createStreamSink(speaker),
  preBufferCount: 2,
});

// When the LLM generates a response:
async function speakResponse(llmStream: AsyncIterable<string>) {
  await queue.enqueueStream(sentences(llmStream));
  queue.drain();
}

// When the user interrupts:
function handleBargeIn() {
  const result = queue.cancel();
  console.log(`Interrupted at segment ${result.playingSegment?.index}`);
  console.log(`Unspoken: ${result.pendingTexts.join(' ')}`);
}

queue.on('ended', () => {
  console.log('AI finished speaking');
});
```

### Read-Aloud Feature

A document or article is read aloud with pause/resume controls and progress tracking.

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({
  provider: createElevenLabsTTSProvider({ apiKey, voiceId }),
  sink: createCallbackSink({ onAudio: playAudioChunk }),
  preBufferCount: 3,  // More pre-buffering for long content
});

const articleText = getArticleContent();
await queue.enqueue(articleText);
queue.drain();

// UI controls
readAloudButton.onclick = () => queue.play();
pauseButton.onclick = () => queue.pause();
resumeButton.onclick = () => queue.resume();
stopButton.onclick = () => queue.cancel();

queue.on('segmentStart', (segment) => {
  highlightSentence(segment.index);  // Highlight current sentence in UI
});

queue.on('segmentEnd', (segment) => {
  updateProgress(segment.index, queue.getStats().totalSegments);
});

queue.on('ended', () => {
  showReadAloudComplete();
});
```

### Accessibility Screen Reader

An accessibility tool that speaks UI element descriptions with fast interruption when the user navigates to a new element.

```typescript
import { createQueue } from 'tts-queue';

const queue = createQueue({
  provider: myTTSProvider,
  sink: myAudioSink,
  autoplay: true,
  preBufferCount: 1,  // Low pre-buffer for fast interruption
});

function onFocusChange(element: UIElement) {
  // Cancel any current speech immediately
  queue.cancel();

  // Speak the new element's description
  queue.enqueue(element.accessibilityLabel);
  queue.drain();
}
```

### Podcast-Style Narration

Generate a podcast episode from a script, outputting the audio to a file.

```typescript
import { createQueue, createBufferSink } from 'tts-queue';
import { writeFileSync } from 'fs';

const sink = createBufferSink();
const queue = createQueue({
  provider: createOpenAITTSProvider({
    apiKey,
    model: 'tts-1-hd',
    voice: 'onyx',
  }),
  sink,
  preBufferCount: 5,  // High pre-buffer for throughput
});

const script = readPodcastScript();
await queue.enqueue(script);
queue.drain();

queue.on('ended', () => {
  writeFileSync('episode.mp3', sink.getBuffer());
  console.log(`Generated ${queue.getStats().totalPlaybackDurationMs}ms of audio`);
});
```

### Interactive Tutor with Multi-Turn Conversation

An AI tutor explains a concept, the student asks a question (interrupting), and the tutor responds to the question.

```typescript
import { createQueue } from 'tts-queue';
import { sentences } from 'stream-tokens';

const queue = createQueue({
  provider: myTTSProvider,
  sink: mySpeakerSink,
});

async function tutorExplains(llmStream: AsyncIterable<string>) {
  await queue.enqueueStream(sentences(llmStream));
  queue.drain();
}

function studentInterrupts(): string[] {
  const result = queue.cancel();
  // Return the unspoken portion so the LLM can account for it
  return result.pendingTexts;
}

queue.on('ended', () => {
  // Tutor finished explaining, wait for student's question
  startListening();
});

queue.on('error', (err) => {
  // TTS failed for a sentence, log but continue
  console.warn(`TTS error: ${err.message}`);
});
```
