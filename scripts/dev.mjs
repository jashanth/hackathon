// Starts the API and Vite together, so `npm run dev` gives a working site from a fresh clone.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${process.versions.node} is too old. The server needs Node 22.13 or newer for its built-in SQLite. Please upgrade from https://nodejs.org`)
  process.exit(1)
}

if (!existsSync(new URL('../node_modules/vite/bin/vite.js', import.meta.url))) {
  console.error('Dependencies are not installed. Run: npm install')
  process.exit(1)
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function isOurApi(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/session`, { signal: AbortSignal.timeout(1500) })
    return res.status === 200
  } catch {
    return false
  }
}

const explicitPort = process.env.PORT
let apiPort = explicitPort ? Number(explicitPort) : 3001
let existing = false

if (await isOurApi(apiPort)) {
  existing = true
} else if (await checkPortAvailable(apiPort)) {
  existing = false
} else {
  // apiPort is in use by something other than this site's current API
  if (explicitPort) {
    console.error(`Port ${apiPort} is in use by something other than this site's current API. Stop that process, then run npm run dev again.`)
    process.exit(1)
  }

  // If default port was busy, look for another free port or an existing instance
  let found = false
  for (let candidate = 3002; candidate <= 3020; candidate++) {
    if (await isOurApi(candidate)) {
      apiPort = candidate
      existing = true
      found = true
      break
    }
    if (await checkPortAvailable(candidate)) {
      apiPort = candidate
      existing = false
      found = true
      break
    }
  }

  if (!found) {
    console.error(`Port 3001 is in use by something other than this site's current API, and no alternative ports (3002-3020) are free. Stop conflicting processes, then run npm run dev again.`)
    process.exit(1)
  }

  console.log(`Port 3001 is in use by another process. Using port ${apiPort} for the API server.`)
}

process.env.PORT = String(apiPort)

const children = []
const stopAll = (code) => {
  for (const child of children) child.kill()
  process.exit(code)
}
const start = (name, args, required) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(apiPort) } })
  child.on('exit', (code) => {
    if (!required) return
    console.error(`The ${name} stopped${code ? ` with exit code ${code}` : ''}.`)
    stopAll(code ?? 0)
  })
  children.push(child)
}

if (existing) console.log(`Using the API already running on port ${apiPort}. If you changed server code or .env, stop that terminal and run npm run dev again.`)
else start('API server', ['--env-file-if-exists=.env', 'server/server.mjs'], true)
start('Vite dev server', ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], true)

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
