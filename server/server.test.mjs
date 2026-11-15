import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createApp, hashPassword, ALLOWED_ADMINS } from './server.mjs'
import { clearAdminSessions } from './clear-admin-sessions.mjs'
import { clearRegistrations } from './clear-registrations.mjs'
import { validatePasswordStrength } from './hash-admin-password.mjs'

const approved = { SUBMISSION_ENABLED: 'true', REGISTRATION_MIN_TEAM_SIZE: '2', REGISTRATION_MAX_TEAM_SIZE: '4' }
const blank = () => ({ teamName: '', teamSize: '', college: '', leadName: '', email: '', phone: '', members: [] })
const complete = () => ({ teamName: 'A', teamSize: '2', college: 'C', leadName: 'L', email: 'lead@example.com', phone: '+919876543210', members: [{ name: 'M', email: 'member@example.com', college: 'C' }] })

// A real 1x1 PNG, the smallest payment screenshot the server accepts.
const screenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const newUtr = () => String(100000000000 + Math.floor(Math.random() * 899999999999))
const upi = () => ({ utrNumber: newUtr(), screenshotDataUrl: screenshot })

const randomPassword = () => `${randomBytes(16).toString('hex')}Aa1!`
const testAdminPassword = randomPassword()
const testAdminEmail = 'saivaibhavaluguri@gmail.com'
const testAdminSecondaryPassword = randomPassword()
const testJashanthPassword = randomPassword()

const makeTestAccounts = (pw1 = testAdminPassword, pw2 = testJashanthPassword) => [
  { email: 'saivaibhavaluguri@gmail.com', name: 'Aluguri SaiVaibhav', passwordHash: hashPassword(pw1) },
  { email: 'jashanthgonipati@gmail.com', username: 'jashanth', name: 'Jashanth Gonipati', passwordHash: hashPassword(pw2) },
]

async function fixture(t, rules = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'registration-'))
  let app, base
  const close = async () => { if (app?.listening) await new Promise((resolve) => app.close(resolve)) }
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }) })
  async function start() {
    const previous = {}
    try {
      for (const key of [...Object.keys(approved), 'NODE_ENV', 'PUBLIC_ORIGIN', 'TRUST_PROXY', 'ADMIN_ACCOUNTS_JSON', 'ADMIN_SESSION_IDLE_MINUTES', 'ADMIN_SESSION_MAX_HOURS']) {
        previous[key] = process.env[key]
        if (rules[key] === undefined) delete process.env[key]
        else process.env[key] = rules[key]
      }
      app = createApp({ dbPath: join(dir, 'test.sqlite'), adminAccounts: makeTestAccounts() })
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${app.address().port}`
  }
  await start()
  return {
    restart: async () => { await close(); await start() },
    async request(method = 'GET', payload, cookie, headers = {}, path = '/api/registration') {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers }
    },
    async submit(revision, cookie, payment = upi()) { return this.request('POST', { revision, ...payment }, cookie, {}, '/api/registration/submit') },
  }
}

test('partial and empty drafts persist data, step, revision, and cookie authorization across restart', async (t) => {
  const f = await fixture(t)
  const initial = await f.request()
  const cookie = initial.cookie.split(';')[0]
  assert.match(initial.cookie, /HttpOnly/)
  assert.match(initial.cookie, /SameSite=Strict/)
  assert.match(initial.cookie, /Max-Age=2592000/)
  assert.deepEqual(initial.body.rules, { minTeamSize: null, maxTeamSize: null, feePerPerson: 649, submissionEnabled: false })
  const empty = await f.request('PUT', { data: blank(), step: 0, revision: 0 }, cookie)
  assert.equal(empty.status, 200)
  const data = { ...blank(), teamName: 'Partial', members: [{ name: 'M', email: '', college: '' }] }
  const saved = await f.request('PUT', { data, step: 2, revision: 1 }, cookie)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.draft.revision, 2)
  assert.equal((await f.request('PUT', { data: blank(), step: 0, revision: 1 }, cookie)).status, 409)
  await f.restart()
  const resumed = await f.request('GET', undefined, cookie)
  assert.equal(resumed.cookie, null)
  assert.deepEqual(resumed.body.draft, saved.body.draft)
  assert.equal(resumed.body.draft.step, 2)
  const other = await f.request()
  assert.notEqual(other.cookie.split(';')[0], cookie)
  assert.deepEqual(other.body.draft.data, blank())
  assert.deepEqual((await f.request('GET', undefined, cookie)).body.draft.data, data)
})

test('malformed partial drafts are rejected at every step without changing revision', async (t) => {
  const f = await fixture(t)
  const cookie = (await f.request()).cookie.split(';')[0]
  for (const data of [null, [], {}, { ...blank(), phone: 42 }, { ...blank(), members: {} }, { ...blank(), members: [null] }, { ...blank(), members: [{ name: '', email: '' }] }, { ...blank(), members: [{ name: '', email: [], college: '' }] }]) {
    for (const step of [0, 1, 2]) {
      assert.equal((await f.request('PUT', { data, step, revision: 0 }, cookie)).status, 400)
    }
  }
  assert.equal((await f.request('GET', undefined, cookie)).body.draft.revision, 0)
})

test('cookie-less writes, foreign/missing origins, and non-JSON bodies are denied', async (t) => {
  const f = await fixture(t)
  const input = { data: blank(), step: 0, revision: 0 }
  const denied = await f.request('PUT', input)
  assert.equal(denied.status, 401)
  assert.equal(denied.cookie, null)
  assert.equal((await f.submit(0)).status, 401)
  assert.equal((await f.request('PUT', input, 'registration_resume=forged')).status, 401)
  const cookie = (await f.request()).cookie.split(';')[0]
  for (const Origin of ['', 'null', 'https://attacker.example']) {
    assert.equal((await f.request('PUT', input, cookie, { Origin })).status, 403)
  }
  assert.equal((await f.request('PUT', input, cookie, { 'Content-Type': 'text/plain' })).status, 400)
  assert.equal((await f.submit(0, cookie)).status, 403)
})

test('submission fails closed unless both approved bounds are valid and ordered', async (t) => {
  for (const rules of [
    {}, { SUBMISSION_ENABLED: 'true' },
    { ...approved, REGISTRATION_MIN_TEAM_SIZE: undefined },
    { ...approved, REGISTRATION_MAX_TEAM_SIZE: undefined },
    { ...approved, REGISTRATION_MIN_TEAM_SIZE: '0' },
    { ...approved, REGISTRATION_MAX_TEAM_SIZE: '2.5' },
    { ...approved, REGISTRATION_MIN_TEAM_SIZE: '5' },
    { ...approved, REGISTRATION_MAX_TEAM_SIZE: 'invalid' },
    { ...approved, SUBMISSION_ENABLED: 'false' },
  ]) {
    const f = await fixture(t, rules)
    const initial = await f.request()
    assert.equal(initial.body.rules.submissionEnabled, false)
    assert.equal((await f.submit(0, initial.cookie.split(';')[0])).status, 403)
  }
})

test('enabled submission validates phone, unique emails, required fields, and configured team size', async (t) => {
  const f = await fixture(t, approved)
  const cookie = (await f.request()).cookie.split(';')[0]
  let revision = 0
  const cases = [
    [{ ...complete(), phone: '123' }, /phone/],
    [{ ...complete(), phone: '12345678abc' }, /phone/],
    [{ ...complete(), members: [{ name: 'M', email: 'LEAD@example.com', college: 'C' }] }, /unique/],
    [{ ...complete(), teamSize: '3', members: [{ name: 'M', email: 'm@example.com', college: 'C' }, { name: 'N', email: 'M@example.com', college: 'C' }] }, /unique/],
    [{ ...complete(), leadName: '' }, /required/],
    [{ ...complete(), teamSize: '1', members: [] }, /minimum/],
    [{ ...complete(), teamSize: '3' }, /match/],
  ]
  for (const [data, message] of cases) {
    const saved = await f.request('PUT', { data, step: 2, revision }, cookie)
    assert.equal(saved.status, 200)
    revision = saved.body.draft.revision
    const submitted = await f.submit(revision, cookie)
    assert.equal(submitted.status, 400)
    assert.match(submitted.body.error, message)
  }
})

test('enabled submission is persistent and idempotent even when retrying a stale revision', async (t) => {
  const f = await fixture(t, approved)
  const initial = await f.request()
  assert.equal(initial.body.rules.submissionEnabled, true)
  const cookie = initial.cookie.split(';')[0]
  const saved = await f.request('PUT', { data: complete(), step: 2, revision: 0 }, cookie)
  assert.equal(saved.status, 200)
  assert.equal((await f.submit(0, cookie)).status, 409)
  const submitted = await f.submit(1, cookie)
  assert.equal(submitted.status, 200)
  assert.equal(submitted.body.draft.status, 'submitted')
  assert.ok(submitted.body.draft.receipt)
  assert.equal(submitted.body.draft.revision, 2)
  await f.restart()
  for (const revision of [1, 0, 2]) {
    const repeated = await f.submit(revision, cookie)
    assert.equal(repeated.status, 200)
    assert.deepEqual(repeated.body.draft, submitted.body.draft)
  }
  assert.equal((await f.request('PUT', { data: blank(), step: 0, revision: 2 }, cookie)).status, 409)
})

test('approved teams larger than twenty members can save and submit', async (t) => {
  const f = await fixture(t, { ...approved, REGISTRATION_MAX_TEAM_SIZE: '30' })
  const cookie = (await f.request()).cookie.split(';')[0]
  const data = { ...complete(), teamSize: '22', members: Array.from({ length: 21 }, (_, i) => ({ name: `M${i}`, email: `m${i}@example.com`, college: 'C' })) }
  assert.equal((await f.request('PUT', { data, step: 2, revision: 0 }, cookie)).status, 200)
  assert.equal((await f.submit(1, cookie)).status, 200)
})

async function adminFixture(t, adminAccounts = makeTestAccounts(), env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'admin-'))
  const dbPath = join(dir, 'test.sqlite')
  let app, base
  const keysToTrack = ['NODE_ENV', 'PUBLIC_ORIGIN', 'TRUST_PROXY', 'ADMIN_ACCOUNTS_JSON', 'ADMIN_SESSION_IDLE_MINUTES', 'ADMIN_SESSION_MAX_HOURS', ...Object.keys(env)]
  const previousEnv = {}
  for (const key of keysToTrack) {
    previousEnv[key] = process.env[key]
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  const close = async () => { if (app?.listening) await new Promise((resolve) => app.close(resolve)) }
  t.after(async () => {
    await close()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(dir, { recursive: true, force: true })
  })

  async function start(accounts = adminAccounts) {
    app = createApp({ dbPath, adminAccounts: accounts })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${app.address().port}`
  }

  await start()

  const call = async (method, path, payload, cookie, headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const text = await response.text()
    let body = text
    try { body = JSON.parse(text) } catch {}
    return { status: response.status, body, cookie: response.headers.get('set-cookie'), headers: response.headers }
  }

  const login = async (email = testAdminEmail, password = testAdminPassword) => {
    const res = await call('POST', '/api/admin/login', { email, password })
    return res.cookie ? res.cookie.split(';')[0] : null
  }

  return { call, login, base, dbPath, restart: async (newAccounts) => { await close(); await start(newAccounts) } }
}

