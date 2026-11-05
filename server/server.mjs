import http from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3001)
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')
const maxBodyBytes = 64 * 1024
const maxLoginBodyBytes = 4 * 1024
const cookieName = 'registration_resume'
const cookieTtlSeconds = 60 * 60 * 24 * 30
const adminCookieName = '__Host-admin'
const adminAbsoluteSessionTtlSeconds = 60 * 60 * 4 // 4 hours
const adminIdleSessionTtlSeconds = 60 * 30 // 30 minutes
const reviewStatuses = ['pending', 'valid', 'invalid']
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

export const ALLOWED_ADMINS = Object.freeze([
  { email: 'saivaibhavaluguri@gmail.com', name: 'Aluguri SaiVaibhav' },
  { email: 'jashanthgonipati@gmail.com', username: 'jashanth', name: 'Jashanth Gonipati' },
])

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SCRYPT_MAXMEM = 64 * 1024 * 1024

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function isValidPasswordHash(hashStr) {
  if (typeof hashStr !== 'string') return false
  const parts = hashStr.split('$')
  return parts.length === 3 && parts[0] === 'scrypt' && /^[0-9a-fA-F]{32}$/.test(parts[1]) && /^[0-9a-fA-F]{128}$/.test(parts[2])
}

const DUMMY_SALT = Buffer.alloc(16, 0x5a)
const DUMMY_HASH = scryptSync('dummy_anti_timing_password', DUMMY_SALT, SCRYPT_KEYLEN, {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: SCRYPT_MAXMEM,
})

export function runDummyScrypt(password = '') {
  const candidate = scryptSync(String(password || 'dummy'), DUMMY_SALT, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  timingSafeEqual(DUMMY_HASH, candidate)
}

export function verifyPassword(password, storedHash) {
  if (!isValidPasswordHash(storedHash)) {
    runDummyScrypt(password)
    return false
  }
  const parts = storedHash.split('$')
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  const candidate = scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  if (expected.length !== candidate.length) {
    runDummyScrypt(password)
    return false
  }
  return timingSafeEqual(expected, candidate)
}

export function parseAdminAccounts(source, isProduction = false) {
  let raw = source
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      if (isProduction) throw new Error('ADMIN_ACCOUNTS_JSON is required and cannot be empty in production')
      return null
    }
    try {
      raw = JSON.parse(raw)
    } catch {
      if (isProduction) throw new Error('ADMIN_ACCOUNTS_JSON is not valid JSON')
      return null
    }
  }
  if (!raw && isProduction) {
    throw new Error('ADMIN_ACCOUNTS_JSON is missing in production')
  }
  if (!Array.isArray(raw)) {
    if (isProduction) throw new Error('ADMIN_ACCOUNTS_JSON must be a JSON array')
    return null
  }
  if (raw.length === 0) {
    if (isProduction) throw new Error('ADMIN_ACCOUNTS_JSON cannot be empty in production')
    return []
  }

  const parsed = []
  for (const account of raw) {
    if (!account || typeof account !== 'object') {
      if (isProduction) throw new Error('Invalid account entry in ADMIN_ACCOUNTS_JSON')
      continue
    }
    const email = typeof account.email === 'string' ? account.email.trim().toLowerCase() : ''
    const hash = typeof account.passwordHash === 'string' ? account.passwordHash.trim() : ''

    if (!email || !hash) {
      if (isProduction) throw new Error('Account entry must have email and passwordHash')
      continue
    }

    if (!isValidPasswordHash(hash)) {
      if (isProduction) throw new Error(`Invalid password hash format for ${email}: expected scrypt$<salt-hex>$<hash-hex>`)
      continue
    }

    const matched = ALLOWED_ADMINS.find((a) => a.email.toLowerCase() === email)
    if (!matched) {
      if (isProduction) throw new Error(`Account ${email} is not in the allowed admin list`)
      continue
    }

    parsed.push({
      email: matched.email,
      username: matched.username,
      name: typeof account.name === 'string' && account.name.trim() ? account.name.trim() : matched.name,
      passwordHash: hash,
    })
  }

  if (isProduction && parsed.length === 0) {
    throw new Error('ADMIN_ACCOUNTS_JSON contains no valid allowed admin accounts in production')
  }

  return parsed
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

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex')
function hashToken(token) { return createHash('sha256').update(token).digest('hex') }

