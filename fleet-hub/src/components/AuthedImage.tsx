import { useEffect, useState } from 'react'
import { ImageOff, LoaderCircle } from 'lucide-react'
import { getToken, saveToken } from '../lib/storage'

/**
 * Object-URL cache for stored chat images, keyed `baseUrl|filename`. Entries
 * live for the tab's lifetime — attachments are few and small, and keeping
 * them avoids re-downloading on every transcript re-render. The composer
 * seeds just-uploaded images here so the optimistic bubble renders instantly.
 */
const urlCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string>>()

function cacheKey(baseUrl: string, path: string): string {
  return `${baseUrl}|${path.split('/').pop() ?? path}`
}

export function seedImageCache(baseUrl: string, path: string, objectUrl: string): void {
  urlCache.set(cacheKey(baseUrl, path), objectUrl)
}

/**
 * The assets route requires the Bearer header, which a plain <img src> cannot
 * send — so images are fetched as blobs and shown through object URLs.
 */
async function loadImage(baseUrl: string, hostId: string, path: string): Promise<string> {
  const key = cacheKey(baseUrl, path)
  const cached = urlCache.get(key)
  if (cached) return cached
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = (async () => {
    const token = getToken(hostId)
    if (!token) throw new Error('Not signed in')
    const filename = path.split('/').pop() ?? path
    const res = await fetch(`${baseUrl}/api/assets/images/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const refreshed = res.headers.get('X-Refreshed-Token')
    if (refreshed) saveToken(hostId, refreshed)
    if (!res.ok) throw new Error(`Image unavailable (${res.status})`)
    const url = URL.createObjectURL(await res.blob())
    urlCache.set(key, url)
    return url
  })()
  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

export function AuthedImage({
  baseUrl,
  hostId,
  path,
  name,
}: {
  baseUrl: string
  hostId: string
  path: string
  name?: string
}) {
  const [src, setSrc] = useState<string | undefined>(() => urlCache.get(cacheKey(baseUrl, path)))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (src) return
    let cancelled = false
    loadImage(baseUrl, hostId, path)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, hostId, path, src])

  if (failed) {
    return (
      <span
        title={path}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-800 bg-ink-900 px-2 py-1.5 text-[11px] text-ink-500"
      >
        <ImageOff size={12} /> {name ?? path.split('/').pop()}
      </span>
    )
  }
  if (!src) {
    return (
      <span className="flex h-24 w-32 items-center justify-center rounded-md border border-ink-800 bg-ink-900">
        <LoaderCircle size={14} className="animate-spin text-ink-600" />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={name ?? 'attached image'}
      title={name}
      onClick={() => window.open(src, '_blank')}
      className="max-h-64 max-w-full cursor-zoom-in rounded-md border border-ink-800 object-contain"
    />
  )
}
