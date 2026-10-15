import type { EngineError } from './engine';

/** What to tell the learner (or parent) when an engine fails. Always ends in a way forward. */
export const ENGINE_ERROR_MESSAGES: Record<EngineError, string> = {
  'mic-blocked':
    'Microphone access is blocked. Allow the microphone for this page (look for the icon in the address bar), or keep going by typing.',
  'no-mic': 'No microphone was found. You can keep going by typing.',
  network:
    'The browser’s speech service can’t be reached. Try “Whisper on this device” in setup, or keep going by typing.',
  unsupported: 'This browser can’t do speech recognition. You can keep going by typing.',
  'model-failed':
    'The on-device speech model couldn’t load. Check your connection and try again, or pick another way to answer.',
  unknown: 'Speech recognition stopped working. You can keep going by typing.',
};
