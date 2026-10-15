# Times Tables Out Loud

Practice multiplication facts (1×1 to 12×12) by **saying the answers out loud**. Speech is
recognized in the browser, every attempt goes into a local log, and a learning model picks
the next problem. No accounts, no backend: nothing a learner practices leaves the device.

**Live:** https://kisonecat.github.io/times-tables-outloud/

- **Answer by voice or keyboard.** Browser speech (Web Speech API), or Whisper running
  on the device (Transformers.js in a Web Worker, WebGPU when available, Silero VAD), or
  typing.
- **Smart practice.** Half-life regression with a working-memory term, a response-time
  model, and a scheduler with a retry queue and a success-rate controller
  (see `src/learning/`). A simulated learner checks that it beats random practice.
- **Gentle feedback.** A dot-array explanation after a miss; reduced-motion support
  throughout.

The design and roadmap are in [PLAN.md](PLAN.md).

## Whisper speed

Whisper takes about 2.4 s per answer on the CPU and about 0.35 s on a GPU via WebGPU, where
answers are also transcribed as soon as the learner pauses. In Chrome on Linux, WebGPU
needs `chrome://flags/#enable-vulkan`; it's on by default on Windows, macOS and ChromeOS.

## Development

```sh
npm install
npm run dev          # http://localhost:5173 (the microphone needs localhost or https)
npm test             # unit tests, including the scheduler simulation
npm run test:e2e     # Playwright, with a fake speech engine
npm run build
```

In development the learner screen has a **Load demo learner** button (30 days of simulated
history), and the console has `__ttBenchWhisper(...)` for timing Whisper.

The end-to-end Whisper test is opt-in, since it downloads the model; it plays spoken
clips into a stand-in microphone:

```sh
./e2e/make-clips.sh                      # needs piper (NixOS: nix shell nixpkgs#piper-tts)
E2E_WHISPER=1 npx playwright test whisper
E2E_WHISPER=1 E2E_GPU=1 npx playwright test whisper   # headed, on the real GPU
```

Playwright's own browsers don't run on every Linux; set `CHROMIUM_PATH` to a system
Chromium if needed.

## Deployment

Every push to `main` runs the tests and deploys `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`).

## License

Copyright © 2026 Jim Fowler.

Times Tables Out Loud is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version. See
[LICENSE](LICENSE).

Because it's the Affero GPL, if you run a modified version for others to use over a
network, you must offer them its source code. The app links to its source in Settings.