test('admin login sets a hardened session cookie and logout ends it', async (t) => {
  const f = await adminFixture(t)
  assert.deepEqual((await f.call('GET', '/api/admin/session')).body, { session: null })

  const signedIn = await f.call('POST', '/api/admin/login', { email: ' SAIVAIBHAVALUGURI@GMAIL.COM ', password: testAdminPassword })
  assert.equal(signedIn.status, 200)
  assert.deepEqual(signedIn.body.session, { email: 'saivaibhavaluguri@gmail.com', name: 'Aluguri SaiVaibhav' })
  // Non-production (no Secure flag), so the cookie must not use the __Host- prefix browsers would reject.
  assert.match(signedIn.cookie, /^kgrcet_admin=/)
  assert.match(signedIn.cookie, /HttpOnly/)
  assert.match(signedIn.cookie, /SameSite=Strict/)
  assert.match(signedIn.cookie, /Path=\//)
  assert.match(signedIn.cookie, /Max-Age=31536000/)

  const cookie = signedIn.cookie.split(';')[0]
  const sessionCheck = await f.call('GET', '/api/admin/session', undefined, cookie)
  assert.equal(sessionCheck.body.session.name, 'Aluguri SaiVaibhav')
  assert.match(sessionCheck.cookie, /Max-Age=31536000/)
  assert.equal((await f.call('POST', '/api/admin/logout', {}, cookie)).status, 200)
  assert.deepEqual((await f.call('GET', '/api/admin/session', undefined, cookie)).body, { session: null })
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie)).status, 401)

  // Verify login by username
  const jashanthByUsername = await f.call('POST', '/api/admin/login', { identifier: 'jashanth', password: testJashanthPassword })
  assert.equal(jashanthByUsername.status, 200)
  assert.deepEqual(jashanthByUsername.body.session, { email: 'jashanthgonipati@gmail.com', name: 'Jashanth Gonipati' })

  // Verify login by email
  const jashanthByEmail = await f.call('POST', '/api/admin/login', { identifier: 'jashanthgonipati@gmail.com', password: testJashanthPassword })
  assert.equal(jashanthByEmail.status, 200)

  // Verify login by alias
  const jashanthByAlias = await f.call('POST', '/api/admin/login', { identifier: 'jashanth@ikarus.kgrcet.ac.in', password: testJashanthPassword })
  assert.equal(jashanthByAlias.status, 200)
  assert.deepEqual(jashanthByAlias.body.session, { email: 'jashanthgonipati@gmail.com', name: 'Jashanth Gonipati' })
})

