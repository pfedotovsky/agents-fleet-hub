/**
 * Theme handling. `Theme` is the user's stored choice; `system` follows the OS
 * `prefers-color-scheme`. The resolved dark/light is written to
 * `document.documentElement[data-theme]`, which drives the CSS token overrides
 * in index.css. Kept out of storage.ts so the FOUC-guard inline script in
 * index.html can inline the same read without pulling in the bundle.
 */
export type Theme = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const THEME_KEY = 'fleethub.v1.theme'

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* private-mode / storage-disabled — theme just won't persist */
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

/** Applies the resolved theme to the document root. Returns what it resolved to. */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  return resolved
}

/**
 * Keeps a `system` choice live when the OS flips appearance. No-ops for an
 * explicit dark/light pick. Returns a cleanup that removes the listener.
 */
export function watchSystemTheme(theme: Theme, onChange: (resolved: ResolvedTheme) => void): () => void {
  if (theme !== 'system' || typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => onChange(applyTheme('system'))
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}