function json(res, status, value, extra = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra })
  res.end(body)
}

function error(res, status, message) { json(res, status, { error: message }) }

function parseCookies(value = '') {
  return Object.fromEntries(value.split(';').map((part) => part.trim().split('=')) .filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]))
}

function cookieHeader(token, secure) {
  return `${cookieName}=${encodeURIComponent(token)}; Max-Age=${cookieTtlSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

function adminCookie(value, maxAge, secure) {
  return `${adminCookieName}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const rawForwarded = req.headers['x-forwarded-for']
    if (typeof rawForwarded === 'string' && rawForwarded.trim()) {
      const parts = rawForwarded.split(',')
      const last = parts[parts.length - 1].trim()
      if (last) return last.replace(/^::ffff:/, '')
    }
  }
  const remote = req.socket?.remoteAddress || 'unknown'
  return remote.replace(/^::ffff:/, '')
}

function isSameOrigin(req, secure) {
  const originHeader = req.headers.origin
  let requestOrigin = ''

  if (typeof originHeader === 'string' && originHeader.trim()) {
    requestOrigin = originHeader.trim()
  } else if (typeof req.headers.referer === 'string' && req.headers.referer.trim()) {
    try {
      requestOrigin = new URL(req.headers.referer).origin
    } catch {
      return false
    }
  }

  if (!requestOrigin) return false

  const publicOriginEnv = process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.trim() : null
  let normalizedPublicOrigin = null
  if (publicOriginEnv) {
    try {
      normalizedPublicOrigin = new URL(publicOriginEnv).origin
    } catch {
      normalizedPublicOrigin = publicOriginEnv.replace(/\/+$/, '')
    }
  }

  if (normalizedPublicOrigin) {
    if (requestOrigin === normalizedPublicOrigin) return true
    if (!secure) {
      try {
        const u = new URL(requestOrigin)
        if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
          return true
        }
      } catch {}
    }
    return false
  }

  let protocol = secure ? 'https' : 'http'
  let host = req.headers.host || 'localhost'

  if (process.env.TRUST_PROXY === 'true') {
    if (req.headers['x-forwarded-proto']) {
      protocol = String(req.headers['x-forwarded-proto']).split(',')[0].trim()
    }
    if (req.headers['x-forwarded-host']) {
      host = String(req.headers['x-forwarded-host']).split(',')[0].trim()
    }
  }

  const expectedOrigin = `${protocol}://${host}`
  if (requestOrigin === expectedOrigin) return true

  if (!secure) {
    try {
      const u = new URL(requestOrigin)
      return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    } catch {
      return false
    }
  }

  return false
}