test('admin endpoints reject anonymous, forged, and cross-origin requests', async (t) => {
  const f = await adminFixture(t)
  assert.equal((await f.call('GET', '/api/admin/registrations')).status, 401)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete() })).status, 401)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, '__Host-admin=forged')).status, 401)
  assert.equal((await f.call('PUT', '/api/admin/registrations/REG-0000000000000000/status', { status: 'valid' })).status, 401)

  const cookie = await f.login()
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete() }, cookie, { Origin: 'https://attacker.example' })).status, 403)
  assert.equal((await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, { Origin: 'https://attacker.example' })).status, 403)
})

test('repeated failed logins lock that target in SQLite, and unknown emails get the exact same answer', async (t) => {
  const f = await adminFixture(t)
  const wrong = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: 'wrong-password-candidate' })
  const unknown = await f.call('POST', '/api/admin/login', { email: 'nobody@example.edu', password: 'wrong-password-candidate' })
  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, 401)
  assert.deepEqual(wrong.body, { error: 'Invalid credentials' })
  assert.deepEqual(unknown.body, { error: 'Invalid credentials' })

  // 3 more failed attempts (total 4)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: 'wrong-password-candidate' })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid credentials' })
  }

  // 5th failed attempt triggers lockout
  const fifth = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: 'wrong-password-candidate' })
  assert.equal(fifth.status, 401)
  assert.deepEqual(fifth.body, { error: 'Invalid credentials' })

  // Locked attempt with correct credentials still returns generic 401
  const correctWhileLocked = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword })
  assert.equal(correctWhileLocked.status, 401)
  assert.deepEqual(correctWhileLocked.body, { error: 'Invalid credentials' })
  assert.equal(correctWhileLocked.cookie, null)

  // Verify lockout persistence across server restart
  await f.restart()
  const afterRestart = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword })
  assert.equal(afterRestart.status, 401)
  assert.deepEqual(afterRestart.body, { error: 'Invalid credentials' })
})

test('missing or invalid admin configuration fails closed', async (t) => {
  const none = await adminFixture(t, [])
  assert.equal((await none.call('POST', '/api/admin/login', { email: 'a@b.co', password: 'x' })).status, 503)

  const broken = await adminFixture(t, '{not json')
  assert.equal((await broken.call('POST', '/api/admin/login', { email: 'a@b.co', password: 'x' })).status, 503)

  // In production, server refuses to start with missing, empty, or invalid hash configuration
  const prevNodeEnv = process.env.NODE_ENV
  const prevAdminJson = process.env.ADMIN_ACCOUNTS_JSON
  try {
    process.env.NODE_ENV = 'production'
    delete process.env.ADMIN_ACCOUNTS_JSON
    assert.throws(() => createApp(), /ADMIN_ACCOUNTS_JSON is required/)

    process.env.ADMIN_ACCOUNTS_JSON = ''
    assert.throws(() => createApp(), /ADMIN_ACCOUNTS_JSON is required/)

    process.env.ADMIN_ACCOUNTS_JSON = '[]'
    assert.throws(() => createApp(), /ADMIN_ACCOUNTS_JSON cannot be empty/)

    process.env.ADMIN_ACCOUNTS_JSON = JSON.stringify([{ email: 'saivaibhavaluguri@gmail.com', name: 'Aluguri SaiVaibhav', passwordHash: 'plain-or-sha256' }])
    assert.throws(() => createApp(), /Invalid password hash format/)

    process.env.ADMIN_ACCOUNTS_JSON = JSON.stringify([{ email: 'unauthorized@example.com', name: 'Unknown', passwordHash: hashPassword(randomPassword()) }])
    assert.throws(() => createApp(), /not in the allowed admin list/)
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
    if (prevAdminJson === undefined) delete process.env.ADMIN_ACCOUNTS_JSON
    else process.env.ADMIN_ACCOUNTS_JSON = prevAdminJson
  }
})

test('the console lists submitted teams only, and counts drafts without exposing them', async (t) => {
  const f = await adminFixture(t, makeTestAccounts(), approved)
  const cookie = await f.login()
  const blankDraft = (await f.call('GET', '/api/registration')).cookie.split(';')[0]
  await f.call('PUT', '/api/registration', { data: blank(), step: 0, revision: 0 }, blankDraft)
  const partial = (await f.call('GET', '/api/registration')).cookie.split(';')[0]
  await f.call('PUT', '/api/registration', { data: { ...blank(), teamName: 'Secret draft', email: 'private@example.com' }, step: 0, revision: 0 }, partial)
  const before = await f.call('GET', '/api/admin/registrations', undefined, cookie)
  assert.deepEqual(before.body.registrations, [])
  assert.equal(before.body.draftsInProgress, 1)
  assert.doesNotMatch(JSON.stringify(before.body), /Secret draft|private@example.com/)

  const team = (await f.call('GET', '/api/registration')).cookie.split(';')[0]
  await f.call('PUT', '/api/registration', { data: complete(), step: 2, revision: 0 }, team)
  const submitted = await f.call('POST', '/api/registration/submit', { revision: 1, ...upi() }, team)
  assert.equal(submitted.status, 200)
  const after = await f.call('GET', '/api/admin/registrations', undefined, cookie)
  assert.equal(after.body.registrations.length, 1)
  const [registration] = after.body.registrations
  assert.equal(registration.receipt, submitted.body.draft.receipt)
  assert.equal(registration.reviewStatus, 'pending')
  assert.equal(registration.source, 'website')
  assert.ok(registration.submittedAt)
  assert.equal(after.body.rules.submissionEnabled, true)
  assert.doesNotMatch(JSON.stringify(after.body), /token_hash/)

  const marked = await f.call('PUT', `/api/admin/registrations/${registration.receipt}/status`, { status: 'valid' }, cookie)
  assert.equal(marked.body.registration.reviewStatus, 'valid')
  assert.equal(marked.body.registration.reviewedBy, testAdminEmail)
  assert.equal((await f.call('PUT', `/api/admin/registrations/${registration.receipt}/status`, { status: 'approved' }, cookie)).status, 400)
  assert.equal((await f.call('PUT', '/api/admin/registrations/REG-0000000000000000/status', { status: 'valid' }, cookie)).status, 404)
  assert.deepEqual(Object.keys((await f.call('GET', '/api/registration', undefined, team)).body.draft).sort(), ['data', 'receipt', 'revision', 'status', 'step'])
})

