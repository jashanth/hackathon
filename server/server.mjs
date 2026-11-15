import http from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { initEmailTables, createSmtpTransport, enqueueConfirmationEmails, processEmailQueue, isValidEmail, renderMemberConfirmationEmail, renderInvitationEmail, INVITATION_TEMPLATES, EVENT_DETAILS, sanitizeHeader, sanitizeErrorMessage } from './email-service.mjs'

export class RateLimiter {
  constructor({ windowMs, maxRequests }) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
    this.hits = new Map()
    this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(windowMs, 60000))
    if (this.cleanupInterval.unref) this.cleanupInterval.unref()
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs
    for (const [key, timestamps] of this.hits.entries()) {
      const active = timestamps.filter((t) => t > cutoff)
      if (active.length === 0) {
        this.hits.delete(key)
      } else {
        this.hits.set(key, active)
      }
    }
  }

  check(key) {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const timestamps = (this.hits.get(key) || []).filter((t) => t > cutoff)
    const allowed = timestamps.length < this.maxRequests
    if (allowed) {
      timestamps.push(now)
      this.hits.set(key, timestamps)
    }
    const remaining = Math.max(0, this.maxRequests - timestamps.length)
    const resetTime = timestamps.length ? Math.ceil((timestamps[0] + this.windowMs - now) / 1000) : Math.ceil(this.windowMs / 1000)
    return {
      allowed,
      limit: this.maxRequests,
      remaining,
      retryAfterSeconds: allowed ? 0 : Math.max(1, resetTime),
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval)
    this.hits.clear()
  }
}

export function containsDangerousHtml(str) {
  if (typeof str !== 'string') return false
  const s = str.trim()
  if (!s) return false
  if (/<\s*\/?[a-z][\w-]*(\s+[^>]*)?\/?>/i.test(s)) return true
  if (/(?:on\w+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html)/i.test(s)) return true
  return false
}

export function sanitizeInputText(value, maxLength = 200) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .normalize('NFC')
    .trim()
    .slice(0, maxLength)
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3001)
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')
const maxBodyBytes = 64 * 1024
const maxLoginBodyBytes = 4 * 1024
// Requests that carry a payment screenshot: a 2 MB image grows by a third as base64.
const maxPaymentBodyBytes = 3 * 1024 * 1024
const maxPaymentProofBytes = 2 * 1024 * 1024
const cookieName = 'registration_resume'
const cookieTtlSeconds = 60 * 60 * 24 * 30
const adminCookieName = '__Host-admin'
export const ADMIN_COOKIE_MAX_AGE = 31536000 // 1 year

export function getAdminSessionMaxHours(env = process.env) {
  const val = Number(env?.ADMIN_SESSION_MAX_HOURS)
  return Number.isFinite(val) && val > 0 ? val : 0
}
const reviewStatuses = ['pending', 'valid', 'invalid']
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

