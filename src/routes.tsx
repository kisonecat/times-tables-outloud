import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type Route =
  | { name: 'learners' }
  | { name: 'setup' }
  | { name: 'quiz' }
  | { name: 'results'; sessionId: string }
  | { name: 'analytics' }
  | { name: 'settings' };

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'learners':
      return '#/';
    case 'results':
      return `#/results/${encodeURIComponent(route.sessionId)}`;
    default:
      return `#/${route.name}`;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'setup':
    case 'quiz':
    case 'analytics':
    case 'settings':
      return { name: parts[0] };
    case 'results':
      return parts[1]
        ? { name: 'results', sessionId: decodeURIComponent(parts[1]) }
        : { name: 'learners' };
    default:
      return { name: 'learners' };
  }
}

/**
 * Hash router whose screen swaps run inside a View Transition when the browser
 * supports it, falling back to an instant swap.
 */
export function useHashRoute(): [Route, (to: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState(() => parseHash(location.hash));

  useEffect(() => {
    const onHash = () => {
      const next = parseHash(location.hash);
      withViewTransition(() => setRoute(next));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (to: Route, opts?: { replace?: boolean }) => {
    const hash = routeToHash(to);
    if (hash === location.hash) return;
    if (opts?.replace) {
      history.replaceState(null, '', hash);
      withViewTransition(() => setRoute(to));
    } else {
      location.hash = hash; // triggers hashchange
    }
  };

  return [route, navigate];
}

function withViewTransition(update: () => void) {
  if (!document.startViewTransition) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
