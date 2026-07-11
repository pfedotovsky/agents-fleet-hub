/**
 * Categorical host-identity palette, validated for the dark surface #09090b
 * (OKLCH L 0.48–0.67, worst adjacent CVD ΔE 23.4, ≥3:1 contrast).
 * Assigned by host index in fixed order — never re-sorted or cycled per render.
 */
export const HOST_COLORS = [
  '#059669', // emerald
  '#8b5cf6', // violet
  '#d97706', // amber
  '#0284c7', // sky
  '#f43f5e', // rose
  '#65a30d', // lime
  '#d946ef', // fuchsia
  '#0891b2', // cyan
]

export function hostColor(index: number): string {
  return HOST_COLORS[index % HOST_COLORS.length]
}

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const seconds = Math.max(0, Math.floor((now - t) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(t).toLocaleDateString()
}
