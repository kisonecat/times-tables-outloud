# Times Tables Out Loud — Build Plan

A web app that drills multiplication facts (1×1 through 12×12). The learner **says the answer out loud**, and the app recognizes the spoken number on the device. Each problem appears with polished, playful CSS animation. Every attempt goes into a local event log, and that log feeds two things:

1. **Analytics** on how fast and how accurately the learner answers each fact.
2. **A predictive learning-decay model** that picks the best next problem to ask.

Everything runs in the browser. There is no backend and no account, and no learner data ever leaves the device.

A working single-file prototype exists: `reference/prototype.html`. Use it as the reference for the spoken-number parser, the Web Speech and Whisper engines, and the visual identity (graph paper plus index-card flash card). Don't copy its structure. Rebuild everything properly with the stack below.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Build | **Vite** + **TypeScript** (strict) |
| UI | **React 18** with function components and hooks. No UI kit. |
| Styling | Plain CSS with custom properties: `tokens.css`, `motion.css`, and per-component CSS Modules |
| Animation | **CSS only**: keyframes, transitions, `@property`, `linear()` easing, View Transitions API. Use the Web Animations API (`el.animate`) only when JS needs a `finished` promise. **No animation libraries.** |
| Storage | **IndexedDB** via `idb`, plus `navigator.storage.persist()` |
| Speech, option 1 | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) |
| Speech, option 2 | **Transformers.js** (`@huggingface/transformers`, pin 3.8.x) running `onnx-community/whisper-base` in a **Web Worker**. Use WebGPU when `navigator.gpu.requestAdapter()` returns an adapter, otherwise WASM. |
| Voice activity detection | Start with an energy-based detector (as in the prototype). Phase 4 upgrades it to Silero VAD via `@ricky0123/vad-web`. |
| Charts | Hand-built SVG components using `d3-scale`, `d3-shape`, and `d3-array` only. No chart library. |
| Offline | `vite-plugin-pwa`: precache the app shell. Transformers.js caches model files itself in Cache Storage. |
| Tests | **Vitest** for logic, **Playwright** for one smoke test of the quiz loop with a fake speech engine |
| Lint/format | ESLint + Prettier |

The microphone requires a secure context, so dev must run on `localhost` and production on https. Deployment target: any static host (Netlify, GitHub Pages, Cloudflare Pages).

---

## 2. Project layout

```
src/
  main.tsx, App.tsx, routes.tsx
  styles/
    tokens.css          # color, type, spacing tokens; light + dark
    motion.css          # duration/easing tokens, shared keyframes, reduced-motion overrides
    base.css
  features/
    setup/              # learner picker, table chips, mode, engine choice
    quiz/
      QuizScreen.tsx
      FlashCard.tsx     # entrance/exit choreography
      Odometer.tsx      # rolling digits
      AnswerSlot.tsx    # interim/final answer display, stamp
      ThinkRing.tsx     # elapsed-time ring
      MicLevel.tsx      # live waveform bars
      ArrayModel.tsx    # dot-array explanation after a miss
      StreakMeter.tsx
      Burst.tsx         # CSS particle burst
    results/
    analytics/
      Dashboard.tsx
      FactHeatmap.tsx
      FactDetail.tsx    # per-fact drawer
      charts/           # TrendLine, RtHistogram, ForgettingCurve, Calibration
  speech/
    engine.ts           # SpeechEngine interface + events
    webSpeech.ts
    whisperEngine.ts
    whisper.worker.ts
    vad.ts
    resample.ts
    parseNumbers.ts     # + parseNumbers.test.ts
  learning/
    types.ts
    features.ts         # feature vector for a fact at time t
    priors.ts           # prior difficulty of each fact
    hlr.ts              # half-life regression model (predict + online update)
    shortTerm.ts        # within-session working-memory term
    latency.ts          # response-time model per learner/fact
    grading.ts          # (correct, latency) -> outcome grade
    scheduler.ts        # chooses next problem
    replay.ts           # rebuild all state from the event log
    simulate.ts         # synthetic learner for testing the scheduler
    evaluate.ts         # offline metrics: log loss, AUC, calibration
  data/
    db.ts, schema.ts, repo.ts, export.ts
reference/
  prototype.html
```

---

## 3. Screens