test('spot registration works while submissions are closed and edits are validated', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()
  const spot = await f.call('POST', '/api/admin/registrations', { data: { ...complete(), phone: '+91 98765 43210', teamSize: '9', extra: 'dropped' }, paymentMethod: 'cash' }, cookie)
  assert.equal(spot.status, 201)
  const { registration } = spot.body
  assert.equal(registration.source, 'spot')
  assert.equal(registration.reviewStatus, 'valid')
  assert.equal(registration.data.phone, '+919876543210')
  assert.equal(registration.data.teamSize, '2')
  assert.equal(registration.data.extra, undefined)
  assert.match(registration.receipt, /^\d{4}$/)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete(), paymentMethod: 'cash' }, cookie)).status, 400)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: { ...complete(), email: 'bad' }, paymentMethod: 'cash' }, cookie)).status, 400)
  assert.equal((await f.call('POST', '/api/admin/registrations', {}, cookie)).status, 400)

  const path = `/api/admin/registrations/${registration.receipt}`
  const edited = await f.call('PUT', path, { data: { ...registration.data, teamName: 'Renamed' }, revision: 0 }, cookie)
  assert.equal(edited.status, 200)
  assert.equal(edited.body.registration.data.teamName, 'Renamed')
  assert.equal(edited.body.registration.revision, 1)
  assert.equal((await f.call('PUT', path, { data: registration.data, revision: 0 }, cookie)).status, 409)
  assert.equal((await f.call('PUT', path, { data: { ...registration.data, members: [{ name: '', email: '', college: '' }] }, revision: 1 }, cookie)).status, 400)
})

test('website submission needs a unique 12-digit UTR and a real screenshot, and charges 649 per person', async (t) => {
  const f = await adminFixture(t, makeTestAccounts(), approved)
  const cookie = await f.login()
  const draft = async (data) => {
    const team = (await f.call('GET', '/api/registration')).cookie.split(';')[0]
    await f.call('PUT', '/api/registration', { data, step: 2, revision: 0 }, team)
    return (payment) => f.call('POST', '/api/registration/submit', { revision: 1, ...payment }, team)
  }
  const submit = await draft({ ...complete(), phone: '+91 98765 43210' })
  assert.match((await submit({ screenshotDataUrl: screenshot })).body.error, /12-digit UTR/)
  assert.match((await submit({ utrNumber: '12345', screenshotDataUrl: screenshot })).body.error, /12-digit UTR/)
  assert.match((await submit({ utrNumber: newUtr() })).body.error, /screenshot/)
  assert.match((await submit({ utrNumber: newUtr(), screenshotDataUrl: 'data:image/png;base64,aGVsbG8=' })).body.error, /PNG, JPEG or WebP/)
  const utrNumber = newUtr()
  assert.equal((await submit({ utrNumber, screenshotDataUrl: screenshot })).status, 200)

  const second = await draft({ ...complete(), email: 'other@example.com', teamSize: '3', members: [{ name: 'M', email: 'm1@example.com', college: 'C' }, { name: 'N', email: 'm2@example.com', college: 'C' }] })
  assert.match((await second({ utrNumber, screenshotDataUrl: screenshot })).body.error, /already been used/)
  assert.equal((await second(upi())).status, 200)

  const { registrations } = (await f.call('GET', '/api/admin/registrations', undefined, cookie)).body
  const first = registrations.find((registration) => registration.utrNumber === utrNumber)
  assert.equal(first.amount, 1298)
  assert.equal(first.data.phone, '+919876543210')
  assert.equal(first.paymentMethod, 'upi')
  assert.equal(first.hasPaymentProof, true)
  assert.equal(registrations.find((registration) => registration !== first).amount, 1947)

  const proofPath = `/api/admin/registrations/${first.receipt}/payment-proof`
  assert.equal((await f.call('GET', proofPath)).status, 401)
  const proof = await f.call('GET', proofPath, undefined, cookie)
  assert.equal(proof.status, 200)
  assert.equal(proof.headers.get('content-type'), 'image/png')
})

test('spot and edited registrations record cash or UPI payments', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()
  assert.match((await f.call('POST', '/api/admin/registrations', { data: complete(), paymentMethod: 'upi' }, cookie)).body.error, /12-digit UTR/)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete(), paymentMethod: 'card' }, cookie)).status, 400)
  const utrNumber = newUtr()
  const spot = (await f.call('POST', '/api/admin/registrations', { data: complete(), paymentMethod: 'upi', utrNumber, screenshotDataUrl: screenshot }, cookie)).body.registration
  assert.equal(spot.amount, 1298)
  assert.equal(spot.utrNumber, utrNumber)
  assert.equal(spot.hasPaymentProof, true)

  const path = `/api/admin/registrations/${spot.receipt}`
  // Saving again with the same UTR is not a duplicate of itself, and a missing screenshot keeps the current one.
  const kept = (await f.call('PUT', path, { data: spot.data, revision: 0, paymentMethod: 'upi', utrNumber }, cookie)).body.registration
  assert.equal(kept.hasPaymentProof, true)
  const cash = (await f.call('PUT', path, { data: { ...spot.data, members: [...spot.data.members, { name: 'N', email: 'n@example.com', college: 'C' }] }, revision: 1, paymentMethod: 'cash' }, cookie)).body.registration
  assert.equal(cash.paymentMethod, 'cash')
  assert.equal(cash.utrNumber, null)
  assert.equal(cash.hasPaymentProof, false)
  assert.equal(cash.amount, 1947)
})

test('removing an admin account ends its existing session', async (t) => {
  const accountsAll = makeTestAccounts()
  const f = await adminFixture(t, accountsAll)
  const cookie = await f.login()
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie)).status, 200)

  // Restart with only Jashanth's account
  const accountsOnlyJashanth = accountsAll.filter((a) => a.email !== testAdminEmail)
  await f.restart(accountsOnlyJashanth)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie)).status, 401)
})

test('a database from before the console keeps its submitted registrations', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'admin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const old = new DatabaseSync(dbPath)
  old.exec(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE drafts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, data TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, revision INTEGER NOT NULL);`)
  old.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('hash', 1, 2)
  old.prepare("INSERT INTO drafts VALUES ('hash', ?, 2, 'submitted', 'REG-AAAAAAAAAAAAAAAA', 3)").run(JSON.stringify(complete()))
  old.close()
  for (let run = 0; run < 2; run++) {
    const app = createApp({ dbPath, adminAccounts: makeTestAccounts() })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${app.address().port}`
    const signedIn = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: testAdminEmail, password: testAdminPassword }) })
    const listed = await (await fetch(`${base}/api/admin/registrations`, { headers: { Cookie: signedIn.headers.get('set-cookie').split(';')[0] } })).json()
    assert.equal(listed.registrations[0].receipt, 'REG-AAAAAAAAAAAAAAAA')
    assert.equal(listed.registrations[0].reviewStatus, 'pending')
    assert.equal(listed.registrations[0].source, 'website')
    await new Promise((resolve) => app.close(resolve))
  }
})