export const ALLOWED_ADMINS = Object.freeze([
  { email: 'saivaibhavaluguri@gmail.com', name: 'Aluguri SaiVaibhav' },
  { email: 'jashanthgonipati@gmail.com', username: 'jashanth', name: 'Jashanth Gonipati', aliases: ['jashanth@ikarus.kgrcet.ac.in'] },
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
    const username = typeof account.username === 'string' ? account.username.trim().toLowerCase() : ''
    const identifier = typeof account.identifier === 'string' ? account.identifier.trim().toLowerCase() : ''
    const hash = typeof account.passwordHash === 'string' ? account.passwordHash.trim() : ''

    const lookupKey = email || username || identifier
    if (!lookupKey || !hash) {
      if (isProduction) throw new Error('Account entry must have email and passwordHash')
      continue
    }

    const matched = ALLOWED_ADMINS.find((a) =>
      (email && (a.email.toLowerCase() === email || (a.username && a.username.toLowerCase() === email) || (a.aliases && a.aliases.some((al) => al.toLowerCase() === email)))) ||
      (username && (a.username && a.username.toLowerCase() === username || a.email.toLowerCase() === username)) ||
      (lookupKey && (a.email.toLowerCase() === lookupKey || (a.username && a.username.toLowerCase() === lookupKey) || (a.aliases && a.aliases.some((al) => al.toLowerCase() === lookupKey))))
    )
    if (!matched) {
      if (isProduction) throw new Error(`Account ${lookupKey} is not in the allowed admin list`)
      continue
    }

    if (!isValidPasswordHash(hash)) {
      if (isProduction) throw new Error(`Invalid password hash format for ${matched.email}: expected scrypt$<salt-hex>$<hash-hex>`)
      continue
    }

    parsed.push({
      email: matched.email,
      username: matched.username,
      name: typeof account.name === 'string' && account.name.trim() ? account.name.trim() : matched.name,
      aliases: matched.aliases || [],
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
  const feePerPerson = number('REGISTRATION_FEE_PER_PERSON') ?? 649
  return { minTeamSize, maxTeamSize, feePerPerson, submissionEnabled: process.env.SUBMISSION_ENABLED === 'true' && minTeamSize !== null && maxTeamSize !== null && minTeamSize <= maxTeamSize }
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

function adminCookie(value, maxAge = ADMIN_COOKIE_MAX_AGE, secure) {
  // Browsers drop __Host- cookies without Secure, so plain-http dev uses an unprefixed name.
  const name = secure ? adminCookieName : 'kgrcet_admin'
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
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
  res.setHeader('X-XSS-Protection', '0')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), screen-wake-lock=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
  )

  if (pathname.startsWith('/api/admin/')) {
    res.setHeader('Cache-Control', 'no-store')
  } else if (pathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
  }

  const isHttps =
    (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https') ||
    Boolean(req.socket?.encrypted)
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

// Accepts a base64 data URL only when its bytes really are the PNG, JPEG or WebP it claims to be.
function paymentProofFromDataUrl(value) {
  if (typeof value !== 'string') return null
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return null
  const image = Buffer.from(match[2], 'base64')
  if (image.length === 0 || image.length > maxPaymentProofBytes || image.toString('base64') !== match[2]) return null
  const validSignature =
    (match[1] === 'image/png' && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (match[1] === 'image/jpeg' && image[0] === 255 && image[1] === 216 && image[2] === 255) ||
    (match[1] === 'image/webp' && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP')
  return validSignature ? { mime: match[1], image } : null
}

function publicDraft(row) {
  return row && { data: JSON.parse(row.data), step: row.step, status: row.status, receipt: row.receipt, revision: row.revision }
}

export function generateNextReceipt(db) {
  const row = db.prepare(`
    SELECT receipt FROM drafts 
    WHERE receipt GLOB '[0-9][0-9][0-9][0-9]' 
    ORDER BY CAST(receipt AS INTEGER) DESC 
    LIMIT 1
  `).get()

  if (!row || !row.receipt) {
    return '1001'
  }
  const nextNumber = Number(row.receipt) + 1
  return String(nextNumber).padStart(4, '0')
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
    paymentMethod: row.payment_method || 'upi',
    utrNumber: row.utr_number || null,
    amount: row.amount_rupees ?? 0,
    hasPaymentProof: Boolean(row.has_proof),
    emailStatus: row.email_status || null,
    emailSentCount: row.email_sent_count ?? 0,
    emailFailedCount: row.email_failed_count ?? 0,
    emailLastAttemptAt: row.email_last_attempt_at || null,
    emailLastError: row.email_last_error || null,
  }
}

function validateDraftShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be an object'
  const fields = ['teamName', 'teamSize', 'college', 'leadName', 'email', 'phone']
  if (fields.some((field) => typeof data[field] !== 'string' || data[field].length > 200)) return 'all team fields must be short strings'
  for (const f of ['collegeCode', 'rollNumber', 'gender', 'year', 'courseName', 'foodPreference', 'domain', 'track']) {
    if (data[f] !== undefined && (typeof data[f] !== 'string' || data[f].length > 200)) return 'all team fields must be short strings'
  }
  if (!Array.isArray(data.members)) return 'members must be an array'
  if (data.members.length > 50) return 'team member count cannot exceed 50'
  for (const member of data.members) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) return 'member details are invalid'
    if (['name', 'email', 'college'].some((field) => typeof member[field] !== 'string' || member[field].length > 200)) return 'member details are invalid'
    for (const f of ['phone', 'rollNumber', 'gender', 'year', 'collegeCode', 'courseName', 'foodPreference']) {
      if (member[f] !== undefined && (typeof member[f] !== 'string' || member[f].length > 200)) return 'member details are invalid'
    }
  }

  // Check for HTML/Script injection in all string fields
  const stringsToCheck = [
    data.teamName, data.college, data.leadName,
    data.collegeCode, data.rollNumber, data.gender, data.year, data.courseName, data.foodPreference,
    data.domain, data.track,
  ]
  for (const member of data.members) {
    if (member && typeof member === 'object') {
      stringsToCheck.push(member.name, member.college, member.phone, member.rollNumber, member.gender, member.year, member.collegeCode, member.courseName, member.foodPreference)
    }
  }
  if (stringsToCheck.some((s) => typeof s === 'string' && containsDangerousHtml(s))) {
    return 'HTML tags or script payloads are not permitted in registration fields'
  }

  return null
}

function validateData(data, rules) {
  const shapeProblem = validateDraftShape(data)
  if (shapeProblem) return shapeProblem
  const fields = ['teamName', 'college', 'leadName', 'email', 'phone']
  if (fields.some((field) => data[field].trim().length === 0)) return 'all team fields are required'
  if (!isValidEmail(data.email)) return 'email is invalid'
  if (!/^\d+$/.test(data.teamSize)) return 'teamSize must be a numeric string'
  const teamSize = Number(data.teamSize)
  if (!/^\+?[1-9]\d{7,14}$/.test(data.phone)) return 'phone is invalid'
  if (data.members.length + 1 !== teamSize) return 'teamSize must match the lead and members'
  if (rules.minTeamSize !== null && teamSize < rules.minTeamSize) return 'team size is below the minimum'
  if (rules.maxTeamSize !== null && teamSize > rules.maxTeamSize) return 'team size exceeds the maximum'
  const emails = new Set([data.email.trim().toLowerCase()])
  for (const member of data.members) {
    if (['name', 'email', 'college'].some((field) => member[field].trim() === '')) return 'member details are required'
    if (!isValidEmail(member.email)) return 'member email is invalid'
    const email = member.email.trim().toLowerCase()
    if (emails.has(email)) return 'member and lead emails must be unique'
    emails.add(email)
  }
  return null
}

function cleanRegistration(data) {
  const text = (value) => sanitizeInputText(value, 200)
  const member = (m) => {
    const res = {
      name: text(m.name),
      email: text(m.email).toLowerCase(),
      college: text(m.college),
    }
    for (const key of ['phone', 'rollNumber', 'gender', 'year', 'collegeCode', 'courseName', 'foodPreference']) {
      if (m[key] !== undefined) res[key] = text(m[key])
    }
    return res
  }
  const cleaned = {
    teamName: text(data.teamName),
    teamSize: String(data.members.length + 1),
    college: text(data.college),
    leadName: text(data.leadName),
    email: text(data.email).toLowerCase(),
    phone: (data.phone || '').replace(/[\s().-]/g, ''),
    members: data.members.map(member),
  }
  for (const key of ['collegeCode', 'rollNumber', 'gender', 'year', 'courseName', 'foodPreference', 'domain', 'track']) {
    if (data[key] !== undefined) cleaned[key] = text(data[key])
  }
  if (!cleaned.domain && data.track) cleaned.domain = text(data.track)
  return cleaned
}

export function initProblemStatementsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS problem_statements (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      statement_code TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Software Projects',
      description TEXT,
      pdf_url TEXT,
      pdf_filename TEXT,
      pdf_mime TEXT,
      pdf_data BLOB,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_problem_statements_track ON problem_statements(track_id, is_active, display_order);
  `)

  try {
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM problem_statements').get()
    if (!countRow || countRow.count === 0) {
      const now = Date.now()
      const seedStatements = [
        { code: 'PNG1', title: 'Adversarial Contract Intelligence', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 1 },
        { code: 'PNG2', title: 'Multi-Agent Incident Commander', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 2 },
        { code: 'PNG3', title: 'LLM Specification Compiler', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 3 },
        { code: 'PNG4', title: 'Self-Healing Knowledge Base', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 4 },
        { code: 'PNG5', title: 'Agent Permission Governor', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 5 },
        { code: 'PNG6', title: 'Agentic Data Cleaning Planner', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 6 },
        { code: 'PNG7', title: 'Autonomous Test Generation for Legacy Systems', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 7 },
        { code: 'PNG8', title: 'Semantic Change Impact Analyzer', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 8 },
        { code: 'PNG9', title: 'Personalized Learning Path Optimizer', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 9 },
        { code: 'PNG10', title: 'LLM Cost-Quality Routing Fabric', url: 'https://res.cloudinary.com/avz3xnha/image/upload/PNG1.pdf', order: 10 },
      ]
      const insertStmt = db.prepare(`
        INSERT INTO problem_statements (id, track_id, statement_code, title, category, description, pdf_url, is_active, display_order, created_at, updated_at)
        VALUES (?, 'generative-ai-automation', ?, ?, 'Software Projects', 'Official challenge specification for Generative AI & Automation.', ?, 1, ?, ?, ?)
      `)
      for (const item of seedStatements) {
        const id = randomBytes(16).toString('hex')
        insertStmt.run(id, item.code, item.title, item.url, item.order, now, now)
      }
    }
  } catch (err) {
    console.error('[problem-statements] Initialization error:', err?.message || err)
  }
}

export function initInvitationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      recipient_name TEXT NOT NULL,
      email TEXT NOT NULL,
      institution TEXT NOT NULL,
      designation TEXT NOT NULL,
      category TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      sent_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
    CREATE INDEX IF NOT EXISTS idx_invitations_created ON invitations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invitations_category ON invitations(category);
    CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
  `)
}

export function publicInvitation(row) {
  if (!row) return null
  return {
    id: row.id,
    recipientName: row.recipient_name,
    email: row.email,
    institution: row.institution,
    designation: row.designation,
    category: row.category,
    templateKey: row.template_key,
    subject: row.subject,
    message: row.message,
    status: row.status,
    sentBy: row.sent_by,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    lastError: row.last_error,
  }
}

export function createApp({ dbPath = databasePath, adminAccounts, adminAccountsJson, mailer: customMailer } = {}) {
  const secure = process.env.NODE_ENV === 'production'
  const rawAdminConfig = adminAccounts ?? adminAccountsJson ?? process.env.ADMIN_ACCOUNTS_JSON

  if (secure) {
    if (!rawAdminConfig) {
      throw new Error('ADMIN_ACCOUNTS_JSON is required in production')
    }
  }

  // Validate admin accounts configuration on startup
  const configuredAdminAccounts = parseAdminAccounts(rawAdminConfig, secure)
  const mailer = customMailer || createSmtpTransport(process.env)

  mkdirSync(resolve(dbPath, '..'), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA cell_size_check = ON;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, data TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL,
      password_hash TEXT
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
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  // Migrate older admin_sessions table if missing last_active_at or password_hash
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
      idle_expires_at INTEGER NOT NULL,
      password_hash TEXT
    )`)
  } else if (!adminSessionCols.has('password_hash')) {
    db.exec('ALTER TABLE admin_sessions ADD COLUMN password_hash TEXT')
  }

  const draftColumns = new Set(db.prepare('PRAGMA table_info(drafts)').all().map((column) => column.name))
  for (const [name, definition] of [
    ['review_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['reviewed_by', 'TEXT'],
    ['reviewed_at', 'INTEGER'],
    ['source', "TEXT NOT NULL DEFAULT 'website'"],
    ['submitted_at', 'INTEGER'],
    ['payment_method', 'TEXT'],
    ['utr_number', 'TEXT'],
    ['amount_rupees', 'INTEGER'],
    ['proof_mime', 'TEXT'],
    ['proof_data', 'BLOB'],
    ['email_status', 'TEXT'],
    ['email_sent_count', 'INTEGER DEFAULT 0'],
    ['email_failed_count', 'INTEGER DEFAULT 0'],
    ['email_last_attempt_at', 'INTEGER'],
    ['email_last_error', 'TEXT'],
    ['email_first_sent_at', 'INTEGER'],
  ]) {
    if (!draftColumns.has(name)) db.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${definition}`)
  }
  // One UPI payment can only pay for one team.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS drafts_utr_number ON drafts(utr_number) WHERE utr_number IS NOT NULL')

  initEmailTables(db)
  initProblemStatementsTable(db)
  initInvitationsTable(db)

  const apiLimiter = new RateLimiter({ windowMs: 60 * 1000, maxRequests: 300 })
  const loginLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 25 })
  const submitLimiter = new RateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 15 })
  const draftLimiter = new RateLimiter({ windowMs: 60 * 1000, maxRequests: 60 })

  const adminEventClients = new Set()

  function notifyAdminClients(type = 'update') {
    const payload = `event: ${type}\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
    for (const client of adminEventClients) {
      try {
        client.write(payload)
      } catch {
        adminEventClients.delete(client)
      }
    }
  }

  function triggerEmailQueue() {
    setImmediate(() => {
      processEmailQueue(db, mailer, {
        secrets: [process.env.SMTP_PASS, process.env.SMTP_USER],
      })
        .then(() => notifyAdminClients('email_update'))
        .catch((err) => {
          if (!err.message?.includes('database is not open')) {
            console.error('[email-queue] Background queue processing error:', err.message)
          }
        })
    })
  }

  // Drain any pending/retry items on startup
  triggerEmailQueue()

  const rules = rulesFromEnvironment()

  function getSystemSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key)
    return row ? row.value : fallback
  }

  function setSystemSetting(key, val) {
    const now = Date.now()
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(val), now)
  }

  const isRegistrationOpen = () => getSystemSetting('registration_open', rules.submissionEnabled ? 'true' : 'false') === 'true'
  const isProblemStatementsReleased = () => getSystemSetting('problem_statements_released', 'false') === 'true'

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

  const allRegistrations = () => db.prepare("SELECT receipt, revision, data, source, review_status, reviewed_by, reviewed_at, submitted_at, payment_method, utr_number, amount_rupees, proof_mime IS NOT NULL AS has_proof, email_status, email_sent_count, email_failed_count, email_last_attempt_at, email_last_error FROM drafts WHERE status = 'submitted' ORDER BY submitted_at DESC").all()
  const amountFor = (data) => rules.feePerPerson * (data.members.length + 1)

  // Reads the payment part of a request. Cash at the desk has no UTR or screenshot; UPI needs a unique 12-digit UTR.
  function readPayment(input, { requireProof, receipt = null }) {
    const method = input?.paymentMethod ?? 'upi'
    if (method !== 'upi' && method !== 'cash') return { problem: 'payment method must be upi or cash' }
    if (method === 'cash') return { payment: { method, utr: null, proof: null } }
    const utr = typeof input?.utrNumber === 'string' ? input.utrNumber.trim() : ''
    if (!/^\d{12}$/.test(utr)) return { problem: 'Enter the 12-digit UTR number from the UPI payment.' }
    if (db.prepare('SELECT 1 FROM drafts WHERE utr_number = ? AND receipt IS NOT ?').get(utr, receipt)) return { problem: 'This UTR number has already been used for another registration.' }
    let proof = null
    if (input?.screenshotDataUrl !== undefined && input.screenshotDataUrl !== null) {
      proof = paymentProofFromDataUrl(input.screenshotDataUrl)
      if (!proof) return { problem: 'The payment screenshot must be a PNG, JPEG or WebP image of 2 MB or less.' }
    } else if (requireProof) {
      return { problem: 'Upload the payment screenshot.' }
    }
    return { payment: { method, utr, proof } }
  }

  function currentAdmin(req) {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[adminCookieName] || cookies['kgrcet_admin']
    if (!token) return null
    const now = Date.now()
    const tokenHash = hashToken(token)
    const row = db.prepare('SELECT email, name, absolute_expires_at, password_hash FROM admin_sessions WHERE token_hash = ?').get(tokenHash)
    if (!row) return null

    if (row.absolute_expires_at > 0 && now >= row.absolute_expires_at) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash)
      return null
    }

    const accounts = parseAdminAccounts(configuredAdminAccounts) || []
    const account = accounts.find((candidate) => candidate.email.toLowerCase() === row.email.toLowerCase())
    if (!account || (row.password_hash && row.password_hash !== account.passwordHash)) {
      db.prepare('DELETE FROM admin_sessions WHERE LOWER(email) = LOWER(?)').run(row.email)
      return null
    }

    db.prepare('UPDATE admin_sessions SET last_active_at = ? WHERE token_hash = ?').run(now, tokenHash)

    return { email: row.email, name: row.name, token }
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
      (candidate.username && candidate.username.toLowerCase() === normalizedIdentifier) ||
      (candidate.aliases && candidate.aliases.some((alias) => alias.toLowerCase() === normalizedIdentifier))
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

    // Clean expired sessions (only if an absolute expiry limit is configured)
    db.prepare('DELETE FROM admin_sessions WHERE absolute_expires_at > 0 AND absolute_expires_at <= ?').run(now)

    // Remove any pre-existing session token from this client's cookie
    const oldCookies = parseCookies(req.headers.cookie)
    const oldToken = oldCookies[adminCookieName] || oldCookies['kgrcet_admin']
    if (oldToken) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(oldToken))
    }

    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const maxHours = getAdminSessionMaxHours(process.env)
    const absExpiry = maxHours > 0 ? now + Math.round(maxHours * 3600 * 1000) : 0

    db.prepare('INSERT INTO admin_sessions (token_hash, email, name, created_at, last_active_at, absolute_expires_at, idle_expires_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(tokenHash, matchedAccount.email, matchedAccount.name, now, now, absExpiry, 0, matchedAccount.passwordHash)

    return json(
      res,
      200,
      { session: { email: matchedAccount.email, name: matchedAccount.name } },
      { 'Set-Cookie': adminCookie(token, ADMIN_COOKIE_MAX_AGE, secure) }
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
      const ip = clientIp(req)
      const loginCheck = loginLimiter.check(ip)
      if (!loginCheck.allowed) {
        res.setHeader('Retry-After', String(loginCheck.retryAfterSeconds))
        return error(res, 429, 'Too many login attempts. Please wait before trying again.')
      }
      return adminLogin(req, res)
    }

    // 3. Admin session check endpoint
    if (url.pathname === '/api/admin/session' && req.method === 'GET') {
      const admin = currentAdmin(req)
      if (admin) {
        res.setHeader('Set-Cookie', adminCookie(admin.token, ADMIN_COOKIE_MAX_AGE, secure))
        return json(res, 200, { session: { email: admin.email, name: admin.name } })
      }
      return json(res, 200, { session: null })
    }

    // 4. DENY BY DEFAULT: Every other /api/admin/* route denies without a valid session
    const admin = currentAdmin(req)
    if (!admin) return error(res, 401, 'admin session required')

    if (url.pathname !== '/api/admin/logout' && url.pathname !== '/api/admin/logout-all') {
      res.setHeader('Set-Cookie', adminCookie(admin.token, ADMIN_COOKIE_MAX_AGE, secure))
    }

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

    // 8. Real-time SSE stream for connected admin dashboard
    if (url.pathname === '/api/admin/registrations/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      adminEventClients.add(res)

      const keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n')
        } catch {
          clearInterval(keepAliveTimer)
          adminEventClients.delete(res)
        }
      }, 25000)

      req.on('close', () => {
        clearInterval(keepAliveTimer)
        adminEventClients.delete(res)
      })
      return
    }

    // 9. View registrations
    if (url.pathname === '/api/admin/registrations' && req.method === 'GET') {
      const draftsInProgress = db.prepare("SELECT data FROM drafts WHERE status = 'draft'").all().filter(({ data }) => {
        const draft = JSON.parse(data)
        return draft.members.length > 0 || ['teamName', 'teamSize', 'college', 'collegeCode', 'leadName', 'email', 'phone'].some((field) => draft[field] && draft[field].trim())
      }).length
      return json(res, 200, {
        registrations: allRegistrations().map(publicRegistration),
        draftsInProgress,
        rules: { ...rules, submissionEnabled: isRegistrationOpen() },
        registrationOpen: isRegistrationOpen(),
        problemStatementsReleased: isProblemStatementsReleased(),
      })
    }

    // 9a. Export registrations as CSV
    if ((url.pathname === '/api/admin/registrations.csv' || url.pathname === '/api/admin/registrations/export.csv') && req.method === 'GET') {
      const all = allRegistrations()
      const methodLabels = { upi: 'UPI', cash: 'Cash' }
      const statusLabels = { pending: 'Pending', valid: 'Valid', invalid: 'Invalid' }
      const rows = [
        ['Receipt', 'Team', 'Domain', 'Team Size', 'Role', 'Name', 'Email', 'Phone', 'Roll Number', 'Gender', 'Year', 'College', 'College Code', 'Course', 'Food Preference', 'Amount (INR)', 'Payment Method', 'UTR', 'Screenshot', 'Status', 'Email Status', 'Emails Sent', 'Emails Failed', 'Last Email Attempt', 'Reviewed By', 'Source', 'Submitted At']
      ]
      for (const row of all) {
        const reg = publicRegistration(row)
        const d = reg.data || {}
        const domain = d.domain || d.track || ''
        const members = Array.isArray(d.members) ? d.members : []
        const peopleCount = members.length + 1
        const person = (role, m, name) => [
          reg.receipt, d.teamName || '', domain, String(peopleCount), role, name || '', m.email || '', m.phone || '', m.rollNumber || '', m.gender || '',
          m.year || '', m.college || '', m.collegeCode || '', m.courseName || '', m.foodPreference || '',
        ]
        rows.push([
          ...person('Leader', d, d.leadName),
          String(reg.amount), methodLabels[reg.paymentMethod] || reg.paymentMethod, reg.utrNumber || '', reg.hasPaymentProof ? 'Yes' : 'No',
          statusLabels[reg.reviewStatus] || reg.reviewStatus,
          reg.emailStatus ? reg.emailStatus.toUpperCase() : (reg.reviewStatus === 'valid' ? 'QUEUED' : 'NOT APPLICABLE'),
          String(reg.emailSentCount ?? 0),
          String(reg.emailFailedCount ?? 0),
          reg.emailLastAttemptAt ? new Date(reg.emailLastAttemptAt).toISOString() : '',
          reg.reviewedBy || '', reg.source, reg.submittedAt ? new Date(reg.submittedAt).toISOString() : '',
        ])
        for (const m of members) {
          rows.push([...person('Member', m, m.name), '', '', '', '', statusLabels[reg.reviewStatus] || reg.reviewStatus, '', '', '', '', '', reg.source, ''])
        }
      }
      const csvCell = (val) => {
        const str = String(val ?? '')
        const safe = /^[=+\-@\t\r|%]/.test(str) ? `'${str}` : str
        return `"${safe.replace(/"/g, '""')}"`
      }
      const csvContent = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="kgrcet-hackathon-registrations.csv"',
        'Cache-Control': 'no-store, max-age=0',
      })
      res.end(csvContent)
      return
    }

    // 9. Spot registration
    if (url.pathname === '/api/admin/registrations' && req.method === 'POST') {
      const input = await readJsonBody(req, maxPaymentBodyBytes)
      const problem = registrationProblem(input?.data)
      if (problem) return error(res, 400, problem)
      const { payment, problem: paymentIssue } = readPayment(input, { requireProof: false })
      if (paymentIssue) return error(res, 400, paymentIssue)
      const now = Date.now()
      const data = cleanRegistration(input.data)
      const tokenHash = hashToken(randomBytes(32).toString('hex'))
      const receipt = generateNextReceipt(db)
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, now, now + cookieTtlSeconds * 1000)
      db.prepare("INSERT INTO drafts (token_hash, data, step, status, receipt, revision, source, review_status, reviewed_by, reviewed_at, submitted_at, payment_method, utr_number, amount_rupees, proof_mime, proof_data, email_first_sent_at) VALUES (?, ?, 2, 'submitted', ?, 0, 'spot', 'valid', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(tokenHash, JSON.stringify(data), receipt, admin.email, now, now, payment.method, payment.utr, amountFor(data), payment.proof?.mime ?? null, payment.proof?.image ?? null, now)
      try {
        enqueueConfirmationEmails(db, receipt, { triggerType: 'status_valid' })
        triggerEmailQueue()
      } catch (queueErr) {
        console.error('[email-queue] Failed to enqueue spot confirmation emails:', queueErr.message)
      }
      notifyAdminClients('registration_created')
      return json(res, 201, { registration: publicRegistration(allRegistrations().find((row) => row.receipt === receipt)) })
    }

    // 10. Payment screenshot
    const proofMatch = /^\/api\/admin\/registrations\/([a-zA-Z0-9_-]{1,32})\/payment-proof$/.exec(url.pathname)
    if (proofMatch && req.method === 'GET') {
      const proof = db.prepare("SELECT proof_mime, proof_data FROM drafts WHERE receipt = ? AND status = 'submitted'").get(proofMatch[1])
      if (!proof?.proof_data) return error(res, 404, 'no payment screenshot for this registration')
      res.writeHead(200, {
        'Content-Type': proof.proof_mime,
        'Content-Disposition': `inline; filename="receipt-${proofMatch[1]}-proof"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      return res.end(Buffer.from(proof.proof_data))
    }

    // 11. Update registration or status
    const match = /^\/api\/admin\/registrations\/([a-zA-Z0-9_-]{1,32})(\/status)?$/.exec(url.pathname)
    if (match && req.method === 'PUT') {
      const [, receipt, isStatus] = match
      const existing = allRegistrations().find((row) => row.receipt === receipt)
      if (!existing) return error(res, 404, 'registration not found')
      const input = await readJsonBody(req, maxPaymentBodyBytes)
      if (isStatus) {
        if (!reviewStatuses.includes(input?.status)) return error(res, 400, 'invalid status')
        const now = Date.now()
        const isBecomingValid = input.status === 'valid' && existing.reviewStatus !== 'valid'

        db.prepare('UPDATE drafts SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE receipt = ?').run(input.status, admin.email, now, receipt)

        if (isBecomingValid) {
          // Idempotent duplicate protection: atomically set email_first_sent_at
          const claim = db.prepare('UPDATE drafts SET email_first_sent_at = ? WHERE receipt = ? AND email_first_sent_at IS NULL').run(now, receipt)
          if (claim.changes === 1) {
            try {
              enqueueConfirmationEmails(db, receipt, { triggerType: 'status_valid' })
              triggerEmailQueue()
            } catch (queueErr) {
              console.error('[email-queue] Failed to enqueue confirmation emails:', queueErr.message)
            }
          }
        }
      } else {
        if (!Number.isInteger(input?.revision)) return error(res, 400, 'invalid registration update')
        if (input.revision !== existing.revision) return error(res, 409, 'This registration changed in another tab. Reload and try again.')
        const problem = registrationProblem(input.data, receipt)
        if (problem) return error(res, 400, problem)
        // Payment details change only when the console sends them; a missing screenshot keeps the current one.
        const { payment, problem: paymentIssue } = input.paymentMethod === undefined ? {} : readPayment(input, { requireProof: false, receipt })
        if (paymentIssue) return error(res, 400, paymentIssue)
        const data = cleanRegistration(input.data)
        db.prepare('UPDATE drafts SET data = ?, amount_rupees = ?, revision = revision + 1 WHERE receipt = ?').run(JSON.stringify(data), amountFor(data), receipt)
        if (payment) {
          db.prepare('UPDATE drafts SET payment_method = ?, utr_number = ? WHERE receipt = ?').run(payment.method, payment.utr, receipt)
          if (payment.method === 'cash') db.prepare('UPDATE drafts SET proof_mime = NULL, proof_data = NULL WHERE receipt = ?').run(receipt)
          else if (payment.proof) db.prepare('UPDATE drafts SET proof_mime = ?, proof_data = ? WHERE receipt = ?').run(payment.proof.mime, payment.proof.image, receipt)
        }
      }
      notifyAdminClients('registration_updated')
      return json(res, 200, { registration: publicRegistration(allRegistrations().find((row) => row.receipt === receipt)) })
    }

    // 12. Manual Resend Email
    const resendMatch = /^\/api\/admin\/registrations\/([a-zA-Z0-9_-]{1,32})\/resend-email$/.exec(url.pathname)
    if (resendMatch && req.method === 'POST') {
      const receipt = resendMatch[1]
      const existing = allRegistrations().find((row) => row.receipt === receipt)
      if (!existing) return error(res, 404, 'registration not found')
      if (existing.review_status !== 'valid') {
        return error(res, 400, 'Confirmation emails can only be sent for valid registrations')
      }
      try {
        enqueueConfirmationEmails(db, receipt, { triggerType: 'manual_resend' })
        triggerEmailQueue()
        notifyAdminClients('email_update')
        const updated = allRegistrations().find((row) => row.receipt === receipt)
        return json(res, 200, { ok: true, registration: publicRegistration(updated) })
      } catch (err) {
        console.error('[email-queue] Manual resend failed to enqueue:', err.message)
        return error(res, 500, 'Could not enqueue confirmation emails')
      }
    }

    // 13. Test Email
    if (url.pathname === '/api/admin/test-email' && req.method === 'POST') {
      const input = await readJsonBody(req, maxLoginBodyBytes)
      const targetEmail = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
      if (!targetEmail || !isValidEmail(targetEmail)) {
        return error(res, 400, 'A valid email address is required.')
      }

      const sampleTeam = {
        teamName: 'CyberKnights (Sample)',
        leadName: admin.name || 'Test Participant',
        email: targetEmail,
        members: [
          { name: 'Alex Rivera', email: 'alex.test@kgrcet.edu.in' },
          { name: 'Sai Vaibhav', email: 'vaibhav.test@kgrcet.edu.in' },
        ],
      }
      const sampleContent = renderMemberConfirmationEmail({
        recipient: { name: admin.name || 'Test Participant', role: 'leader' },
        teamData: sampleTeam,
        receipt: '1001',
        amount: 1500,
      })

      const mailer = createSmtpTransport(process.env)
      try {
        const sendResult = await mailer.sendMail({
          from: mailer.from,
          to: `"${sanitizeHeader(admin.name || 'Test Participant')}" <${targetEmail}>`,
          subject: `[TEST] ${sampleContent.subject}`,
          html: sampleContent.html,
          text: sampleContent.text,
        })
        return json(res, 200, { ok: true, messageId: sendResult.messageId, dryRun: !mailer.isConfigured })
      } catch (sendErr) {
        const safeError = sanitizeErrorMessage(sendErr.message, [process.env.SMTP_PASS])
        console.error('[test-email] Failed to send test email:', safeError)
        return error(res, 500, `Failed to send email: ${safeError}`)
      }
    }

    // 14. Problem Statements Admin API
    if (url.pathname === '/api/admin/problem-statements' && req.method === 'GET') {
      const rows = db.prepare('SELECT id, track_id, statement_code, title, category, description, pdf_url, pdf_filename, is_active, display_order, created_at, updated_at FROM problem_statements ORDER BY display_order ASC, created_at ASC').all()
      const problemStatements = rows.map((r) => ({
        id: r.id,
        trackId: r.track_id,
        statementCode: r.statement_code,
        title: r.title,
        category: r.category || 'Software Projects',
        description: r.description || '',
        pdfUrl: r.pdf_url || `/api/problem-statements/${r.id}/pdf`,
        pdfFilename: r.pdf_filename || '',
        isActive: Boolean(r.is_active),
        displayOrder: r.display_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
      return json(res, 200, { problemStatements, problemStatementsReleased: isProblemStatementsReleased() })
    }

    if (url.pathname === '/api/admin/problem-statements' && req.method === 'POST') {
      const input = await readJsonBody(req, 10 * 1024 * 1024)
      if (!input?.trackId || !input?.statementCode || !input?.title) {
        return error(res, 400, 'Track, Statement Code, and Title are required.')
      }
      const now = Date.now()
      const id = randomBytes(16).toString('hex')
      const trackId = sanitizeInputText(input.trackId, 64)
      const statementCode = sanitizeInputText(input.statementCode, 32)
      const title = sanitizeInputText(input.title, 200)
      const category = sanitizeInputText(input.category || 'Software Projects', 100)
      const description = sanitizeInputText(input.description || '', 1000)
      let pdfUrl = typeof input.pdfUrl === 'string' ? input.pdfUrl.trim() : ''
      let pdfFilename = null
      let pdfMime = null
      let pdfData = null

      if (input.pdfFile && typeof input.pdfFile.base64 === 'string') {
        pdfFilename = sanitizeInputText(input.pdfFile.name || 'document.pdf', 150)
        pdfMime = input.pdfFile.mime || 'application/pdf'
        try {
          const rawBase64 = input.pdfFile.base64.includes(',') ? input.pdfFile.base64.split(',')[1] : input.pdfFile.base64
          pdfData = Buffer.from(rawBase64, 'base64')
          if (!pdfUrl) {
            pdfUrl = `/api/problem-statements/${id}/pdf`
          }
        } catch {
          return error(res, 400, 'Invalid PDF file upload.')
        }
      }

      const isActive = input.isActive === false ? 0 : 1
      const displayOrder = Number.isInteger(input.displayOrder) ? input.displayOrder : 0

      db.prepare(`
        INSERT INTO problem_statements (id, track_id, statement_code, title, category, description, pdf_url, pdf_filename, pdf_mime, pdf_data, is_active, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, trackId, statementCode, title, category, description, pdfUrl, pdfFilename, pdfMime, pdfData, isActive, displayOrder, now, now)

      notifyAdminClients('problem_statements_updated')
      return json(res, 201, {
        ok: true,
        problemStatement: {
          id, trackId, statementCode, title, category, description, pdfUrl, pdfFilename, isActive: Boolean(isActive), displayOrder, createdAt: now, updatedAt: now,
        }
      })
    }

    const psAdminMatch = /^\/api\/admin\/problem-statements\/([a-zA-Z0-9_-]{1,64})$/.exec(url.pathname)
    if (psAdminMatch && req.method === 'PUT') {
      const id = psAdminMatch[1]
      const existing = db.prepare('SELECT id FROM problem_statements WHERE id = ?').get(id)
      if (!existing) return error(res, 404, 'problem statement not found')

      const input = await readJsonBody(req, 10 * 1024 * 1024)
      const now = Date.now()
      const trackId = sanitizeInputText(input.trackId, 64)
      const statementCode = sanitizeInputText(input.statementCode, 32)
      const title = sanitizeInputText(input.title, 200)
      const category = sanitizeInputText(input.category || 'Software Projects', 100)
      const description = sanitizeInputText(input.description || '', 1000)
      let pdfUrl = typeof input.pdfUrl === 'string' ? input.pdfUrl.trim() : ''
      const isActive = input.isActive === false ? 0 : 1
      const displayOrder = Number.isInteger(input.displayOrder) ? input.displayOrder : 0

      if (input.pdfFile && typeof input.pdfFile.base64 === 'string') {
        const pdfFilename = sanitizeInputText(input.pdfFile.name || 'document.pdf', 150)
        const pdfMime = input.pdfFile.mime || 'application/pdf'
        const rawBase64 = input.pdfFile.base64.includes(',') ? input.pdfFile.base64.split(',')[1] : input.pdfFile.base64
        const pdfData = Buffer.from(rawBase64, 'base64')
        if (!pdfUrl) pdfUrl = `/api/problem-statements/${id}/pdf`
        db.prepare(`
          UPDATE problem_statements
          SET track_id = ?, statement_code = ?, title = ?, category = ?, description = ?, pdf_url = ?, pdf_filename = ?, pdf_mime = ?, pdf_data = ?, is_active = ?, display_order = ?, updated_at = ?
          WHERE id = ?
        `).run(trackId, statementCode, title, category, description, pdfUrl, pdfFilename, pdfMime, pdfData, isActive, displayOrder, now, id)
      } else {
        db.prepare(`
          UPDATE problem_statements
          SET track_id = ?, statement_code = ?, title = ?, category = ?, description = ?, pdf_url = ?, is_active = ?, display_order = ?, updated_at = ?
          WHERE id = ?
        `).run(trackId, statementCode, title, category, description, pdfUrl, isActive, displayOrder, now, id)
      }

      notifyAdminClients('problem_statements_updated')
      return json(res, 200, { ok: true })
    }

    if (psAdminMatch && req.method === 'DELETE') {
      const id = psAdminMatch[1]
      db.prepare('DELETE FROM problem_statements WHERE id = ?').run(id)
      notifyAdminClients('problem_statements_updated')
      return json(res, 200, { ok: true })
    }

    // 15. Toggle Registration Open / Closed
    if (url.pathname === '/api/admin/toggle-registration' && req.method === 'POST') {
      const input = await readJsonBody(req, 4 * 1024)
      if (typeof input?.password !== 'string' || !input.password) {
        return error(res, 400, 'Admin password is required to change registration status.')
      }
      const matchedAccount = configuredAdminAccounts.find((a) => a.email.toLowerCase() === admin.email.toLowerCase())
      const storedHash = matchedAccount?.passwordHash || admin.passwordHash
      if (!storedHash || !verifyPassword(input.password, storedHash)) {
        return error(res, 403, 'Incorrect admin password. Registration status unchanged.')
      }
      const enabled = Boolean(input.enabled)
      setSystemSetting('registration_open', enabled ? 'true' : 'false')
      notifyAdminClients('system_settings_updated')
      return json(res, 200, { ok: true, registrationOpen: enabled })
    }

    // 16. Toggle Problem Statements Release
    if (url.pathname === '/api/admin/toggle-ps-release' && req.method === 'POST') {
      const input = await readJsonBody(req, 4 * 1024)
      const released = Boolean(input?.released)
      setSystemSetting('problem_statements_released', released ? 'true' : 'false')
      notifyAdminClients('problem_statements_updated')
      return json(res, 200, { ok: true, problemStatementsReleased: released })
    }

    // 17. Invitations: Get predefined templates
    if (url.pathname === '/api/admin/invitations/templates' && req.method === 'GET') {
      return json(res, 200, { templates: INVITATION_TEMPLATES })
    }

    // 18. Invitations: List all invitations and stats
    if (url.pathname === '/api/admin/invitations' && req.method === 'GET') {
      const rows = db.prepare('SELECT * FROM invitations ORDER BY created_at DESC').all()
      const total = rows.length
      const delivered = rows.filter((r) => r.status === 'delivered').length
      const sent = rows.filter((r) => r.status === 'sent').length
      const pending = rows.filter((r) => r.status === 'pending').length
      const failed = rows.filter((r) => r.status === 'failed').length
      return json(res, 200, {
        invitations: rows.map(publicInvitation),
        stats: { total, delivered, sent, pending, failed },
      })
    }

    // 19. Invitations: Render live preview
    if (url.pathname === '/api/admin/invitations/preview' && req.method === 'POST') {
      const input = await readJsonBody(req, 100 * 1024)
      const rendered = renderInvitationEmail({
        recipientName: input?.recipientName,
        designation: input?.designation,
        institution: input?.institution,
        category: input?.category,
        templateKey: input?.templateKey,
        subject: input?.subject,
        message: input?.message,
        event: { ...EVENT_DETAILS, logoUrl: '/assets/kgrcet-logo.png' },
      })
      return json(res, 200, rendered)
    }

    // 19b. Invitations: Serve HTML preview directly for opening in a new tab
    const invitePreviewMatch = /^\/api\/admin\/invitations\/([a-zA-Z0-9_-]{1,64})\/preview$/.exec(url.pathname)
    if (invitePreviewMatch && req.method === 'GET') {
      const id = invitePreviewMatch[1]
      const existing = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
      if (!existing) return error(res, 404, 'invitation not found')

      const rendered = renderInvitationEmail({
        recipientName: existing.recipient_name,
        designation: existing.designation,
        institution: existing.institution,
        category: existing.category,
        templateKey: existing.template_key,
        subject: existing.subject,
        message: existing.message,
        event: { ...EVENT_DETAILS, logoUrl: '/assets/kgrcet-logo.png' },
      })

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      })
      res.end(rendered.html)
      return
    }

    // 20. Invitations: Create & dispatch (or send test)
    if (url.pathname === '/api/admin/invitations' && req.method === 'POST') {
      const input = await readJsonBody(req, 100 * 1024)
      const now = Date.now()
      const isTest = Boolean(input?.isTest)
      const recipientName = sanitizeInputText(input?.recipientName || 'Sir / Madam', 120)
      const designation = sanitizeInputText(input?.designation || 'Academic Dignitary', 120)
      const institution = sanitizeInputText(input?.institution || 'KG Reddy College of Engineering & Technology', 200)
      const category = sanitizeInputText(input?.category || 'Internal College', 50)
      const templateKey = sanitizeInputText(input?.templateKey || 'internal', 50)
      const customSubject = input?.subject ? sanitizeInputText(input.subject, 200) : undefined
      const customMessage = input?.message ? String(input.message).slice(0, 5000) : undefined

      // Case 1: Send test email to current admin
      if (isTest) {
        const testTarget = admin.email
        if (!isValidEmail(testTarget)) {
          return error(res, 400, 'Invalid admin email address for test email')
        }
        const rendered = renderInvitationEmail({
          recipientName: recipientName || admin.name,
          designation,
          institution,
          category,
          templateKey,
          subject: customSubject ? `[TEST] ${customSubject}` : undefined,
          message: customMessage,
        })
        try {
          await mailer.sendMail({
            from: mailer.from,
            to: `"${sanitizeHeader(recipientName || admin.name || 'Invited Dignitary')}" <${testTarget}>`,
            replyTo: EVENT_DETAILS.contactEmail || 'cseh@kgrcet.edu.in',
            subject: rendered.subject.startsWith('[TEST]') ? rendered.subject : `[TEST] ${rendered.subject}`,
            text: rendered.text,
            headers: {
              'X-Priority': '1',
              'Importance': 'high',
            },
          })
          recordAuditLog({
            ip: clientIp(req),
            email: admin.email,
            result: `test_invitation_dispatched:${testTarget}`,
            userAgent: req.headers['user-agent'],
          })
          return json(res, 200, { ok: true, isTest: true, sentTo: testTarget })
        } catch (err) {
          return error(res, 500, `Failed to dispatch test email: ${sanitizeErrorMessage(err)}`)
        }
      }

      // Case 2: Send actual invitation to one or more recipients
      const rawEmails = String(input?.email || input?.emails || '')
      const emailList = Array.from(
        new Set(
          rawEmails
            .split(/[\n,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.length > 0)
        )
      )

      if (emailList.length === 0) {
        return error(res, 400, 'At least one recipient email address is required.')
      }

      const invalidEmails = emailList.filter((e) => !isValidEmail(e))
      if (invalidEmails.length > 0) {
        return error(res, 400, `Invalid email address(es): ${invalidEmails.slice(0, 3).join(', ')}`)
      }

      // Confirmation required before sending to multiple recipients
      if (emailList.length > 1 && !input?.confirmMultiple) {
        return json(res, 400, {
          requireConfirmation: true,
          count: emailList.length,
          message: `Sending to ${emailList.length} recipients requires explicit confirmation.`,
        })
      }

      // Duplicate protection: warn if already invited
      const existing = db.prepare(`SELECT email, created_at, status FROM invitations WHERE LOWER(email) IN (${emailList.map(() => '?').join(',')})`).all(...emailList)
      if (existing.length > 0 && !input?.allowDuplicate) {
        return json(res, 409, {
          warning: 'duplicate',
          duplicates: existing,
          message: `Duplicate warning: ${existing.length} recipient(s) already received an invitation (${existing.map((e) => e.email).slice(0, 3).join(', ')}).`,
        })
      }

      const results = []
      const insertStmt = db.prepare(`
        INSERT INTO invitations (id, recipient_name, email, institution, designation, category, template_key, subject, message, status, sent_by, created_at, sent_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const targetEmail of emailList) {
        const id = randomBytes(16).toString('hex')
        const rendered = renderInvitationEmail({
          recipientName,
          designation,
          institution,
          category,
          templateKey,
          subject: customSubject,
          message: customMessage,
        })

        let status = 'sent'
        let lastError = null
        try {
          await mailer.sendMail({
            from: mailer.from,
            to: `"${sanitizeHeader(recipientName || 'Invited Dignitary')}" <${targetEmail}>`,
            replyTo: EVENT_DETAILS.contactEmail || 'cseh@kgrcet.edu.in',
            subject: rendered.subject,
            text: rendered.text,
            headers: {
              'X-Priority': '1',
              'Importance': 'high',
            },
          })
        } catch (err) {
          status = 'failed'
          lastError = sanitizeErrorMessage(err)
        }

        insertStmt.run(
          id,
          recipientName,
          targetEmail,
          institution,
          designation,
          category,
          templateKey,
          rendered.subject,
          customMessage || rendered.text,
          status,
          `${admin.name} (${admin.email})`,
          now,
          now,
          lastError
        )

        recordAuditLog({
          ip: clientIp(req),
          email: admin.email,
          result: `invitation_sent:${targetEmail} status:${status} by:${admin.email}`,
          userAgent: req.headers['user-agent'],
        })

        results.push({ id, email: targetEmail, status, lastError })
      }

      notifyAdminClients('invitations_updated')
      return json(res, 201, {
        ok: true,
        sentCount: results.filter((r) => r.status === 'sent').length,
        failedCount: results.filter((r) => r.status === 'failed').length,
        results,
      })
    }

    // 21. Invitations: Resend
    const invitationResendMatch = /^\/api\/admin\/invitations\/([a-zA-Z0-9_-]{1,64})\/resend$/.exec(url.pathname)
    if (invitationResendMatch && req.method === 'POST') {
      const id = invitationResendMatch[1]
      const existing = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
      if (!existing) return error(res, 404, 'invitation not found')

      const rendered = renderInvitationEmail({
        recipientName: existing.recipient_name,
        designation: existing.designation,
        institution: existing.institution,
        category: existing.category,
        templateKey: existing.template_key,
        subject: existing.subject,
        message: existing.message,
        event: { ...EVENT_DETAILS, logoUrl: '/assets/kgrcet-logo.png' },
      })

      const now = Date.now()
      let status = 'sent'
      let lastError = null
      try {
        await mailer.sendMail({
          from: mailer.from,
          to: `"${sanitizeHeader(existing.recipient_name || 'Invited Dignitary')}" <${existing.email}>`,
          replyTo: EVENT_DETAILS.contactEmail || 'cseh@kgrcet.edu.in',
          subject: rendered.subject,
          text: rendered.text,
          headers: {
            'X-Priority': '1',
            'Importance': 'high',
          },
        })
      } catch (err) {
        status = 'failed'
        lastError = sanitizeErrorMessage(err)
      }

      db.prepare(`
        UPDATE invitations
        SET status = ?, sent_at = ?, sent_by = ?, last_error = ?
        WHERE id = ?
      `).run(status, now, `${admin.name} (${admin.email})`, lastError, id)

      recordAuditLog({
        ip: clientIp(req),
        email: admin.email,
        result: `invitation_resent:${existing.email} status:${status} by:${admin.email}`,
        userAgent: req.headers['user-agent'],
      })

      notifyAdminClients('invitations_updated')
      const updated = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
      return json(res, 200, { ok: true, invitation: publicInvitation(updated) })
    }

    // 22. Invitations: Update delivery status
    const invitationStatusMatch = /^\/api\/admin\/invitations\/([a-zA-Z0-9_-]{1,64})\/status$/.exec(url.pathname)
    if (invitationStatusMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
      const id = invitationStatusMatch[1]
      const existing = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
      if (!existing) return error(res, 404, 'invitation not found')

      const input = await readJsonBody(req, 4 * 1024)
      const allowedStatuses = ['delivered', 'sent', 'pending', 'failed']
      if (!allowedStatuses.includes(input?.status)) {
        return error(res, 400, 'Invalid status value.')
      }

      db.prepare('UPDATE invitations SET status = ? WHERE id = ?').run(input.status, id)
      recordAuditLog({
        ip: clientIp(req),
        email: admin.email,
        result: `invitation_status_change:${id} to:${input.status} by:${admin.email}`,
        userAgent: req.headers['user-agent'],
      })

      notifyAdminClients('invitations_updated')
      return json(res, 200, { ok: true })
    }

    // 23. Invitations: Delete
    const invitationDeleteMatch = /^\/api\/admin\/invitations\/([a-zA-Z0-9_-]{1,64})$/.exec(url.pathname)
    if (invitationDeleteMatch && req.method === 'DELETE') {
      const id = invitationDeleteMatch[1]
      db.prepare('DELETE FROM invitations WHERE id = ?').run(id)
      recordAuditLog({
        ip: clientIp(req),
        email: admin.email,
        result: `invitation_deleted:${id} by:${admin.email}`,
        userAgent: req.headers['user-agent'],
      })
      notifyAdminClients('invitations_updated')
      return json(res, 200, { ok: true })
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
      return JSON.parse(Buffer.concat(chunks).toString('utf8'), (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return undefined
        }
        return value
      })
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
        const ip = clientIp(req)
        const apiCheck = apiLimiter.check(ip)
        if (!apiCheck.allowed) {
          res.setHeader('Retry-After', String(apiCheck.retryAfterSeconds))
          res.setHeader('RateLimit-Limit', String(apiCheck.limit))
          res.setHeader('RateLimit-Remaining', '0')
          res.setHeader('RateLimit-Reset', String(apiCheck.retryAfterSeconds))
          return error(res, 429, 'Too many requests. Please slow down and try again later.')
        }

        if (req.method !== 'GET' && !isSameOrigin(req, secure)) return error(res, 403, 'same-origin request required')
        if (!['GET', 'PUT', 'POST', 'DELETE', 'PATCH'].includes(req.method)) return error(res, 405, 'method not allowed')
        if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url)

        // Public Problem Statements API
        if (url.pathname === '/api/problem-statements' && req.method === 'GET') {
          const released = isProblemStatementsReleased()
          const rows = released
            ? db.prepare('SELECT id, track_id, statement_code, title, category, description, pdf_url, pdf_filename, is_active, display_order FROM problem_statements WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC').all()
            : []
          const problemStatements = rows.map((r) => ({
            id: r.id,
            trackId: r.track_id,
            statementCode: r.statement_code,
            title: r.title,
            category: r.category || '',
            description: r.description || '',
            pdfUrl: r.pdf_url || `/api/problem-statements/${r.id}/pdf`,
            displayOrder: r.display_order,
          }))
          return json(res, 200, {
            problemStatements,
            registrationOpen: isRegistrationOpen(),
            problemStatementsReleased: released,
          })
        }

        const psPdfMatch = /^\/api\/problem-statements\/([a-zA-Z0-9_-]{1,64})\/pdf$/.exec(url.pathname)
        if (psPdfMatch && req.method === 'GET') {
          const row = db.prepare('SELECT pdf_data, pdf_mime, pdf_filename, pdf_url FROM problem_statements WHERE id = ?').get(psPdfMatch[1])
          if (!row) return error(res, 404, 'problem statement not found')
          if (row.pdf_data) {
            res.writeHead(200, {
              'Content-Type': row.pdf_mime || 'application/pdf',
              'Content-Disposition': `inline; filename="${row.pdf_filename || 'problem-statement.pdf'}"`,
              'Cache-Control': 'public, max-age=3600',
              'X-Content-Type-Options': 'nosniff',
            })
            return res.end(Buffer.from(row.pdf_data))
          }
          if (row.pdf_url) {
            res.writeHead(302, { Location: row.pdf_url })
            return res.end()
          }
          return error(res, 404, 'no PDF available for this problem statement')
        }

        if (url.pathname !== '/api/registration' && url.pathname !== '/api/registration/submit') return error(res, 404, 'not found')

        if (url.pathname === '/api/registration' && req.method === 'PUT') {
          const draftCheck = draftLimiter.check(ip)
          if (!draftCheck.allowed) {
            res.setHeader('Retry-After', String(draftCheck.retryAfterSeconds))
            return error(res, 429, 'Too many draft updates. Please slow down.')
          }
        } else if (url.pathname === '/api/registration/submit' && req.method === 'POST') {
          const submitCheck = submitLimiter.check(ip)
          if (!submitCheck.allowed) {
            res.setHeader('Retry-After', String(submitCheck.retryAfterSeconds))
            return error(res, 429, 'Too many submissions. Please wait before submitting again.')
          }
        }

        const tokenHash = req.method === 'GET' ? sessionFor(req, res) : existingSession(req)
        if (!tokenHash) return error(res, 401, 'resume cookie required')
        const current = () => db.prepare('SELECT data, step, status, receipt, revision FROM drafts WHERE token_hash = ?').get(tokenHash)
        if (req.method === 'GET') return json(res, 200, { draft: publicDraft(current()), rules: { ...rules, submissionEnabled: isRegistrationOpen() } })
        const input = await readJsonBody(req, url.pathname === '/api/registration/submit' ? maxPaymentBodyBytes : maxBodyBytes)
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
        if (!isRegistrationOpen()) return error(res, 403, 'submission is not enabled')
        if (input.revision !== row.revision) return json(res, 409, { error: 'revision conflict', draft: publicDraft(row) })
        // Checked and stored in cleaned form, so a phone typed with spaces still submits.
        const draftData = JSON.parse(row.data)
        // Cleaning recounts teamSize, so the size the team picked is compared with its members first.
        const problem = registrationProblem(draftData) || (draftData.members.length + 1 !== Number(draftData.teamSize) ? 'teamSize must match the lead and members' : null)
        if (problem) return error(res, 400, problem)
        const { payment, problem: paymentIssue } = readPayment({ ...input, paymentMethod: 'upi' }, { requireProof: true })
        if (paymentIssue) return error(res, 400, paymentIssue)
        const data = cleanRegistration(draftData)
        const receipt = generateNextReceipt(db)
        db.prepare("UPDATE drafts SET status = 'submitted', receipt = ?, submitted_at = ?, data = ?, payment_method = 'upi', utr_number = ?, amount_rupees = ?, proof_mime = ?, proof_data = ?, revision = revision + 1 WHERE token_hash = ? AND revision = ?")
          .run(receipt, Date.now(), JSON.stringify(data), payment.utr, amountFor(data), payment.proof.mime, payment.proof.image, tokenHash, input.revision)
        notifyAdminClients('registration_submitted')
        return json(res, 200, { draft: publicDraft(current()) })
      }
      if (req.method !== 'GET') return error(res, 404, 'not found')

      // Block paths with null bytes
      if (req.url.includes('%00') || req.url.includes('\0')) {
        return error(res, 400, 'invalid path')
      }

      // Block direct attempts to probe hidden dotfiles (.env, .git, .DS_Store, etc.)
      const pathSegments = url.pathname.split('/')
      if (pathSegments.some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..' && seg !== '.well-known')) {
        return error(res, 404, 'not found')
      }

      // Direct routes for email previews
      if (url.pathname === '/invitation-email-preview.html' || url.pathname === '/invitation-preview' || url.pathname === '/invite-preview') {
        const previewCandidates = [
          resolve(root, 'dist', 'invitation-email-preview.html'),
          resolve(root, 'public', 'invitation-email-preview.html'),
          resolve(root, 'invitation-email-preview.html'),
        ]
        for (const candidate of previewCandidates) {
          try {
            const content = await readFile(candidate)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            return res.end(content)
          } catch {}
        }
      }

      if (url.pathname === '/email-preview.html' || url.pathname === '/email-preview') {
        const previewCandidates = [
          resolve(root, 'dist', 'email-preview.html'),
          resolve(root, 'public', 'email-preview.html'),
          resolve(root, 'email-preview.html'),
        ]
        for (const candidate of previewCandidates) {
          try {
            const content = await readFile(candidate)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            return res.end(content)
          } catch {}
        }
      }

      const distDir = resolve(root, 'dist')
      const requested = url.pathname === '/' || url.pathname === '/register' ? 'index.html' : url.pathname.slice(1)
      const file = resolve(distDir, normalize(requested))

      // Strict directory traversal check
      if (file !== distDir && !file.startsWith(distDir + sep)) {
        return error(res, 404, 'not found')
      }

      let filePath = file
      try {
        const fileStat = await stat(filePath)
        if (fileStat.isDirectory()) {
          filePath = join(distDir, 'index.html')
        }
      } catch {
        filePath = join(distDir, 'index.html')
      }

      const content = await readFile(filePath)
      res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' })
      res.end(content)
    } catch (err) {
      const statusCode = err.statusCode || (err.message === 'request body too large' ? 413 : (err.message === 'invalid JSON' || err.message === 'JSON body required' ? 400 : 500))
      const safeMessage = statusCode === 500 ? 'Internal server error' : (err.message || 'invalid request')
      if (statusCode === 500) {
        console.error('[server error]', err)
      }
      error(res, statusCode, safeMessage)
    }
  })
  app.on('close', () => {
    for (const client of adminEventClients) {
      try { client.end() } catch {}
    }
    adminEventClients.clear()
    apiLimiter.destroy()
    loginLimiter.destroy()
    submitLimiter.destroy()
    draftLimiter.destroy()
    db.close()
  })
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    createApp().listen(port, '127.0.0.1', () => console.log(`server listening on ${port}`))
  } catch (err) {
    console.error(`Server failed to start: ${err.message}`)
    process.exit(1)
  }
}
