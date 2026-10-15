import { WhisperClient } from '../speech/whisperClient';
import type { LoadOptions } from '../speech/whisperProtocol';

/**
 * Development only: time Whisper on real clips with a given device/model/precision.
 * Clips are padded like the VAD pads an utterance (300 ms before, 550 ms after).
 * From the console: await __ttBenchWhisper({ clips: ['/.cache/clips/56.wav'], options: { device: 'webgpu' } })
 */
export async function benchWhisper({
  clips,
  options = {},
  runs = 3,
}: {
  clips: string[];
  options?: LoadOptions;
  runs?: number;
}) {
  const client = new WhisperClient();
  const t0 = performance.now();
  await client.load(undefined, options);
  const loadMs = Math.round(performance.now() - t0);
  const perClip: { clip: string; text: string; ms: number[] }[] = [];
  for (const clip of clips) {
    const audio = await decode16k(clip);
    const ms: number[] = [];
    let text = '';
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      text = (await client.transcribe(audio.slice())).text;
      ms.push(Math.round(performance.now() - t));
    }
    perClip.push({ clip, text, ms });
  }
  const result = { device: client.device, adapter: client.adapter, loadMs, perClip };
  client.terminate();
  return result;
}

async function decode16k(url: string): Promise<Float32Array> {
  const data = await (await fetch(url)).arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(data);
  const speech = decoded.getChannelData(0);
  const out = new Float32Array(Math.round(0.3 * 16000) + speech.length + Math.round(0.55 * 16000));
  out.set(speech, Math.round(0.3 * 16000));
  return out;
}

declare global {
  interface Window {
    __ttBenchWhisper?: typeof benchWhisper;
  }
}