1. **Learners.** Local profiles (e.g. siblings), each with a name and an avatar color. No passwords. An optional 4-digit parent PIN gates the Analytics and Settings screens.
2. **Setup.** Choose the tables to include (chips 1–12, presets "2, 5, 10", "6–9", "All"), a session length (5 / 10 / 15 minutes or 20 / 40 problems), the answer method (Browser speech, Whisper on device, Typing), and toggles for reading questions aloud, sounds, and showing the think ring. A **Smart practice** mode (default) lets the scheduler choose. **Free practice** mode is uniform random over the chosen tables.
3. **Quiz.** The flash card, answer slot, mic status, streak meter, a progress strip, and the typing fallback, which is always available.
4. **Results.** Score, median response time, newly fluent facts, facts to revisit, and a 12×12 grid for this round.
5. **Analytics** (section 7).
6. **Settings.** Engine diagnostics (measured recognition latency, WebGPU vs WASM), the model download/cache size with a "Remove model" button, export/import, and erase.

Use the View Transitions API (`document.startViewTransition`) between screens, with a fallback to an instant swap.

---

## 4. Visual design and animation

**Identity:** keep the prototype's direction. The background is graph paper; the flash card is an index card (blue rules, red header line). Pencil blue is the accent and highlighter yellow marks the answer. Display type is Bricolage Grotesque; body type is Atkinson Hyperlegible, chosen for legibility for young readers. Support light and dark themes through tokens.

**Motion tokens** in `motion.css`:

```css
--dur-fast: 140ms; --dur-base: 280ms; --dur-slow: 520ms;
--ease-out: cubic-bezier(.2,.8,.2,1);
--ease-spring: linear(0, .26 9%, .76 22%, 1.05 33%, 1.1 40%, 1.04 52%, .99 66%, 1);
--ease-wobble: linear(0, -.3 15%, .3 30%, -.2 45%, .1 60%, 0);
```

**Animation inventory.** Each item below is a separate component or keyframe set. All of them should feel quick and delightful, never slow the learner down, and never block input.

1. **Deal-in.** The card slides from a small deck in the lower right. It rotates −8° → 0° and travels with `--ease-spring`, with a soft shadow that grows as it "lifts." Duration is about 450 ms.
2. **Odometer digits.** Each factor's digits roll into place: a vertical strip of 0–9 translates on Y, with digits staggered 40 ms apart. The × sign spins 90° → 0° and fades in between the factors.
3. **Legibility mark.** The problem is considered **legible** about 200 ms into the deal-in, once the digits have settled. `FlashCard` emits `onLegible(timestamp)` at that moment, and **response timing starts there**, not at render. With reduced motion, legible happens at the first paint.
4. **Think ring.** A ring around the answer slot fills via a `conic-gradient` driven by a registered `@property --elapsed` (0→1 over the fluency target, default 3 s). Its color moves from pencil blue to highlighter yellow at the target and stays there. The ring is low-key and can be turned off for anxious learners.
5. **Mic level.** Five bars whose heights follow a `--level` custom property, updated each animation frame from the audio RMS. While the mic is idle the bars "breathe."
6. **Interim answer.** Digits heard mid-utterance type into the slot with a blur(4px) → 0 and opacity 0.4 → 1 transition, so it's clear the app is still listening.
7. **Correct.** In sequence:
   - The slot "stamps": scale 1.35 → 1 on `--ease-spring`.
   - A highlighter swipe animates `background-size` from 0% to 100%.
   - A **CSS particle burst** fires: 12 small numerals and dots in pseudo-elements, each with its own `--angle`/`--dist` custom properties set inline, flying out and fading.
   - The card flicks off to the upper left onto a "done" pile.
   - The streak meter fills one notch. At streaks of 5, 10 and 20 there's a bigger celebration: a full-width confetti sweep plus a short chime.
8. **Miss (gentle, never shaming).**
   - The card wobbles (`--ease-wobble`, small amplitude).
   - The correct answer "writes itself" into the slot: an SVG text stroke animated with `stroke-dashoffset`, or a `clip-path: inset()` reveal as a fallback.
   - An **ArrayModel** fades in below: an `a × b` grid of dots that appears row by row (staggered 60 ms), with a count-up label such as "7 rows of 8 = 56." This is a teaching aid, not decoration.
   - The card then tucks back *into* the deck, which signals that the fact will come back soon.
9. **Progress strip.** One tick per problem, which fills green or coral as answers come in. The current tick pulses.
10. **Results grid.** The 12×12 cells flip in on a diagonal stagger, and the headline numbers count up.
11. **Ambient.** The graph paper shifts a few pixels with session progress, as a subtle parallax.