test('local dev origins are accepted only outside production', async (t) => {
  const dev = await adminFixture(t)
  assert.equal((await dev.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, { Origin: 'http://localhost:5173' })).status, 200)
  assert.equal((await dev.call('POST', '/api/admin/logout', {}, undefined, { Origin: 'https://localhost:5173' })).status, 403)
  assert.equal((await dev.call('POST', '/api/admin/logout', {}, undefined, { Origin: 'http://localhost.attacker.example' })).status, 403)
})

test('origin check enforces PUBLIC_ORIGIN and handles proxy headers when trusted', async (t) => {
  const prodOrigin = 'https://hackathon.cybersec-kgrcet.com'
  const f = await adminFixture(t, makeTestAccounts(), {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: prodOrigin,
  })

  // Matching PUBLIC_ORIGIN succeeds
  const ok = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, { Origin: prodOrigin })
  assert.equal(ok.status, 200)

  // Foreign origin is denied with 403
  const foreign = await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, { Origin: 'https://attacker.example' })
  assert.equal(foreign.status, 403)

  // Referer matching PUBLIC_ORIGIN without Origin header succeeds
  const refererOk = await fetch(`${f.base}/api/admin/login`, {
    method: 'POST',
    headers: { Referer: `${prodOrigin}/admin/login`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testAdminEmail, password: testAdminPassword }),
  })
  assert.equal(refererOk.status, 200)

  // Referer from foreign origin is denied
  const refererBad = await fetch(`${f.base}/api/admin/login`, {
    method: 'POST',
    headers: { Referer: 'https://attacker.example/phish', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testAdminEmail, password: testAdminPassword }),
  })
  assert.equal(refererBad.status, 403)

  // When TRUST_PROXY=true without PUBLIC_ORIGIN, X-Forwarded-Proto and X-Forwarded-Host are accepted
  const proxyApp = await adminFixture(t, makeTestAccounts(), {
    TRUST_PROXY: 'true',
  })
  const proxyOk = await proxyApp.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, {
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-Host': 'proxy.example.com',
    Origin: 'https://proxy.example.com',
  })
  assert.equal(proxyOk.status, 200)

  // When TRUST_PROXY is false, proxy headers are ignored
  const noTrustApp = await adminFixture(t, makeTestAccounts(), {
    TRUST_PROXY: 'false',
  })
  const noTrustRes = await noTrustApp.call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword }, undefined, {
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-Host': 'proxy.example.com',
    Origin: 'https://proxy.example.com',
  })
  assert.equal(noTrustRes.status, 403)
})

test('client IP uses last X-Forwarded-For address only when TRUST_PROXY=true', async (t) => {
  const f = await adminFixture(t, makeTestAccounts(), { TRUST_PROXY: 'true' })
  // Send 5 failures with spoofed first IP and real proxy appended last IP
  for (let i = 0; i < 5; i++) {
    await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: 'wrong' }, undefined, {
      'X-Forwarded-For': '1.1.1.1, 203.0.113.50',
    })
  }

  // Check audit log: failed event IP should be 203.0.113.50, not 1.1.1.1
  const cookie = await f.login('jashanth', testJashanthPassword)
  const audit = await f.call('GET', '/api/admin/audit-log', undefined, cookie)
  assert.equal(audit.status, 200)
  const failedEvent = audit.body.events.find((e) => e.result === 'fail')
  assert.equal(failedEvent.ip, '203.0.113.50')
})

test('non-JSON and oversized login bodies are rejected', async (t) => {
  const f = await adminFixture(t)
  // Non-JSON content type
  const badType = await fetch(`${f.base}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: f.base, 'Content-Type': 'text/plain' },
    body: 'email=test&password=pass',
  })
  assert.equal(badType.status, 400)

  // Oversized body (> 4 KB)
  const bigPadding = 'a'.repeat(5000)
  const oversized = await fetch(`${f.base}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: f.base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testAdminEmail, password: testAdminPassword, padding: bigPadding }),
  })
  assert.equal(oversized.status, 413)
})

test('session stays valid indefinitely when ADMIN_SESSION_MAX_HOURS is unset, and expires when set', async (t) => {
  // 1. Unset ADMIN_SESSION_MAX_HOURS: session stays valid even after long simulated elapsed time
  const f = await adminFixture(t)
  const cookie = await f.login()
  assert.ok(cookie)

  // Verify initial request works
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie)).status, 200)

  // Simulate long elapsed time (e.g. 180 days in the past)
  const db = new DatabaseSync(f.dbPath)
  const longAgo = Date.now() - 180 * 24 * 3600 * 1000
  db.prepare('UPDATE admin_sessions SET created_at = ?, last_active_at = ?').run(longAgo, longAgo)
  db.close()

  // Still valid! No idle or absolute expiry occurred
  const resAfterLongTime = await f.call('GET', '/api/admin/registrations', undefined, cookie)
  assert.equal(resAfterLongTime.status, 200)
  assert.match(resAfterLongTime.cookie, /Max-Age=31536000/)

  // 2. Set ADMIN_SESSION_MAX_HOURS: session expires when absolute limit is reached
  const fWithLimit = await adminFixture(t, undefined, { ADMIN_SESSION_MAX_HOURS: '2' })
  const cookieWithLimit = await fWithLimit.login()
  assert.ok(cookieWithLimit)

  // Initial request works
  assert.equal((await fWithLimit.call('GET', '/api/admin/registrations', undefined, cookieWithLimit)).status, 200)

  // Simulate exceeding the absolute limit (e.g. absolute_expires_at passed)
  const dbLimit = new DatabaseSync(fWithLimit.dbPath)
  dbLimit.prepare('UPDATE admin_sessions SET absolute_expires_at = ?').run(Date.now() - 1000)
  dbLimit.close()

  // Next call is denied (401)
  assert.equal((await fWithLimit.call('GET', '/api/admin/registrations', undefined, cookieWithLimit)).status, 401)
})

test('changing an account password hash invalidates all its existing sessions', async (t) => {
  const accountsInitial = makeTestAccounts()
  const f = await adminFixture(t, accountsInitial)
  const cookie1 = await f.login(testAdminEmail, testAdminPassword)
  const cookie2 = await f.login(testAdminEmail, testAdminPassword)

  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 200)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 200)

  // Admin changes password (new password hash in configured admin accounts)
  const newPassword = randomPassword()
  const accountsChanged = makeTestAccounts(newPassword, testJashanthPassword)
  await f.restart(accountsChanged)

  // Old sessions are rejected
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 401)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 401)

  // Login with new password works
  const newCookie = await f.login(testAdminEmail, newPassword)
  assert.ok(newCookie)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, newCookie)).status, 200)
})

