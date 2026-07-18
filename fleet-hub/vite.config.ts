import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKLOG_PATH = resolve(__dirname, '../docs/backlog.md')

/**
 * Append a quick-add item to an `## Inbox` section (created just below the
 * `# Backlog` title if missing, so it sits above Priorities). Newest items go
 * to the top of the section for later triage into P1/P2. Newlines in the item
 * are collapsed so one item stays one bullet.
 */
function insertIntoInbox(md: string, item: string): string {
  const bullet = `- [ ] ${item.replace(/\s+/g, ' ').trim()}`
  if (/^## Inbox\b/m.test(md)) {
    return md.replace(/^(## Inbox[^\n]*\n\n?)/m, (heading) => `${heading}${bullet}\n`)
  }
  const block = `## Inbox\n\n${bullet}\n\n`
  // Place the new section before the first existing `## ` section (Priorities).
  if (/^## /m.test(md)) return md.replace(/^## /m, `${block}## `)
  return `${md.trimEnd()}\n\n${block}`
}

// Dev-only endpoint backing the developer Backlog view. GET returns the
// repo-root docs/backlog.md; POST { item } appends it to the Inbox on disk.
// `apply: 'serve'` + configureServer means this middleware exists ONLY under
// `npm run dev` — it is never part of a `vite build`, so neither the endpoint
// nor the backlog text ships in dist/ or the fleet-server release binary. The
// view that uses it is separately gated behind import.meta.env.DEV.
function backlogDevServer(): Plugin {
  return {
    name: 'backlog-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__backlog', async (req, res) => {
        try {
          if (req.method === 'POST') {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const item = String((JSON.parse(raw || '{}') as { item?: unknown }).item ?? '').trim()
            if (!item) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'empty item' }))
              return
            }
            const next = insertIntoInbox(await readFile(BACKLOG_PATH, 'utf8'), item)
            await writeFile(BACKLOG_PATH, next)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }
          const md = await readFile(BACKLOG_PATH, 'utf8')
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.end(md)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so one build serves both the Tauri desktop shell
  // (loaded from tauri://localhost/) and fleet-server hosting the UI under the
  // /fleet-hub/ sub-path. Absolute "/assets/..." would 404 under a sub-path.
  base: './',
  plugins: [react(), tailwindcss(), backlogDevServer()],
})