**Rules**
- Animate only `transform`, `opacity`, `filter`, `clip-path`, `background-position/size`, and registered custom properties. Never animate layout properties.
- All timings come from motion tokens, so the whole app can be sped up or slowed down in one place.
- `prefers-reduced-motion: reduce` replaces every movement with ≤150 ms crossfades and disables particles, wobble, and parallax.
- Feedback is always shown through shape and text as well as color (✓ / ✗ glyphs and words), so it works for color-blind learners.
- The next problem may start dealing in while the previous card exits. A correct answer advances in about 700 ms total; a miss takes about 2.5 s because of the array model. The learner can tap to skip ahead.

---

## 5. Speech layer

### Engine interface

```ts
type EngineEvent =
  | { type: 'state'; state: 'idle' | 'loading' | 'listening' | 'hearing' | 'thinking' | 'paused' | 'error'; detail?: string }
  | { type: 'level'; rms: number }                       // ~60 Hz
  | { type: 'onset'; at: number }                        // performance.now() when speech began
  | { type: 'transcript'; text: string; alts: string[]; final: boolean; at: number };

interface SpeechEngine {
  readonly kind: 'web-speech' | 'whisper' | 'typed';
  prepare(onProgress?: (pct: number) => void): Promise<void>;  // permissions, model load
  listenFresh(): void;     // start or clear for a new problem
  pause(): void;           // e.g. while TTS speaks or during feedback
  dispose(): void;
  on(cb: (e: EngineEvent) => void): () => void;
}
```

### Web Speech engine
- Use `continuous = true`, `interimResults = true`, `maxAlternatives = 3`, `lang = 'en-US'` (make the language configurable).
- `listenFresh()` aborts and restarts recognition so the transcript only covers the current problem. Ignore events from an aborted instance by guarding on an instance id, as the prototype does.
- Emit `onset` from `onspeechstart`, or from the first `onresult` if `onspeechstart` doesn't fire.
- If recognition ends while the engine is still wanted, restart it automatically, because Chrome stops after silence.
- Map errors: `not-allowed` → microphone blocked, `network` → suggest Whisper, `audio-capture` → no microphone.
- The UI must state that browser speech may send audio to the browser vendor's servers.

### Whisper engine
- Capture with `getUserMedia` (echo cancellation and noise suppression on) into an AudioWorklet. The worklet code ships as a separate file via Vite's `?url` import. Avoid ScriptProcessor in the real build.
- **VAD:** an adaptive noise floor, with an onset threshold of roughly 3.5× the noise floor (minimum 0.012 RMS), 300 ms pre-roll, end after 550 ms of silence, and a 5 s maximum utterance. Emit `onset` with the timestamp of the first speech frame, not the time it was detected.
- Resample to 16 kHz mono `Float32Array`, then post it to the worker as a transferable.
- **Worker:** load the model once. On WebGPU use `dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }`; on WASM use `q8`. Run a 1 s silent warm-up after loading. Report download progress aggregated across files.
- Call `{ language: 'english', task: 'transcribe' }`. Drop transcripts with no number in them (Whisper invents "Thank you." on noise).
- Tag each result with a generation id so late results from a previous problem are ignored.

### Text-to-speech
When "Read questions aloud" is on, pause the engine, speak "7 times 8" with `speechSynthesis`, and resume when it ends (with a 4 s safety timeout). In this mode, timing starts at the **end** of the utterance.

### `parseNumbers(text): number[]`
Port the prototype's parser and make it table-driven. Required behavior, as Vitest cases:

| Input | Output |
|---|---|
| `"56"`, `"Fifty-six."`, `"fifty six"` | `[56]` |
| `"seven times eight is fifty six"` | `[7, 8, 56]` |
| `"one hundred forty four"`, `"one forty four"` | `[144]` |
| `"a hundred and twenty"` | `[120]` |
| `"one hundred and eight"` | `[108]` |
| `"sixty for"` (homophone) | `[64]` |
| `"I think it's 42"` | `[42]` |
| `"81!"` | `[81]` |

Also export `mayContinue(text)`, which returns true when the last token is a tens word, "hundred", "and", or "one".

### Answer judging (`judge.ts`)
- **Correct** if the last number in the transcript, or in any alternative, equals the product.
- For an interim match where `mayContinue` is true, wait 600 ms for more speech before accepting it. Otherwise accept immediately. This stops "forty…" from being accepted when the learner is saying "forty-two."
- On a final transcript:
  - If the last two numbers are the problem's own factors (the learner read the question aloud), ignore them and keep listening.
  - Otherwise the last number is the learner's answer, and if it's wrong, the attempt is a miss.
