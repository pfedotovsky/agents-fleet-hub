import { loadPrefs } from './storage'

let audioCtx: AudioContext | null = null

/** Short two-note chime via WebAudio — no asset files in a static SPA. */
function chime(freqs: number[]) {
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = ctx.currentTime + i * 0.13
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.4)
    })
  } catch {
    // No audio device / blocked autoplay — the desktop notification still fires.
  }
}

/** Call from a user gesture (e.g. sending a message) — browsers ignore it otherwise. */
export function requestNotifyPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

/**
 * Chime + (when the tab is hidden) a desktop notification. Gated by the
 * `soundAlerts` pref. `tag` collapses repeat alerts for the same session.
 */
export function notify(kind: 'done' | 'permission', title: string, body: string, tag: string): void {
  if (!loadPrefs().soundAlerts) return
  chime(kind === 'done' ? [880, 587] : [587, 880])
  if (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.visibilityState !== 'visible'
  ) {
    try {
      new Notification(title, { body, tag })
    } catch {
      // Some browsers throw on construction (e.g. Android) — chime already played.
    }
  }
}