test('clear-admin-sessions deletes all active sessions and forces re-login', async (t) => {
  const f = await adminFixture(t)
  const cookie1 = await f.login(testAdminEmail, testAdminPassword)
  const cookie2 = await f.login('jashanthgonipati@gmail.com', testJashanthPassword)

  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 200)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 200)

  const cleared = clearAdminSessions(f.dbPath)
  assert.equal(cleared, 2)

  // All previous sessions are now invalidated
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 401)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 401)
})

test('clear-registrations removes registrations and drafts while preserving admin sessions', async (t) => {
  const f = await adminFixture(t)
  const adminCookie = await f.login(testAdminEmail, testAdminPassword)

  // Create a spot registration as admin
  const team = complete()
  const resSpot = await f.call('POST', '/api/admin/registrations', { data: team, ...upi() }, adminCookie)
  assert.equal(resSpot.status, 201)

  // Verify registration exists
  const check1 = await f.call('GET', '/api/admin/registrations', undefined, adminCookie)
  assert.equal(check1.body.registrations.length, 1)

  // Clear registrations
  const res = clearRegistrations(f.dbPath)
  assert.equal(res.registrationsRemoved, 1)

  // Admin session is STILL valid
  const check2 = await f.call('GET', '/api/admin/registrations', undefined, adminCookie)
  assert.equal(check2.status, 200)
  assert.equal(check2.body.registrations.length, 0)
})

test('logout-all invalidates all sessions for an account', async (t) => {
  const f = await adminFixture(t)
  const cookie1 = await f.login()
  const cookie2 = await f.login()

  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 200)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 200)

  // Call logout-all on session 1
  const res = await f.call('POST', '/api/admin/logout-all', {}, cookie1)
  assert.equal(res.status, 200)

  // Both session 1 and session 2 are now invalidated
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie1)).status, 401)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie2)).status, 401)
})

