import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/tokens.css';
import './styles/motion.css';
import './styles/base.css';
import { App } from './App';
import { openRepo } from './data/repo';
import { requestPersistentStorage } from './lib/platform';
import { applyTheme, type Theme } from './lib/theme';

const repo = await openRepo();
void requestPersistentStorage();

applyTheme((await repo.getMeta<Theme>('theme').catch(() => undefined)) ?? 'system');

if (import.meta.env.DEV) {
  window.__ttBenchWhisper = (o) => import('./dev/whisperBench').then((m) => m.benchWhisper(o));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repo={repo} />
  </StrictMode>,
);
