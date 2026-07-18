import { useCallback, useEffect, useState } from 'react'
import {
  applyTheme,
  loadTheme,
  saveTheme,
  watchSystemTheme,
  type ResolvedTheme,
  type Theme,
} from '../lib/theme'

/**
 * Single source of truth for the active theme. The FOUC-guard script in
 * index.html has already set data-theme before React mounts; this re-applies on
 * every change, persists the choice, and keeps a `system` pick live when the OS
 * appearance flips.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => loadTheme())

  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(theme, () => {})
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    saveTheme(next)
    setThemeState(next)
  }, [])

  return [theme, setTheme]
}

/**
 * The currently-applied dark/light value, for components that can't express a
 * color as a token and need the concrete theme (syntax highlighters, the code
 * editor). Reads `<html data-theme>` and re-renders when it flips, so it works
 * anywhere without a context provider.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => {
      setResolved(el.dataset.theme === 'light' ? 'light' : 'dark')
    })
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return resolved
}