- No number after a final transcript → show "Say just the number" and keep listening.
- **Only the first committed answer counts** for analytics. A self-correction after a miss is logged as `revision` but doesn't change correctness.

---

## 6. Data model (IndexedDB)

The **event log is the source of truth**. All model state is a cache that `replay.ts` can rebuild from scratch. This lets the model be changed or re-tuned later without losing history.

```ts
interface Learner { id: string; name: string; color: string; createdAt: number; settings: LearnerSettings; }

interface Session {
  id: string; learnerId: string; startedAt: number; endedAt?: number;
  mode: 'smart' | 'free' | 'retry'; tables: number[]; engine: EngineKind; device: string;
}

interface Attempt {
  id: string; learnerId: string; sessionId: string; seq: number;
  a: number; b: number;            // as displayed (order matters for display)
  fact: string;                    // unordered key, "7x8" (min first)
  shownAt: number;                 // epoch ms at legibility (or TTS end)
  onsetMs: number | null;          // speech/keystroke onset - shownAt
  commitMs: number;                // answer committed - shownAt
  engine: 'web-speech' | 'whisper' | 'typed';
  transcript: string;
  answer: number | null;           // null = skipped / timed out
  correct: boolean;
  revision?: number;               // later self-correction, if any
  ttsUsed: boolean;
  selectionReason: 'due' | 'new' | 'retry' | 'speed' | 'explore' | 'random';
  // model predictions made BEFORE the attempt; needed for calibration analytics
  pred: { pRecall: number; halfLifeH: number; rtMs: number; modelVersion: string };
}

interface FactState {               // cache, rebuildable
  learnerId: string; fact: string;
  nCorrect: number; nWrong: number; nFast: number;
  lastSeen: number; halfLifeH: number;
  rtLogMean: number; rtLogVar: number;   // per-fact latency model
  lastOutcome: Grade;
}

interface ModelParams { learnerId: string; theta: number[]; version: string; updatedAt: number; }
```

Stores: `learners`, `sessions`, `attempts` (indexes: `[learnerId+shownAt]`, `[learnerId+fact]`), `factState` (key `[learnerId+fact]`), `modelParams`.

**Response time** = `onsetMs` when available (it measures retrieval rather than recognition lag), otherwise `commitMs`. Store both. Latency baselines are kept **per engine**, because typing and speaking differ by more than a second.

---

## 7. Analytics (parent-facing; behind the optional PIN)

All analytics are computed from the attempt log in a Web Worker so the UI stays responsive. Per learner:

1. **Fact heatmap (12×12).** It has a toggle between four views:
   - **memory now:** predicted recall at this moment, from the model
   - **speed:** median response time over the last 5 attempts
   - **accuracy:** across all attempts
   - **due:** time until predicted recall drops below 80%

   Mirrored cells (7×8 and 8×7) share data. Tapping a cell opens Fact detail.
2. **Fact detail drawer.**
   - A scatter of every attempt (x = date, y = response time on a log scale; misses shown as ✗ in coral).
   - The model's **forgetting curve** from the last review, with "today" marked.
   - Current half-life, the next suggested review, and the most common wrong answers.
3. **Fluency over time.** A line chart of daily median response time, plus the count of **fluent facts** (predicted recall ≥ 0.9 *and* recent median response time ≤ the fluency target, default 3 s) out of the facts in scope.
4. **Retrieval vs. counting.** A response-time histogram on a log scale. A second hump around 4–8 s usually means the learner is counting up rather than recalling. Label both humps.
5. **By table.** A small bar chart of median response time and accuracy per table (×2 … ×12).
6. **Error analysis.** Classify each wrong answer as:
   - neighbor fact (e.g. 48 for 7×8, which is 6×8)
   - addition confusion (15 for 7×8)
   - digit swap (65 for 56)
   - off by a small amount
   - other

   Show the counts and the top confused facts.
7. **Forecast.** "If no practice: N facts will drop below 80% recall in the next 7 days," computed from the model. Show it as a small step chart.
8. **Model calibration (developer section, collapsed).** A reliability diagram of predicted vs. observed recall in deciles, plus log loss and AUC over the last 500 attempts. This shows whether the model is actually predictive.
9. **Sessions list.** Date, duration, number of problems, accuracy, median response time.
10. **Export/Import/Erase.** Export as JSON (everything) and CSV (attempts). Import merges by id. Erase asks for an inline confirm, since `confirm()` dialogs aren't used.

