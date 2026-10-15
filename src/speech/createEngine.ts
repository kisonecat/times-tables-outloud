import type { EngineKind } from '../data/schema';
import type { SpeechEngine } from './engine';
import { WebSpeechEngine } from './webSpeech';
import { WhisperEngine } from './whisperEngine';

/** A speech engine for `kind`, or null for typing. */
export async function createEngine(kind: EngineKind, lang: string): Promise<SpeechEngine | null> {
  if (kind === 'typed') return null;
  if (import.meta.env.DEV && window.__ttFakeSpeech) {
    const { FakeEngine } = await import('./fakeEngine');
    return new FakeEngine(kind); // registers itself on window in prepare()
  }
  if (kind === 'web-speech') return new WebSpeechEngine(lang);
  // Dev/test hook to compare streaming on and off.
  const streaming = import.meta.env.DEV ? window.__ttWhisperStreaming : undefined;
  return new WhisperEngine({ streaming });
}
