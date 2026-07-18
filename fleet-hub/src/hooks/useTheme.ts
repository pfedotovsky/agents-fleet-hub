import { useCallback, useEffect, useState } from 'react'
import { applyTheme, loadTheme, saveTheme, watchSystemTheme, type Theme } from '../lib/theme'

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
