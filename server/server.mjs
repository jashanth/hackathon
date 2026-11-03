import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3001)
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')
const maxBodyBytes = 64 * 1024
const cookieName = 'registration_resume'
const cookieTtlSeconds = 60 * 60 * 24 * 30

function rulesFromEnvironment() {
  const number = (name) => {
    const value = process.env[name]
    if (value === undefined || !/^[1-9]\d*$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  const minTeamSize = number('REGISTRATION_MIN_TEAM_SIZE')
  const maxTeamSize = number('REGISTRATION_MAX_TEAM_SIZE')
  return { minTeamSize, maxTeamSize, submissionEnabled: process.env.SUBMISSION_ENABLED === 'true' && minTeamSize !== null && maxTeamSize !== null && minTeamSize <= maxTeamSize }
}

function hashToken(token) { return createHash('sha256').update(token).digest('hex') }
function json(res, status, value, extra = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(body)
}
function error(res, status, message) { json(res, status, { error: message }) }
function parseCookies(value = '') {
  return Object.fromEntries(value.split(';').map((part) => part.trim().split('=')) .filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]))
}
function cookieHeader(token, secure) {
  return `${cookieName}=${encodeURIComponent(token)}; Max-Age=${cookieTtlSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}
function publicDraft(row) {
  return row && { data: JSON.parse(row.data), step: row.step, status: row.status, receipt: row.receipt, revision: row.revision }
}

function validateDraftShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be an object'
  const fields = ['teamName', 'teamSize', 'college', 'leadName', 'email', 'phone']
  if (fields.some((field) => typeof data[field] !== 'string' || data[field].length > 200)) return 'all team fields must be short strings'
  if (!Array.isArray(data.members)) return 'members must be an array'
  for (const member of data.members) {
    if (!member || typeof member !== 'object' || Array.isArray(member) || ['name', 'email', 'college'].some((field) => typeof member[field] !== 'string' || member[field].length > 200)) return 'member details are invalid'
  }
  return null
}

function validateData(data, rules) {
  const shapeProblem = validateDraftShape(data)
  if (shapeProblem) return shapeProblem
  const fields = ['teamName', 'college', 'leadName', 'email', 'phone']
  if (fields.some((field) => data[field].trim().length === 0)) return 'all team fields are required'
  if (!/^\S+@\S+\.\S+$/.test(data.email) || data.email.length > 254) return 'email is invalid'
  if (!/^\d+$/.test(data.teamSize)) return 'teamSize must be a numeric string'
  const teamSize = Number(data.teamSize)
  if (!/^\+?[1-9]\d{7,14}$/.test(data.phone)) return 'phone is invalid'
  if (data.members.length + 1 !== teamSize) return 'teamSize must match the lead and members'
  if (rules.minTeamSize !== null && teamSize < rules.minTeamSize) return 'team size is below the minimum'
  if (rules.maxTeamSize !== null && teamSize > rules.maxTeamSize) return 'team size exceeds the maximum'
  const emails = new Set([data.email.trim().toLowerCase()])
  for (const member of data.members) {
    if (['name', 'email', 'college'].some((field) => member[field].trim() === '')) return 'member details are required'
    if (!/^\S+@\S+\.\S+$/.test(member.email) || member.email.length > 254) return 'member email is invalid'
    const email = member.email.trim().toLowerCase()
    if (emails.has(email)) return 'member and lead emails must be unique'
    emails.add(email)
  }
  return null
}

export function createApp({ dbPath = databasePath } = {}) {
  mkdirSync(resolve(dbPath, '..'), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, data TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, revision INTEGER NOT NULL);`)
  const rules = rulesFromEnvironment()
  const secure = process.env.NODE_ENV === 'production'

  function sessionFor(req, res) {
    const token = parseCookies(req.headers.cookie)[cookieName]
    const now = Date.now()
    let row = token && db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), now)
    if (!row) {
      const newToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(newToken)
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, now, now + cookieTtlSeconds * 1000)
      db.prepare('INSERT INTO drafts VALUES (?, ?, 0, \'draft\', NULL, 0)').run(tokenHash, JSON.stringify({ teamName: '', teamSize: '', college: '', leadName: '', email: '', phone: '', members: [] }))
      res.setHeader('Set-Cookie', cookieHeader(newToken, secure))
      row = { token_hash: tokenHash }
    }
    return row.token_hash
  }

  function existingSession(req) {
    const token = parseCookies(req.headers.cookie)[cookieName]
    if (!token) return null
    const row = db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now())
    return row?.token_hash || null
  }

  function sameOrigin(req) {
    const origin = req.headers.origin
    if (!origin) return false
    const host = req.headers.host
    const protocol = secure ? 'https' : 'http'
    return origin === `${protocol}://${host}`
  }

  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new Error('JSON body required')
    let size = 0; const chunks = []
    for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) throw new Error('request body too large'); chunks.push(chunk) }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid JSON') }
  }

  const app = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && !sameOrigin(req)) return error(res, 403, 'same-origin request required')
        if (!['GET', 'PUT', 'POST'].includes(req.method)) return error(res, 405, 'method not allowed')
        if (url.pathname !== '/api/registration' && url.pathname !== '/api/registration/submit') return error(res, 404, 'not found')
        const tokenHash = req.method === 'GET' ? sessionFor(req, res) : existingSession(req)
        if (!tokenHash) return error(res, 401, 'resume cookie required')
        const current = () => db.prepare('SELECT data, step, status, receipt, revision FROM drafts WHERE token_hash = ?').get(tokenHash)
        if (req.method === 'GET') return json(res, 200, { draft: publicDraft(current()), rules })
        const input = await body(req)
        if (url.pathname === '/api/registration') {
          if (!input || typeof input !== 'object' || !Number.isInteger(input.step) || input.step < 0 || input.step > 2 || !Number.isInteger(input.revision) || !Object.prototype.hasOwnProperty.call(input, 'data')) return error(res, 400, 'invalid registration update')
          const row = current()
          if (input.revision !== row.revision) return json(res, 409, { error: 'revision conflict', draft: publicDraft(row) })
          if (row.status === 'submitted') return error(res, 409, 'submitted registration cannot be edited')
          const shapeProblem = validateDraftShape(input.data)
          if (shapeProblem) return error(res, 400, shapeProblem)
          db.prepare('UPDATE drafts SET data = ?, step = ?, revision = revision + 1 WHERE token_hash = ? AND revision = ?').run(JSON.stringify(input.data), input.step, tokenHash, input.revision)
          return json(res, 200, { draft: publicDraft(current()) })
        }
        if (!input || !Number.isInteger(input.revision)) return error(res, 400, 'invalid submission')
        const row = current()
        if (row.status === 'submitted') return json(res, 200, { draft: publicDraft(row) })
        if (!rules.submissionEnabled) return error(res, 403, 'submission is not enabled')
        if (input.revision !== row.revision) return json(res, 409, { error: 'revision conflict', draft: publicDraft(row) })
        const problem = validateData(JSON.parse(row.data), rules)
        if (problem) return error(res, 400, problem)
        const receipt = `REG-${randomBytes(8).toString('hex').toUpperCase()}`
        db.prepare("UPDATE drafts SET status = 'submitted', receipt = ?, revision = revision + 1 WHERE token_hash = ? AND revision = ?").run(receipt, tokenHash, input.revision)
        return json(res, 200, { draft: publicDraft(current()) })
      }
      if (req.method !== 'GET') return error(res, 404, 'not found')
      const requested = url.pathname === '/' || url.pathname === '/register' ? 'index.html' : url.pathname.slice(1)
      const file = resolve(root, 'dist', normalize(requested))
      if (!file.startsWith(resolve(root, 'dist'))) return error(res, 404, 'not found')
      let filePath = file
      try { await stat(filePath) } catch { filePath = join(root, 'dist', 'index.html') }
      const content = await readFile(filePath)
      res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(content)
    } catch (err) { error(res, err.message === 'request body too large' ? 413 : 400, err.message === 'request body too large' ? err.message : 'invalid request') }
  })
  app.on('close', () => db.close())
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) createApp().listen(port, () => console.log(`server listening on ${port}`))
