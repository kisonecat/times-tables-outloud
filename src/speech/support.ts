/** Browser capability checks for each way of answering. */

type RecognitionCtor = new () => SpeechRecognition;

export function speechRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canUseWebSpeech(): boolean {
  return speechRecognitionCtor() !== null;
}

export function canUseMic(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

export function canUseWhisper(): boolean {
  return (
    canUseMic() &&
    typeof Worker !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  );
}

export function canSpeak(): boolean {
  return 'speechSynthesis' in window;
}
