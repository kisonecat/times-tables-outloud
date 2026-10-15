import { canSpeak } from './support';

const SAFETY_TIMEOUT_MS = 4000;

/** Speak `text`; resolves when done, on error, or after 4 s, whichever is first. */
export function speak(text: string, lang = 'en-US'): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak()) return resolve();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.lang = lang;
    u.onend = end;
    u.onerror = end;
    const timer = setTimeout(end, SAFETY_TIMEOUT_MS);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}
