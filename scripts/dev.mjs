import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverDir = join(workspaceRoot, 'fleet-server')
const hubDir = join(workspaceRoot, 'fleet-hub')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const hubPort = process.env.FLEET_HUB_PORT || '5173'
const children = new Map()
let shuttingDown = false
let requestedExitCode = 0

function ensureDependencies(name, directory, command, args) {
  if (existsSync(join(directory, 'node_modules'))) return

  console.log(`[dev] Installing ${name} dependencies...`)
  const result = spawnSync(command, args, { cwd: directory, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall through when the process group has already exited.
    }
  }
  child.kill(signal)
}

function stopAll(signal = 'SIGTERM') {
  for (const child of children.values()) terminate(child, signal)
}

function beginShutdown(exitCode, reason) {
  if (shuttingDown) return
  shuttingDown = true
  requestedExitCode = exitCode
  if (reason) console.error(`[dev] ${reason}`)
  stopAll(exitCode === 0 ? 'SIGINT' : 'SIGTERM')
}

function start(name, command, args, cwd, env = process.env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  children.set(name, child)

  child.on('error', (error) => {
    beginShutdown(1, `${name} failed to start: ${error.message}`)
  })
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (!shuttingDown) {
      const result = signal ? `signal ${signal}` : `exit code ${code ?? 1}`
      beginShutdown(code ?? 1, `${name} stopped unexpectedly (${result}).`)
    }
    if (children.size === 0) process.exitCode = requestedExitCode
  })

  return child
}

async function waitForSourceServer(server) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && !shuttingDown) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('source fleet-server exited before becoming ready')
    }
    try {
      const response = await fetch('http://localhost:3012/health', {
        signal: AbortSignal.timeout(750),
      })
      const health = await response.json()
      if (response.ok && health.status === 'ok') return
    } catch {
      // Startup includes database migration and initial route setup; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('source fleet-server did not become ready on port 3012 within 20 seconds')
}

process.on('SIGINT', () => beginShutdown(0))
process.on('SIGTERM', () => beginShutdown(0))

ensureDependencies('fleet-server', serverDir, 'bun', ['install', '--frozen-lockfile'])
ensureDependencies('Agents Hub', hubDir, npmCommand, ['install'])

console.log('[dev] Released/Homebrew: http://localhost:3011/fleet-hub/')
console.log('[dev] Starting source fleet-server: http://localhost:3012')
const server = start('fleet-server', 'bun', ['run', 'dev'], serverDir, {
  ...process.env,
  // Vite discovery deliberately targets 3012, so the combined command must
  // not inherit a conflicting SERVER_PORT from the caller's shell.
  SERVER_PORT: '3012',
})

try {
  await waitForSourceServer(server)
  if (!shuttingDown) {
    console.log(`[dev] Starting Vite UI: http://localhost:${hubPort}`)
    start('Agents Hub', npmCommand, ['run', 'dev', '--', '--port', hubPort], hubDir)
  }
} catch (error) {
  beginShutdown(1, error instanceof Error ? error.message : String(error))
}
