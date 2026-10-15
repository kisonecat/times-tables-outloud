export type Theme = 'system' | 'light' | 'dark';

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? 'system';
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
