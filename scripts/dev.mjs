// Starts the API and Vite together, so `npm run dev` gives a working site from a fresh clone.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const apiPort = process.env.PORT || '3001'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${process.versions.node} is too old. The server needs Node 22.13 or newer for its built-in SQLite. Please upgrade from https://nodejs.org`)
  process.exit(1)
}

if (!existsSync(new URL('../node_modules/vite/bin/vite.js', import.meta.url))) {
  console.error('Dependencies are not installed. Run: npm install')
  process.exit(1)
}

// An API from another terminal can be reused, but only if it is this version.
const existing = await fetch(`http://localhost:${apiPort}/api/admin/session`).then((response) => response.status, () => 0)
if (existing && existing !== 200) {
  console.error(`Port ${apiPort} is in use by something other than this site's current API. Stop that process, then run npm run dev again.`)
  process.exit(1)
}

const children = []
const stopAll = (code) => {
  for (const child of children) child.kill()
  process.exit(code)
}
const start = (name, args, required) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: apiPort } })
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
