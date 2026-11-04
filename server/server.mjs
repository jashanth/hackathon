import http from 'node:http'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3001)
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')
const maxBodyBytes = 64 * 1024
const cookieName = 'registration_resume'
const cookieTtlSeconds = 60 * 60 * 24 * 30
const adminCookieName = 'kgrcet_admin'
const adminSessionTtlSeconds = 60 * 60 * 4
const reviewStatuses = ['pending', 'valid', 'invalid']
const scryptAsync = promisify(scrypt)
// Checked when an email has no account, so a login takes the same time whether or not the account exists.
const unusedPasswordHash = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

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

function adminAccounts(serialized) {
  let accounts
  try { accounts = JSON.parse(serialized || '[]') } catch { return null }
  if (!Array.isArray(accounts)) return null
  return accounts.filter((account) => account && typeof account.email === 'string' && typeof account.name === 'string' && typeof account.passwordHash === 'string')
}

async function passwordMatches(password, encoded) {
  const [scheme, salt, expected] = encoded.split('$')
  if (scheme !== 'scrypt' || !/^[\da-f]{32,128}$/i.test(salt || '') || !/^[\da-f]{128}$/i.test(expected || '')) return false
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
}

function adminCookie(value, maxAge, secure) {
  return `${adminCookieName}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

function clientIp(req) {
  // A trusted proxy appends the real client address as the last entry.
  const forwarded = process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() : ''
  return forwarded || req.socket.remoteAddress || 'unknown'
}

function publicRegistration(row) {
  return {
    receipt: row.receipt,
    revision: row.revision,
    data: JSON.parse(row.data),
    source: row.source,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    submittedAt: row.submitted_at,
  }
}

// Admin input is rebuilt field by field, so only known values are stored and team size always matches the people listed.
function cleanRegistration(data) {
  const text = (value) => value.trim()
  return {
    teamName: text(data.teamName),
    teamSize: String(data.members.length + 1),
    college: text(data.college),
    leadName: text(data.leadName),
    email: text(data.email),
    phone: data.phone.replace(/[\s().-]/g, ''),
    members: data.members.map((member) => ({ name: text(member.name), email: text(member.email), college: text(member.college) })),
  }
}

export function createApp({ dbPath = databasePath, adminAccountsJson = process.env.ADMIN_ACCOUNTS_JSON } = {}) {
  mkdirSync(resolve(dbPath, '..'), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, data TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL);`)
  const draftColumns = new Set(db.prepare('PRAGMA table_info(drafts)').all().map((column) => column.name))
  for (const [name, definition] of [
    ['review_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['reviewed_by', 'TEXT'],
    ['reviewed_at', 'INTEGER'],
    ['source', "TEXT NOT NULL DEFAULT 'website'"],
    ['submitted_at', 'INTEGER'],
  ]) {
    if (!draftColumns.has(name)) db.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${definition}`)
  }
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
      db.prepare("INSERT INTO drafts (token_hash, data, step, status, receipt, revision) VALUES (?, ?, 0, 'draft', NULL, 0)").run(tokenHash, JSON.stringify({ teamName: '', teamSize: '', college: '', leadName: '', email: '', phone: '', members: [] }))
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
    if (origin === `${protocol}://${host}`) return true
    // Outside production, also accept local origins so Vite's /api proxy works from its dev port.
    if (secure) return false
    try {
      const { protocol: originProtocol, hostname } = new URL(origin)
      return originProtocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    } catch { return false }
  }

  const loginAttempts = new Map()
  const loginFailuresByIp = new Map()

  const allRegistrations = () => db.prepare("SELECT receipt, revision, data, source, review_status, reviewed_by, reviewed_at, submitted_at FROM drafts WHERE status = 'submitted' ORDER BY submitted_at DESC").all()

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie)[adminCookieName]
    if (!token) return null
    const row = db.prepare('SELECT email, name FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now())
    if (!row) return null
    // Removing an account from the configuration ends its sessions immediately.
    const account = (adminAccounts(adminAccountsJson) || []).some((candidate) => candidate.email.trim().toLowerCase() === row.email.trim().toLowerCase())
    if (!account) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token))
      return null
    }
    return row
  }

  async function adminLogin(req, res) {
    const input = await body(req)
    if (!input || typeof input.email !== 'string' || typeof input.password !== 'string' || input.email.length > 254 || input.password.length > 1024) return error(res, 400, 'invalid credentials')
    const accounts = adminAccounts(adminAccountsJson)
    if (!accounts) return error(res, 503, 'Admin account configuration is invalid.')
    if (!accounts.length) return error(res, 503, 'Admin accounts are not configured.')
    const now = Date.now()
    const ip = clientIp(req)
    const email = input.email.trim().toLowerCase()
    const attemptKey = `${ip}|${email}`
    const attempts = loginAttempts.get(attemptKey)
    const ipFailures = loginFailuresByIp.get(ip)
    if (ipFailures && ipFailures.resetAt > now && ipFailures.count >= 30) return error(res, 429, 'Too many failed login attempts from this network. Please try again later.')
    if (attempts && attempts.lockedUntil > now) return json(res, 429, { error: 'Too many failed login attempts. Please wait before trying again.', locked: true, remainingLockoutSeconds: Math.ceil((attempts.lockedUntil - now) / 1000) })
    const account = accounts.find((candidate) => candidate.email.trim().toLowerCase() === email)
    const matches = await passwordMatches(input.password, account?.passwordHash || unusedPasswordHash)
    if (!account || !matches) {
      // Random emails must not grow these maps without limit.
      if (loginAttempts.size > 10000) loginAttempts.clear()
      if (loginFailuresByIp.size > 10000) loginFailuresByIp.clear()
      const failedAttempts = (attempts?.failedAttempts || 0) + 1
      const lockedUntil = failedAttempts >= 5 ? now + 60_000 : 0
      loginAttempts.set(attemptKey, { failedAttempts, lockedUntil })
      const active = ipFailures && ipFailures.resetAt > now
      loginFailuresByIp.set(ip, { count: (active ? ipFailures.count : 0) + 1, resetAt: active ? ipFailures.resetAt : now + 15 * 60_000 })
      if (lockedUntil) return json(res, 429, { error: 'Too many failed login attempts. Please wait before trying again.', locked: true, remainingLockoutSeconds: 60 })
      return error(res, 401, 'Invalid email or password.')
    }
    loginAttempts.delete(attemptKey)
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now)
    const token = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?, ?)').run(hashToken(token), account.email, account.name, now + adminSessionTtlSeconds * 1000)
    return json(res, 200, { session: { email: account.email, name: account.name } }, { 'Set-Cookie': adminCookie(token, adminSessionTtlSeconds, secure) })
  }

  function registrationProblem(data, receipt) {
    const shapeProblem = validateDraftShape(data)
    if (shapeProblem) return shapeProblem
    const clean = cleanRegistration(data)
    const problem = validateData(clean, rules)
    if (problem) return problem
    const email = clean.email.toLowerCase()
    const duplicate = allRegistrations().some((row) => row.receipt !== receipt && JSON.parse(row.data).email.trim().toLowerCase() === email)
    return duplicate ? 'a registration with this leader email already exists' : null
  }

  async function adminApi(req, res, url) {
    if (url.pathname === '/api/admin/login' && req.method === 'POST') return adminLogin(req, res)
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      const token = parseCookies(req.headers.cookie)[adminCookieName]
      if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token))
      return json(res, 200, { ok: true }, { 'Set-Cookie': adminCookie('', 0, secure) })
    }
    const admin = currentAdmin(req)
    if (url.pathname === '/api/admin/session' && req.method === 'GET') return json(res, 200, { session: admin ? { email: admin.email, name: admin.name } : null })
    if (!admin) return error(res, 401, 'admin session required')

    if (url.pathname === '/api/admin/registrations' && req.method === 'GET') {
      // Unsubmitted drafts stay private: the console only learns how many are in progress, not what they contain.
      const draftsInProgress = db.prepare("SELECT data FROM drafts WHERE status = 'draft'").all().filter(({ data }) => {
        const draft = JSON.parse(data)
        return draft.members.length > 0 || ['teamName', 'teamSize', 'college', 'leadName', 'email', 'phone'].some((field) => draft[field].trim())
      }).length
      return json(res, 200, { registrations: allRegistrations().map(publicRegistration), draftsInProgress, rules })
    }
    if (url.pathname === '/api/admin/registrations' && req.method === 'POST') {
      const input = await body(req)
      const problem = registrationProblem(input?.data)
      if (problem) return error(res, 400, problem)
      // A spot team has no browser to resume from, so its session token is generated and thrown away.
      const now = Date.now()
      const tokenHash = hashToken(randomBytes(32).toString('hex'))
      const receipt = `REG-${randomBytes(8).toString('hex').toUpperCase()}`
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, now, now + cookieTtlSeconds * 1000)
      db.prepare("INSERT INTO drafts (token_hash, data, step, status, receipt, revision, source, review_status, reviewed_by, reviewed_at, submitted_at) VALUES (?, ?, 2, 'submitted', ?, 0, 'spot', 'valid', ?, ?, ?)")
        .run(tokenHash, JSON.stringify(cleanRegistration(input.data)), receipt, admin.email, now, now)
      return json(res, 201, { registration: publicRegistration(allRegistrations().find((row) => row.receipt === receipt)) })
    }

    const match = /^\/api\/admin\/registrations\/(REG-[A-F0-9]{16})(\/status)?$/.exec(url.pathname)
    if (match && req.method === 'PUT') {
      const [, receipt, isStatus] = match
      const existing = allRegistrations().find((row) => row.receipt === receipt)
      if (!existing) return error(res, 404, 'registration not found')
      const input = await body(req)
      if (isStatus) {
        if (!reviewStatuses.includes(input?.status)) return error(res, 400, 'invalid status')
        db.prepare('UPDATE drafts SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE receipt = ?').run(input.status, admin.email, Date.now(), receipt)
      } else {
        if (!Number.isInteger(input?.revision)) return error(res, 400, 'invalid registration update')
        if (input.revision !== existing.revision) return error(res, 409, 'This registration changed in another tab. Reload and try again.')
        const problem = registrationProblem(input.data, receipt)
        if (problem) return error(res, 400, problem)
        db.prepare('UPDATE drafts SET data = ?, revision = revision + 1 WHERE receipt = ?').run(JSON.stringify(cleanRegistration(input.data)), receipt)
      }
      return json(res, 200, { registration: publicRegistration(allRegistrations().find((row) => row.receipt === receipt)) })
    }
    return error(res, 404, 'not found')
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
        if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url)
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
        db.prepare("UPDATE drafts SET status = 'submitted', receipt = ?, submitted_at = ?, revision = revision + 1 WHERE token_hash = ? AND revision = ?").run(receipt, Date.now(), tokenHash, input.revision)
        return json(res, 200, { draft: publicDraft(current()) })
      }
      if (req.method !== 'GET') return error(res, 404, 'not found')
      const requested = url.pathname === '/' || url.pathname === '/register' ? 'index.html' : url.pathname.slice(1)
      const file = resolve(root, 'dist', normalize(requested))
      if (!file.startsWith(resolve(root, 'dist'))) return error(res, 404, 'not found')
      let filePath = file
      try { await stat(filePath) } catch { filePath = join(root, 'dist', 'index.html') }
      const content = await readFile(filePath)
      res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); res.end(content)
    } catch (err) { error(res, err.message === 'request body too large' ? 413 : 400, err.message === 'request body too large' ? err.message : 'invalid request') }
  })
  app.on('close', () => db.close())
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) createApp().listen(port, () => console.log(`server listening on ${port}`))