Charts: SVG with a single scale per chart, axis labels only at values the data reaches, colors from tokens, and readable in both themes.

---

## 8. Learning model

### 8.1 Items
An item is an **unordered fact** (`7x8` covers both 7×8 and 8×7), so there are 78 items for 1–12. Display order is randomized. Separately, keep a small per-orientation latency offset, since some learners are faster on one order.

### 8.2 Grading an attempt
`grading.ts` maps (correct, rt, learner's engine baseline) to one of four grades:

| Grade | Rule (defaults; configurable) | Observed recall used for training |
|---|---|---|
| `fail` | wrong, skipped, or no answer within 10 s | 0.0 |
| `slow` | correct, rt > 1.6 × fluency target (≈ counting) | 0.6 |
| `ok` | correct, rt between the target and 1.6 × target | 0.85 |
| `fast` | correct, rt ≤ fluency target | 1.0 |

The fluency target is 3 s for speech and 3.5 s for typing. After about 50 attempts, adjust it slightly to the learner's own speed: target = clamp(2 s, 4 s, learner's 40th-percentile response time × 1.5).

### 8.3 Long-term memory: half-life regression (HLR)
Based on Settles & Meeder (2016), *A Trainable Spaced Repetition Model for Language Learning*.

- Predicted recall after Δ hours since the last review: **p = 2^(−Δ / h)**
- Half-life: **h = 2^(θ · x)** hours, clipped to [0.25 h, 180 days]
- Feature vector **x** for a fact, at the moment of prediction:
  - `1` (bias)
  - `√(1 + nCorrect)`, `√(1 + nWrong)`, `√(1 + nFast)`
  - `√(1 + nCorrect on any fact sharing a factor)`, which captures transfer within a table
  - Prior difficulty features: `isSquare`, `hasFactor ∈ {1, 2, 5, 10, 11}` (each one-hot), `max(a,b)/12`, `log(product)`, `involves 6/7/8` (the classic hard zone)
  - `lastGrade` one-hot
- **Priors** (`priors.ts`): set the initial θ so a new learner starts with sensible half-lives. ×1, ×2, ×10 and ×5 start long (around 2 days), while 6×7, 7×8, 6×8, 8×8 and 7×7 start short (around 2 hours). Before the first attempt, a fact's recall is "unknown" with p = 0.5.
- **Online fitting:** after each attempt, take one SGD step on the HLR loss using the prediction made *before* the attempt:

  ```
  L = (p_obs − p̂)² + α · (h_obs − ĥ)² + λ‖θ − θ_prior‖²
  h_obs = −Δ / log2(clip(p_obs, 0.0001, 0.9999))
  ```

  Use α = 0.01, λ = 0.1, and learning rate 0.001 with decay. Regularize toward the prior, not toward zero, so a learner with little data keeps sensible behavior. Store θ per learner.
- `replay.ts` refits θ from scratch by streaming the whole log (several epochs). Run it after import or when `modelVersion` changes.

### 8.4 Short-term memory (within a session)
HLR is coarse at minute scales. A fact asked 30 seconds ago is "remembered" because it's still in working memory, not because it has been learned. Combine the two:

```
p_short = exp(−Δ_seconds / τ),  τ ≈ 90 s
p_now   = 1 − (1 − p_long)(1 − p_short)
```

The scheduler uses `p_now` for "will they get it right?" and `p_long` for "is it learned?"

### 8.5 Response-time model
Per learner and engine: log RT ~ Normal(μ_learner + β_fact, σ²). Update β_fact (an exponentially weighted mean of residuals, half-weight after 5 attempts) and μ_learner after each attempt. This gives a predicted response time for every fact. The speed heatmap and the "speed" selection reason both use it.

### 8.6 Scheduler: choosing the next problem
Score each candidate fact (facts in the chosen tables, excluding the last 3 shown) and pick using a softmax with temperature 0.15, so the order isn't predictable.

1. **Retry queue.** A missed fact comes back after 2, then 5, then 10 intervening problems (expanding retrieval) and leaves the queue after two fast or ok answers. If a retry is due, ask it (`reason: 'retry'`).
2. **Success-rate controller.** Keep the rolling accuracy over the last 10 problems near **85%**. Set the target recall to p* = 0.80 + 0.5 × (0.85 − rollingAcc), clamped to [0.65, 0.92]. If the learner is struggling, the target rises (easier problems); if they're cruising, it drops.
3. **Utility of each candidate:**

   ```
   U = −|p_now − p*|                         # appropriately challenging
       + w_gain · (1 − p_long) · p_now       # expected learning gain: weak in long-term but likely to succeed now
       + w_speed · slowness                  # correct-but-slow facts get speed reps (slowness = z-score of predicted RT, clipped ≥ 0)
       − w_recent · p_short                  # don't re-ask what's still in working memory
   ```

   Defaults: w_gain = 0.6, w_speed = 0.3, w_recent = 0.8.