test('every /api/admin/* route denies by default without a valid session', async (t) => {
  const f = await adminFixture(t)
  const unauthenticatedRoutes = [
    ['GET', '/api/admin/registrations'],
    ['POST', '/api/admin/registrations', { data: complete() }],
    ['PUT', '/api/admin/registrations/REG-1234567890ABCDEF', { data: complete() }],
    ['PUT', '/api/admin/registrations/REG-1234567890ABCDEF/status', { status: 'valid' }],
    ['POST', '/api/admin/logout', {}],
    ['POST', '/api/admin/logout-all', {}],
    ['GET', '/api/admin/audit-log'],
    ['GET', '/api/admin/non-existent-route'],
    ['POST', '/api/admin/non-existent-route', {}],
  ]

  for (const [method, path, payload] of unauthenticatedRoutes) {
    const res = await f.call(method, path, payload)
    assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${path}`)
  }
})

test('audit log records events and refuses to leak passwords or hashes', async (t) => {
  const f = await adminFixture(t)
  // 1 failed attempt
  await f.call('POST', '/api/admin/login', { email: testAdminEmail, password: 'secret-guess-attempt' })
  // 1 success attempt
  const cookie = await f.login()

  const res = await f.call('GET', '/api/admin/audit-log', undefined, cookie)
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.events))
  assert.ok(res.body.events.length >= 2)

  const jsonStr = JSON.stringify(res.body.events)
  assert.doesNotMatch(jsonStr, /secret-guess-attempt/)
  assert.doesNotMatch(jsonStr, /scrypt\$/)
  assert.doesNotMatch(jsonStr, /passwordHash/)

  const [latest, prior] = res.body.events
  assert.equal(latest.result, 'success')
  assert.equal(prior.result, 'fail')
})

test('all responses carry required security headers and admin endpoints carry no-store', async (t) => {
  const f = await adminFixture(t, makeTestAccounts(), {
    TRUST_PROXY: 'true',
  })
  const res = await f.call('GET', '/api/admin/session', undefined, undefined, {
    'X-Forwarded-Proto': 'https',
  })

  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('referrer-policy'), 'same-origin')
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/)
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(res.headers.get('content-security-policy'), /object-src 'none'/)
  assert.match(res.headers.get('content-security-policy'), /base-uri 'self'/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.match(res.headers.get('strict-transport-security'), /max-age=/)
})

test('admin registrations stream requires authentication and serves text/event-stream when authenticated', async (t) => {
  const f = await adminFixture(t)
  const unauth = await f.call('GET', '/api/admin/registrations/stream')
  assert.equal(unauth.status, 401)

  const cookie = await f.login('saivaibhavaluguri@gmail.com', testAdminPassword)
  const controller = new AbortController()
  const res = await fetch(`${f.base}/api/admin/registrations/stream`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/)
  assert.equal(res.headers.get('x-accel-buffering'), 'no')

  const reader = res.body.getReader()
  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  assert.match(text, /connected/)

  reader.releaseLock()
  controller.abort()
})

test('password strength validation enforces 12+ chars, no names/emails, and rejects common passwords', () => {
  assert.match(validatePasswordStrength('short'), /at least 12 characters/)
  assert.match(validatePasswordStrength('saivaibhav1234'), /fragment/)
  assert.match(validatePasswordStrength('jashanth99999'), /fragment/)
  assert.match(validatePasswordStrength('password1234'), /common passwords list/)
  assert.equal(validatePasswordStrength('uncommon-safe-pass-phrase!42'), null)
})

test('production files are served with their real content types', async (t) => {
  const f = await adminFixture(t)
  const dist = join(fileURLToPath(new URL('..', import.meta.url)), 'dist')
  const assets = await readdir(join(dist, 'assets')).catch(() => null)
  if (!assets) return t.skip('run npm run build first')
  const types = { js: /text\/javascript/, css: /text\/css/, png: /image\/png/ }
  for (const name of assets) {
    const expected = types[name.split('.').at(-1)]
    if (expected) assert.match((await f.call('GET', `/assets/${name}`)).headers.get('content-type'), expected)
  }
  for (const path of ['/', '/register', '/admin', '/admin/login']) {
    const page = await f.call('GET', path)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.equal(page.headers.get('x-frame-options'), 'DENY')
  }
})

test('admin test-email requires valid session and email, sending sample confirmation', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()

  // Unauthenticated
  assert.equal((await f.call('POST', '/api/admin/test-email', { email: 'admin@example.com' })).status, 401)

  // Authenticated, invalid email
  const badRes = await f.call('POST', '/api/admin/test-email', { email: 'invalid-email' }, cookie)
  assert.equal(badRes.status, 400)

  // Authenticated, valid email (dry run when SMTP credentials not provided)
  const goodRes = await f.call('POST', '/api/admin/test-email', { email: 'test.leader@example.com' }, cookie)
  assert.equal(goodRes.status, 200)
  assert.equal(goodRes.body.ok, true)
  assert.equal(goodRes.body.dryRun, true)
})

test('problem statements public and admin APIs support listing, creation, update, and deletion', async (t) => {
  const f = await adminFixture(t)

  // 1. Public listing initially has statements hidden until released
  const initialPublic = await f.call('GET', '/api/problem-statements')
  assert.equal(initialPublic.status, 200)
  assert.ok(Array.isArray(initialPublic.body.problemStatements))
  assert.equal(initialPublic.body.problemStatementsReleased, false)
  assert.equal(initialPublic.body.problemStatements.length, 0)

  // 2. Unauthenticated admin endpoint denies with 401
  const unauthRes = await f.call('GET', '/api/admin/problem-statements')
  assert.equal(unauthRes.status, 401)

  // 3. Authenticated admin CRUD & can see all seeded problem statements
  const cookie = await f.login()
  const adminList = await f.call('GET', '/api/admin/problem-statements', undefined, cookie)
  assert.equal(adminList.status, 200)
  assert.ok(adminList.body.problemStatements.length >= 10)
  const first = adminList.body.problemStatements[0]
  assert.equal(first.statementCode, 'PNG1')
  assert.equal(first.title, 'Adversarial Contract Intelligence')
  assert.ok(first.pdfUrl.includes('res.cloudinary.com'))

  // Release problem statements and verify public endpoint reveals them
  await f.call('POST', '/api/admin/toggle-ps-release', { released: true }, cookie)
  const releasedPublic = await f.call('GET', '/api/problem-statements')
  assert.equal(releasedPublic.body.problemStatementsReleased, true)
  assert.ok(releasedPublic.body.problemStatements.length >= 10)

  // Create new problem statement
  const createRes = await f.call('POST', '/api/admin/problem-statements', {
    trackId: 'cybersecurity-digital-forensics',
    statementCode: 'CYB-01',
    title: 'Zero-Knowledge Log Auditing',
    category: 'Software Projects',
    pdfUrl: 'https://example.com/ps/CYB-01.pdf',
    isActive: true,
    displayOrder: 1,
  }, cookie)
  assert.equal(createRes.status, 201)
  assert.equal(createRes.body.ok, true)
  const createdId = createRes.body.problemStatement.id

  // Verify created in public list
  const updatedPublic = await f.call('GET', '/api/problem-statements')
  const found = updatedPublic.body.problemStatements.find((ps) => ps.id === createdId)
  assert.ok(found)
  assert.equal(found.statementCode, 'CYB-01')
  assert.equal(found.title, 'Zero-Knowledge Log Auditing')

  // Update
  const updateRes = await f.call('PUT', `/api/admin/problem-statements/${createdId}`, {
    trackId: 'cybersecurity-digital-forensics',
    statementCode: 'CYB-01',
    title: 'Zero-Knowledge Log Auditing v2',
    category: 'Software Projects',
    pdfUrl: 'https://example.com/ps/CYB-01-v2.pdf',
    isActive: true,
    displayOrder: 1,
  }, cookie)
  assert.equal(updateRes.status, 200)

  // Delete
  const deleteRes = await f.call('DELETE', `/api/admin/problem-statements/${createdId}`, undefined, cookie)
  assert.equal(deleteRes.status, 200)

  // Verify deleted
  const postDeletePublic = await f.call('GET', '/api/problem-statements')
  assert.ok(!postDeletePublic.body.problemStatements.some((ps) => ps.id === createdId))
})

test('admin can toggle registration status with password confirmation and release problem statements', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()

  // 1. Unauthenticated attempts are blocked
  assert.equal((await f.call('POST', '/api/admin/toggle-registration', { enabled: false, password: testAdminPassword })).status, 401)
  assert.equal((await f.call('POST', '/api/admin/toggle-ps-release', { released: true })).status, 401)

  // 2. Missing password returns 400
  const noPw = await f.call('POST', '/api/admin/toggle-registration', { enabled: false }, cookie)
  assert.equal(noPw.status, 400)

  // 3. Wrong password returns 403
  const wrongPw = await f.call('POST', '/api/admin/toggle-registration', { enabled: false, password: 'wrong-password' }, cookie)
  assert.equal(wrongPw.status, 403)

  // 4. Correct password closes registration
  const closeRes = await f.call('POST', '/api/admin/toggle-registration', { enabled: false, password: testAdminPassword }, cookie)
  assert.equal(closeRes.status, 200)
  assert.equal(closeRes.body.registrationOpen, false)

  // Verify public problem-statements endpoint reflects registrationOpen: false
  const publicCheck1 = await f.call('GET', '/api/problem-statements')
  assert.equal(publicCheck1.body.registrationOpen, false)

  // 5. Toggle problem statements release
  const releaseRes = await f.call('POST', '/api/admin/toggle-ps-release', { released: true }, cookie)
  assert.equal(releaseRes.status, 200)
  assert.equal(releaseRes.body.problemStatementsReleased, true)

  const publicCheck2 = await f.call('GET', '/api/problem-statements')
  assert.equal(publicCheck2.body.problemStatementsReleased, true)

  // 6. Re-open registrations
  const openRes = await f.call('POST', '/api/admin/toggle-registration', { enabled: true, password: testAdminPassword }, cookie)
  assert.equal(openRes.status, 200)
  assert.equal(openRes.body.registrationOpen, true)

  const publicCheck3 = await f.call('GET', '/api/problem-statements')
  assert.equal(publicCheck3.body.registrationOpen, true)
})

test('domain is recorded in registration and exported in admin CSV', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()
  const utrNumber = newUtr()
  const teamData = { ...complete(), domain: 'Cybersecurity & Digital Forensics' }
  const spot = (await f.call('POST', '/api/admin/registrations', { data: teamData, paymentMethod: 'upi', utrNumber, screenshotDataUrl: screenshot }, cookie)).body.registration
  assert.equal(spot.data.domain, 'Cybersecurity & Digital Forensics')

  const csvResponse = await f.call('GET', '/api/admin/registrations.csv', undefined, cookie)
  assert.equal(csvResponse.status, 200)
  assert.equal(csvResponse.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.match(csvResponse.body, /"Domain"/)
  assert.match(csvResponse.body, /"Cybersecurity & Digital Forensics"/)
})

test('admin invitations API: templates, preview, test-send, dispatch, duplicate check, and resend', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()

  // 1. Fetch predefined templates
  const tplRes = await f.call('GET', '/api/admin/invitations/templates', undefined, cookie)
  assert.equal(tplRes.status, 200)
  assert.ok(tplRes.body.templates.internal)
  assert.ok(tplRes.body.templates.external)
  assert.ok(tplRes.body.templates.sponsor)
  assert.ok(tplRes.body.templates.custom)

  // 2. Render live preview
  const prevRes = await f.call('POST', '/api/admin/invitations/preview', {
    recipientName: 'Dr. Ramesh Kumar',
    designation: 'Principal',
    institution: 'VNR VJIET, Hyderabad',
    category: 'External College',
    templateKey: 'external',
  }, cookie)
  assert.equal(prevRes.status, 200)
  assert.match(prevRes.body.html, /Kumar/)
  assert.match(prevRes.body.html, /Cybersecurity (&|&amp;) Ethical Hacking Club/)
  assert.match(prevRes.body.html, /could you share with your students|pass it on to students/i)
  assert.match(prevRes.body.html, /reply STOP/)
  assert.match(prevRes.body.html, /OFFICIAL EVENT INVITATION/)
  assert.match(prevRes.body.html, /hackathon\.cybersec-kgrcet\.com/)
  assert.match(prevRes.body.text, /Dear Prof\. Kumar,/)
  assert.match(prevRes.body.text, /reply STOP and we won't write again/)
  // Assert no logo image and no marketing button in invitation HTML
  assert.doesNotMatch(prevRes.body.html, /<img\s/i)
  assert.doesNotMatch(prevRes.body.html, /REGISTER STUDENT TEAMS ↗/)

  // 2b. Verify internal preview does not have external outreach CTA text
  const prevInternal = await f.call('POST', '/api/admin/invitations/preview', {
    recipientName: 'Dr. Internal HOD',
    category: 'Internal College',
    templateKey: 'internal',
  }, cookie)
  assert.equal(prevInternal.status, 200)
  assert.doesNotMatch(prevInternal.body.html, /We encourage your institution to share this invitation/)

  // 3. Send test email to admin
  const testRes = await f.call('POST', '/api/admin/invitations', {
    isTest: true,
    recipientName: 'Admin Tester',
    category: 'Internal College',
    templateKey: 'internal',
  }, cookie)
  assert.equal(testRes.status, 200)
  assert.equal(testRes.body.isTest, true)
  assert.equal(testRes.body.sentTo, testAdminEmail)

  // Invitations table should still be empty after test email
  const emptyList = await f.call('GET', '/api/admin/invitations', undefined, cookie)
  assert.equal(emptyList.body.invitations.length, 0)
  assert.equal(emptyList.body.stats.total, 0)

  // 4. Send actual invitation
  const sendRes = await f.call('POST', '/api/admin/invitations', {
    recipientName: 'Dr. Ramesh Kumar',
    email: 'principal@vnrvjiet.ac.in',
    institution: 'VNR VJIET',
    designation: 'Principal',
    category: 'Principal',
    templateKey: 'official',
  }, cookie)
  assert.equal(sendRes.status, 201)
  assert.equal(sendRes.body.sentCount, 1)

  // Verify list & stats
  const listRes = await f.call('GET', '/api/admin/invitations', undefined, cookie)
  assert.equal(listRes.body.invitations.length, 1)
  assert.equal(listRes.body.stats.total, 1)
  assert.equal(listRes.body.stats.sent, 1)
  const invite = listRes.body.invitations[0]
  assert.equal(invite.recipientName, 'Dr. Ramesh Kumar')
  assert.equal(invite.email, 'principal@vnrvjiet.ac.in')
  assert.equal(invite.category, 'Principal')
  assert.ok(invite.sentBy.includes(testAdminEmail))

  // 5. Duplicate warning
  const dupRes = await f.call('POST', '/api/admin/invitations', {
    recipientName: 'Dr. Ramesh Kumar',
    email: 'principal@vnrvjiet.ac.in',
    institution: 'VNR VJIET',
    designation: 'Principal',
    category: 'Principal',
    templateKey: 'official',
  }, cookie)
  assert.equal(dupRes.status, 409)
  assert.equal(dupRes.body.warning, 'duplicate')

  // Sending with allowDuplicate succeeds
  const allowDupRes = await f.call('POST', '/api/admin/invitations', {
    recipientName: 'Dr. Ramesh Kumar',
    email: 'principal@vnrvjiet.ac.in',
    institution: 'VNR VJIET',
    designation: 'Principal',
    category: 'Principal',
    templateKey: 'official',
    allowDuplicate: true,
  }, cookie)
  assert.equal(allowDupRes.status, 201)

  // 6. Multiple recipients confirmation requirement
  const multiNoConfirm = await f.call('POST', '/api/admin/invitations', {
    recipientName: 'Esteemed Faculty',
    email: 'hod1@college.edu, hod2@college.edu',
    institution: 'Engineering College',
    designation: 'HOD',
    category: 'HOD / Faculty',
    templateKey: 'official',
  }, cookie)
  assert.equal(multiNoConfirm.status, 400)
  assert.equal(multiNoConfirm.body.requireConfirmation, true)
  assert.equal(multiNoConfirm.body.count, 2)

  // With confirmMultiple
  const multiConfirm = await f.call('POST', '/api/admin/invitations', {
    recipientName: 'Esteemed Faculty',
    email: 'hod1@college.edu, hod2@college.edu',
    institution: 'Engineering College',
    designation: 'HOD',
    category: 'HOD / Faculty',
    templateKey: 'official',
    confirmMultiple: true,
  }, cookie)
  assert.equal(multiConfirm.status, 201)
  assert.equal(multiConfirm.body.sentCount, 2)

  // 7. Resend invitation
  const resendRes = await f.call('POST', `/api/admin/invitations/${invite.id}/resend`, {}, cookie)
  assert.equal(resendRes.status, 200)
  assert.equal(resendRes.body.ok, true)

  // 8. Update status to delivered
  const patchRes = await f.call('PATCH', `/api/admin/invitations/${invite.id}/status`, { status: 'delivered' }, cookie)
  assert.equal(patchRes.status, 200)

  const updatedCheck = await f.call('GET', '/api/admin/invitations', undefined, cookie)
  const deliveredInvite = updatedCheck.body.invitations.find((i) => i.id === invite.id)
  assert.equal(deliveredInvite.status, 'delivered')

  // 8b. Direct HTML preview in new tab
  const htmlPreviewRes = await f.call('GET', `/api/admin/invitations/${invite.id}/preview`, undefined, cookie)
  assert.equal(htmlPreviewRes.status, 200)
  assert.equal(htmlPreviewRes.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(htmlPreviewRes.body, /Dr\. Ramesh Kumar/)

  // 9. Delete invitation
  const delRes = await f.call('DELETE', `/api/admin/invitations/${invite.id}`, undefined, cookie)
  assert.equal(delRes.status, 200)
})