function applySecurityHeaders(req, res, pathname = '', secure = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
  )

  if (pathname.startsWith('/api/admin/')) {
    res.setHeader('Cache-Control', 'no-store')
  }

  const isHttps =
    (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https') ||
    Boolean(req.socket?.encrypted)
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

function publicDraft(row) {
  return row && { data: JSON.parse(row.data), step: row.step, status: row.status, receipt: row.receipt, revision: row.revision }
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

export function createApp({ dbPath = databasePath, adminAccounts, adminAccountsJson } = {}) {
  const secure = process.env.NODE_ENV === 'production'
  const rawAdminConfig = adminAccounts ?? adminAccountsJson ?? process.env.ADMIN_ACCOUNTS_JSON

  if (secure) {
    if (!rawAdminConfig) {
      throw new Error('ADMIN_ACCOUNTS_JSON is required in production')
    }
  }

  // Validate admin accounts configuration on startup
  const configuredAdminAccounts = parseAdminAccounts(rawAdminConfig, secure)

  mkdirSync(resolve(dbPath, '..'), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, data TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      target_key TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL,
      locked_until INTEGER NOT NULL,
      lockout_count INTEGER NOT NULL DEFAULT 0,
      window_start_at INTEGER NOT NULL,
      last_failed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      ip TEXT NOT NULL,
      email_attempted TEXT NOT NULL,
      result TEXT NOT NULL,
      user_agent TEXT NOT NULL
    );
  `)

  // Migrate older admin_sessions table if missing last_active_at
  const adminSessionCols = new Set(db.prepare('PRAGMA table_info(admin_sessions)').all().map((c) => c.name))
  if (!adminSessionCols.has('last_active_at')) {
    db.exec('DROP TABLE admin_sessions')
    db.exec(`CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL
    )`)
  }

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

  function checkLockout(targetKey, now) {
    const row = db.prepare('SELECT failed_attempts, locked_until, lockout_count FROM admin_login_attempts WHERE target_key = ?').get(targetKey)
    if (!row) return { isLocked: false, remainingSeconds: 0 }
    if (row.locked_until > now) {
      return { isLocked: true, remainingSeconds: Math.ceil((row.locked_until - now) / 1000) }
    }
    return { isLocked: false, remainingSeconds: 0 }
  }

  function recordFailedAttempt(targetKey, now) {
    const WINDOW_MS = 15 * 60 * 1000
    const BASE_LOCKOUT_MS = 15 * 60 * 1000
    const row = db.prepare('SELECT failed_attempts, locked_until, lockout_count, window_start_at FROM admin_login_attempts WHERE target_key = ?').get(targetKey)
    if (!row) {
      db.prepare('INSERT INTO admin_login_attempts VALUES (?, 1, 0, 0, ?, ?)').run(targetKey, now, now)
      return { locked: false, remainingSeconds: 0 }
    }
    const inWindow = (now - row.window_start_at) < WINDOW_MS
    let attempts = inWindow ? row.failed_attempts + 1 : 1
    let windowStart = inWindow ? row.window_start_at : now
    let lockoutCount = row.lockout_count
    let lockedUntil = 0

    if (attempts >= 5) {
      lockoutCount += 1
      const duration = BASE_LOCKOUT_MS * lockoutCount
      lockedUntil = now + duration
    }
    db.prepare(`UPDATE admin_login_attempts 
      SET failed_attempts = ?, locked_until = ?, lockout_count = ?, window_start_at = ?, last_failed_at = ? 
      WHERE target_key = ?`
    ).run(attempts, lockedUntil, lockoutCount, windowStart, now, targetKey)

    const remainingSeconds = lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0
    return { locked: lockedUntil > now, remainingSeconds }
  }

  function clearLoginAttempts(targetKey) {
    db.prepare('DELETE FROM admin_login_attempts WHERE target_key = ?').run(targetKey)
  }

  function recordAuditLog({ ip, email, result, userAgent }) {
    db.prepare('INSERT INTO admin_audit_log (timestamp, ip, email_attempted, result, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), ip, String(email || '').slice(0, 254), result, String(userAgent || '').slice(0, 500))
  }

  const allRegistrations = () => db.prepare("SELECT receipt, revision, data, source, review_status, reviewed_by, reviewed_at, submitted_at FROM drafts WHERE status = 'submitted' ORDER BY submitted_at DESC").all()

  function currentAdmin(req) {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[adminCookieName] || cookies['kgrcet_admin']
    if (!token) return null
    const now = Date.now()
    const tokenHash = hashToken(token)
    const row = db.prepare('SELECT email, name, absolute_expires_at, idle_expires_at FROM admin_sessions WHERE token_hash = ?').get(tokenHash)
    if (!row) return null

    if (now >= row.absolute_expires_at || now >= row.idle_expires_at) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash)
      return null
    }

    const accounts = parseAdminAccounts(configuredAdminAccounts) || []
    const account = accounts.find((candidate) => candidate.email.toLowerCase() === row.email.toLowerCase())
    if (!account) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash)
      return null
    }

    const newIdle = Math.min(row.absolute_expires_at, now + adminIdleSessionTtlSeconds * 1000)
    db.prepare('UPDATE admin_sessions SET last_active_at = ?, idle_expires_at = ? WHERE token_hash = ?').run(now, newIdle, tokenHash)

    return { email: row.email, name: row.name }
  }

  async function adminLogin(req, res) {
    let input
    try {
      input = await readJsonBody(req, maxLoginBodyBytes)
    } catch (err) {
      return error(res, err.statusCode || 400, err.message)
    }

    const identifier = typeof input?.identifier === 'string' ? input.identifier : (typeof input?.email === 'string' ? input.email : '')
    const password = typeof input?.password === 'string' ? input.password : ''

    if (!identifier || !password || identifier.length > 254 || password.length > 1024) {
      return error(res, 400, 'invalid credentials')
    }

    const accounts = parseAdminAccounts(configuredAdminAccounts)
    if (!accounts || !accounts.length) {
      return error(res, 503, 'Admin accounts are not configured on this server.')
    }

    const now = Date.now()
    const ip = clientIp(req)
    const userAgent = req.headers['user-agent'] || ''
    const normalizedIdentifier = identifier.trim().toLowerCase()

    const ipKey = `ip:${ip}`
    const matchedAccount = accounts.find((candidate) =>
      candidate.email.toLowerCase() === normalizedIdentifier ||
      (candidate.username && candidate.username.toLowerCase() === normalizedIdentifier)
    )
    const accountKey = `account:${matchedAccount ? matchedAccount.email.toLowerCase() : normalizedIdentifier}`

    const ipLock = checkLockout(ipKey, now)
    const accountLock = checkLockout(accountKey, now)
    const isLocked = ipLock.isLocked || accountLock.isLocked

    if (isLocked) {
      runDummyScrypt(password)
      recordAuditLog({ ip, email: normalizedIdentifier, result: 'locked', userAgent })
      return error(res, 401, 'Invalid credentials')
    }

    if (!matchedAccount) {
      runDummyScrypt(password)
      recordFailedAttempt(ipKey, now)
      recordFailedAttempt(accountKey, now)
      recordAuditLog({ ip, email: normalizedIdentifier, result: 'fail', userAgent })
      return error(res, 401, 'Invalid credentials')
    }

    const passwordMatches = verifyPassword(password, matchedAccount.passwordHash)
    if (!passwordMatches) {
      recordFailedAttempt(ipKey, now)
      recordFailedAttempt(accountKey, now)
      recordAuditLog({ ip, email: normalizedIdentifier, result: 'fail', userAgent })
      return error(res, 401, 'Invalid credentials')
    }

    // Successful login: clear lockout counters, log success, issue fresh session
    clearLoginAttempts(ipKey)
    clearLoginAttempts(accountKey)
    recordAuditLog({ ip, email: matchedAccount.email, result: 'success', userAgent })

    // Clean expired sessions
    db.prepare('DELETE FROM admin_sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ?').run(now, now)

    // Remove any pre-existing session token from this client's cookie
    const oldCookies = parseCookies(req.headers.cookie)
    const oldToken = oldCookies[adminCookieName] || oldCookies['kgrcet_admin']
    if (oldToken) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(oldToken))
    }

    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const absExpiry = now + adminAbsoluteSessionTtlSeconds * 1000
    const idleExpiry = now + adminIdleSessionTtlSeconds * 1000

    db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tokenHash, matchedAccount.email, matchedAccount.name, now, now, absExpiry, idleExpiry)

    return json(
      res,
      200,
      { session: { email: matchedAccount.email, name: matchedAccount.name } },
      { 'Set-Cookie': adminCookie(token, adminAbsoluteSessionTtlSeconds, secure) }
    )
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
    // 1. Origin verification for state-changing routes
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && !isSameOrigin(req, secure)) {
      return error(res, 403, 'same-origin request required')
    }

    // 2. Public login endpoint
    if (url.pathname === '/api/admin/login') {
      if (req.method !== 'POST') return error(res, 405, 'method not allowed')
      return adminLogin(req, res)
    }

    // 3. Admin session check endpoint
    if (url.pathname === '/api/admin/session' && req.method === 'GET') {
      const admin = currentAdmin(req)
      return json(res, 200, { session: admin ? { email: admin.email, name: admin.name } : null })
    }

    // 4. DENY BY DEFAULT: Every other /api/admin/* route denies without a valid session
    const admin = currentAdmin(req)
    if (!admin) return error(res, 401, 'admin session required')

    // 5. Logout
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie)
      const token = cookies[adminCookieName] || cookies['kgrcet_admin']
      if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token))
      return json(res, 200, { ok: true }, { 'Set-Cookie': adminCookie('', 0, secure) })
    }

    // 6. Logout all sessions for this account
    if (url.pathname === '/api/admin/logout-all' && req.method === 'POST') {
      db.prepare('DELETE FROM admin_sessions WHERE LOWER(email) = LOWER(?)').run(admin.email)
      return json(res, 200, { ok: true }, { 'Set-Cookie': adminCookie('', 0, secure) })
    }

    // 7. Audit log (read-only last 100 events)
    if (url.pathname === '/api/admin/audit-log' && req.method === 'GET') {
      const events = db.prepare('SELECT timestamp, ip, email_attempted, result, user_agent FROM admin_audit_log ORDER BY id DESC LIMIT 100').all()
      return json(res, 200, { events })
    }

    // 8. View registrations
    if (url.pathname === '/api/admin/registrations' && req.method === 'GET') {
      const draftsInProgress = db.prepare("SELECT data FROM drafts WHERE status = 'draft'").all().filter(({ data }) => {
        const draft = JSON.parse(data)
        return draft.members.length > 0 || ['teamName', 'teamSize', 'college', 'leadName', 'email', 'phone'].some((field) => draft[field].trim())
      }).length
      return json(res, 200, { registrations: allRegistrations().map(publicRegistration), draftsInProgress, rules })
    }

    // 9. Spot registration
    if (url.pathname === '/api/admin/registrations' && req.method === 'POST') {
      const input = await readJsonBody(req)
      const problem = registrationProblem(input?.data)
      if (problem) return error(res, 400, problem)
      const now = Date.now()
      const tokenHash = hashToken(randomBytes(32).toString('hex'))
      const receipt = `REG-${randomBytes(8).toString('hex').toUpperCase()}`
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, now, now + cookieTtlSeconds * 1000)
      db.prepare("INSERT INTO drafts (token_hash, data, step, status, receipt, revision, source, review_status, reviewed_by, reviewed_at, submitted_at) VALUES (?, ?, 2, 'submitted', ?, 0, 'spot', 'valid', ?, ?, ?)")
        .run(tokenHash, JSON.stringify(cleanRegistration(input.data)), receipt, admin.email, now, now)
      return json(res, 201, { registration: publicRegistration(allRegistrations().find((row) => row.receipt === receipt)) })
    }

    // 10. Update registration or status
    const match = /^\/api\/admin\/registrations\/(REG-[A-F0-9]{16})(\/status)?$/.exec(url.pathname)
    if (match && req.method === 'PUT') {
      const [, receipt, isStatus] = match
      const existing = allRegistrations().find((row) => row.receipt === receipt)
      if (!existing) return error(res, 404, 'registration not found')
      const input = await readJsonBody(req)
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

  async function readJsonBody(req, maxSize = maxBodyBytes) {
    const contentType = req.headers['content-type'] || ''
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      const err = new Error('JSON body required')
      err.statusCode = 400
      throw err
    }
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > maxSize) {
        const err = new Error('request body too large')
        err.statusCode = 413
        throw err
      }
      chunks.push(chunk)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      const err = new Error('invalid JSON')
      err.statusCode = 400
      throw err
    }
  }

  const app = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      const originalWriteHead = res.writeHead
      res.writeHead = function (statusCode, ...args) {
        applySecurityHeaders(req, res, url.pathname, secure)
        return originalWriteHead.call(this, statusCode, ...args)
      }

      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && !isSameOrigin(req, secure)) return error(res, 403, 'same-origin request required')
        if (!['GET', 'PUT', 'POST'].includes(req.method)) return error(res, 405, 'method not allowed')
        if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url)
        if (url.pathname !== '/api/registration' && url.pathname !== '/api/registration/submit') return error(res, 404, 'not found')
        const tokenHash = req.method === 'GET' ? sessionFor(req, res) : existingSession(req)
        if (!tokenHash) return error(res, 401, 'resume cookie required')
        const current = () => db.prepare('SELECT data, step, status, receipt, revision FROM drafts WHERE token_hash = ?').get(tokenHash)
        if (req.method === 'GET') return json(res, 200, { draft: publicDraft(current()), rules })
        const input = await readJsonBody(req)
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
      res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' })
      res.end(content)
    } catch (err) {
      error(res, err.statusCode || (err.message === 'request body too large' ? 413 : 400), err.message || 'invalid request')
    }
  })
  app.on('close', () => db.close())
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    createApp().listen(port, () => console.log(`server listening on ${port}`))
  } catch (err) {
    console.error(`Server failed to start: ${err.message}`)
    process.exit(1)
  }
}