4. **New facts.** Introduce at most 1 new fact per 5 problems, and only while rolling accuracy is ≥ 80%. Introduce facts in ascending prior difficulty.
5. **Exploration.** With 5% probability, pick uniformly at random (`reason: 'explore'`) to keep the model's estimates honest.

Log the prediction (`p_now`, `h`, predicted RT) and the reason with every attempt.

### 8.7 Model interface (so it can be swapped)
```ts
interface MemoryModel {
  version: string;
  predict(fact: string, now: number, state: FactState, params: ModelParams): { pLong: number; pNow: number; halfLifeH: number };
  update(attempt: Attempt, grade: Grade, state: FactState, params: ModelParams): { state: FactState; params: ModelParams };
}
```
An FSRS-based model (`ts-fsrs`, with grades mapped Again / Hard / Good / Easy from `fail` / `slow` / `ok` / `fast`) is a reasonable alternative to try against HLR using `evaluate.ts`.

### 8.8 Validation
- **`simulate.ts`:** a synthetic learner with hidden true half-lives (log-normal around the priors), a latency distribution that shrinks as strength grows, and forgetting between "days." Run 30 simulated days at 10 min/day for each of three policies: smart scheduler, uniform random, and round-robin. **Acceptance criterion:** the smart scheduler reaches 90% fluent facts in fewer simulated days than random, and the simulated success rate stays between 75% and 92%.
- **`evaluate.ts`:** a time-ordered replay of a real or simulated log that reports log loss, AUC, and calibration deciles for HLR vs. a baseline (per-fact running accuracy). This feeds the calibration panel in Analytics.

---

## 9. Privacy and robustness
- No network requests except the one-time model download from Hugging Face (and fonts, unless they're self-hosted, which is preferred). Add a CSP meta tag that restricts `connect-src` to `self` plus `huggingface.co` and `*.hf.co` (the model CDN).
- Call `navigator.storage.persist()` on first run, and show in Settings whether storage is persistent.
- All IndexedDB writes are transactional. If storage fails, the quiz keeps working in memory and a banner says progress won't be saved.
- Microphone permission denied → typing mode with an explanation. No microphone → same. Whisper load failure → offer Browser speech or Typing.
- Request a screen wake lock during a session and tolerate rejection.
- Fully usable by keyboard. `aria-live` announces the problem and the feedback.

---

## 10. Milestones

Each phase ends with passing tests and a working app.

1. **Skeleton.** Vite + React + TypeScript, routing, tokens/themes, learner profiles, IndexedDB schema, typing-only quiz loop with uniform random selection, attempt logging. *Done when:* a typed session logs correct `Attempt` rows.
2. **Speech.** Engine interface, Web Speech engine, parser + judge (with all tests from §5), TTS. Then the Whisper worker with energy VAD, download progress, and the WebGPU/WASM switch. *Done when:* both engines complete a 20-problem session; onset timing is logged.
3. **Animation pass.** Everything in §4, the motion tokens, the reduced-motion variants, and View Transitions. *Done when:* a correct answer is handled in ≤ 750 ms including animation; legibility timing is wired to `onLegible`; reduced motion has no movement.
4. **Learning model.** Grading, HLR with priors and online updates, short-term term, RT model, scheduler, replay, simulator, and evaluation harness. Upgrade VAD to Silero. *Done when:* the simulation criterion in §8.8 passes in CI, and predictions are logged on every attempt.
5. **Analytics.** All panels in §7, the analytics worker, export/import/erase, and the PIN gate. *Done when:* a seeded 30-day simulated log renders every panel correctly in both themes at 380 px width.
6. **PWA and polish.** Offline shell, install prompt, Settings diagnostics, and a Lighthouse PWA/accessibility score ≥ 95.

Seed data for development comes from `simulate.ts`, exposed as a dev-only "Load demo learner" button. It must never appear in production builds.

---

## 11. Non-goals (for now)
Accounts, cloud sync, teacher dashboards, division/addition modes, and multi-language speech. Keep the structure open to add other operations later: items are `{ operands, op }` and the parser is language-keyed.
