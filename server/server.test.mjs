import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createApp } from './server.mjs'

const approved = { SUBMISSION_ENABLED: 'true', REGISTRATION_MIN_TEAM_SIZE: '2', REGISTRATION_MAX_TEAM_SIZE: '4' }
const blank = () => ({ teamName: '', teamSize: '', college: '', leadName: '', email: '', phone: '', members: [] })
const complete = () => ({ teamName: 'A', teamSize: '2', college: 'C', leadName: 'L', email: 'lead@example.com', phone: '+919876543210', members: [{ name: 'M', email: 'member@example.com', college: 'C' }] })

async function fixture(t, rules = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'registration-'))
  let app, base
  const close = async () => { if (app?.listening) await new Promise((resolve) => app.close(resolve)) }
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }) })
  async function start() {
    const previous = {}
    try {
      for (const key of [...Object.keys(approved), 'NODE_ENV']) {
        previous[key] = process.env[key]
        if (rules[key] === undefined) delete process.env[key]
        else process.env[key] = rules[key]
      }
      app = createApp({ dbPath: join(dir, 'test.sqlite') })
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
    async submit(revision, cookie) { return this.request('POST', { revision }, cookie, {}, '/api/registration/submit') },
  }
}

test('partial and empty drafts persist data, step, revision, and cookie authorization across restart', async (t) => {
  const f = await fixture(t)
  const initial = await f.request()
  const cookie = initial.cookie.split(';')[0]
  assert.match(initial.cookie, /HttpOnly/)
  assert.match(initial.cookie, /SameSite=Strict/)
  assert.match(initial.cookie, /Max-Age=2592000/)
  assert.deepEqual(initial.body.rules, { minTeamSize: null, maxTeamSize: null, submissionEnabled: false })
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

const adminPassword = 'correct-horse-battery'
function hashFor(password) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`
}
const adminJson = JSON.stringify([{ email: 'Admin@Example.edu', name: 'Organizer', passwordHash: hashFor(adminPassword) }])

async function adminFixture(t, adminAccountsJson = adminJson, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'admin-'))
  const dbPath = join(dir, 'test.sqlite')
  const previous = {}
  for (const [key, value] of Object.entries(env)) { previous[key] = process.env[key]; process.env[key] = value }
  const app = createApp({ dbPath, adminAccountsJson })
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.address().port}`
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  const call = async (method, path, payload, cookie, headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const text = await response.text()
    let body = text
    try { body = JSON.parse(text) } catch { /* Static files are not JSON. */ }
    return { status: response.status, body, cookie: response.headers.get('set-cookie'), headers: response.headers }
  }
  const login = async () => (await call('POST', '/api/admin/login', { email: 'admin@example.edu', password: adminPassword })).cookie.split(';')[0]
  return { call, login, base }
}

test('admin login sets a hardened session cookie and logout ends it', async (t) => {
  const f = await adminFixture(t)
  assert.deepEqual((await f.call('GET', '/api/admin/session')).body, { session: null })
  const signedIn = await f.call('POST', '/api/admin/login', { email: ' ADMIN@example.edu ', password: adminPassword })
  assert.equal(signedIn.status, 200)
  assert.deepEqual(signedIn.body.session, { email: 'Admin@Example.edu', name: 'Organizer' })
  assert.match(signedIn.cookie, /HttpOnly/)
  assert.match(signedIn.cookie, /SameSite=Strict/)
  assert.match(signedIn.cookie, /Max-Age=14400/)
  const cookie = signedIn.cookie.split(';')[0]
  assert.equal((await f.call('GET', '/api/admin/session', undefined, cookie)).body.session.name, 'Organizer')
  assert.equal((await f.call('POST', '/api/admin/logout', {}, cookie)).status, 200)
  assert.deepEqual((await f.call('GET', '/api/admin/session', undefined, cookie)).body, { session: null })
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, cookie)).status, 401)
})

test('admin endpoints reject anonymous, forged, and cross-origin requests', async (t) => {
  const f = await adminFixture(t)
  assert.equal((await f.call('GET', '/api/admin/registrations')).status, 401)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete() })).status, 401)
  assert.equal((await f.call('GET', '/api/admin/registrations', undefined, 'kgrcet_admin=forged')).status, 401)
  assert.equal((await f.call('PUT', '/api/admin/registrations/REG-0000000000000000/status', { status: 'valid' })).status, 401)
  const cookie = await f.login()
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete() }, cookie, { Origin: 'https://attacker.example' })).status, 403)
  assert.equal((await f.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: adminPassword }, undefined, { Origin: 'https://attacker.example' })).status, 403)
})

test('repeated failed logins lock that email, and unknown emails get the same answer', async (t) => {
  const f = await adminFixture(t)
  const wrong = await f.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: 'wrong' })
  const unknown = await f.call('POST', '/api/admin/login', { email: 'nobody@example.edu', password: 'wrong' })
  assert.equal(wrong.status, 401)
  assert.deepEqual(unknown.body, wrong.body)
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await f.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: 'wrong' })).status, 401)
  const locked = await f.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: 'wrong' })
  assert.equal(locked.status, 429)
  assert.equal(locked.body.locked, true)
  assert.equal(locked.body.remainingLockoutSeconds, 60)
  const correctWhileLocked = await f.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: adminPassword })
  assert.equal(correctWhileLocked.status, 429)
  assert.equal(correctWhileLocked.cookie, null)
})

test('missing or invalid admin configuration fails closed', async (t) => {
  const none = await adminFixture(t, '')
  assert.equal((await none.call('POST', '/api/admin/login', { email: 'a@b.co', password: 'x' })).status, 503)
  const broken = await adminFixture(t, '{not json')
  assert.equal((await broken.call('POST', '/api/admin/login', { email: 'a@b.co', password: 'x' })).status, 503)
  const malformedHash = await adminFixture(t, JSON.stringify([{ email: 'a@b.co', name: 'A', passwordHash: 'plaintext' }]))
  assert.equal((await malformedHash.call('POST', '/api/admin/login', { email: 'a@b.co', password: 'plaintext' })).status, 401)
})

test('the console lists submitted teams only, and counts drafts without exposing them', async (t) => {
  const f = await adminFixture(t, adminJson, approved)
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
  const submitted = await f.call('POST', '/api/registration/submit', { revision: 1 }, team)
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
  assert.equal(marked.body.registration.reviewedBy, 'Admin@Example.edu')
  assert.equal((await f.call('PUT', `/api/admin/registrations/${registration.receipt}/status`, { status: 'approved' }, cookie)).status, 400)
  assert.equal((await f.call('PUT', '/api/admin/registrations/REG-0000000000000000/status', { status: 'valid' }, cookie)).status, 404)
  // Review fields stay out of the participant's own response.
  assert.deepEqual(Object.keys((await f.call('GET', '/api/registration', undefined, team)).body.draft).sort(), ['data', 'receipt', 'revision', 'status', 'step'])
})

test('spot registration works while submissions are closed and edits are validated', async (t) => {
  const f = await adminFixture(t)
  const cookie = await f.login()
  const spot = await f.call('POST', '/api/admin/registrations', { data: { ...complete(), phone: '+91 98765 43210', teamSize: '9', extra: 'dropped' } }, cookie)
  assert.equal(spot.status, 201)
  const { registration } = spot.body
  assert.equal(registration.source, 'spot')
  assert.equal(registration.reviewStatus, 'valid')
  assert.equal(registration.data.phone, '+919876543210')
  assert.equal(registration.data.teamSize, '2')
  assert.equal(registration.data.extra, undefined)
  assert.match(registration.receipt, /^REG-[A-F0-9]{16}$/)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: complete() }, cookie)).status, 400)
  assert.equal((await f.call('POST', '/api/admin/registrations', { data: { ...complete(), email: 'bad' } }, cookie)).status, 400)
  assert.equal((await f.call('POST', '/api/admin/registrations', {}, cookie)).status, 400)

  const path = `/api/admin/registrations/${registration.receipt}`
  const edited = await f.call('PUT', path, { data: { ...registration.data, teamName: 'Renamed' }, revision: 0 }, cookie)
  assert.equal(edited.status, 200)
  assert.equal(edited.body.registration.data.teamName, 'Renamed')
  assert.equal(edited.body.registration.revision, 1)
  assert.equal((await f.call('PUT', path, { data: registration.data, revision: 0 }, cookie)).status, 409)
  assert.equal((await f.call('PUT', path, { data: { ...registration.data, members: [{ name: '', email: '', college: '' }] }, revision: 1 }, cookie)).status, 400)
})

test('removing an admin account ends its existing session', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'admin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const start = async (adminAccountsJson) => {
    const app = createApp({ dbPath, adminAccountsJson })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    return { app, base: `http://127.0.0.1:${app.address().port}` }
  }
  const first = await start(adminJson)
  const signedIn = await fetch(`${first.base}/api/admin/login`, { method: 'POST', headers: { Origin: first.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.edu', password: adminPassword }) })
  const cookie = signedIn.headers.get('set-cookie').split(';')[0]
  await new Promise((resolve) => first.app.close(resolve))
  const kept = await start(adminJson)
  assert.equal((await fetch(`${kept.base}/api/admin/registrations`, { headers: { Cookie: cookie } })).status, 200)
  await new Promise((resolve) => kept.app.close(resolve))
  const removed = await start(JSON.stringify([{ email: 'other@example.edu', name: 'Other', passwordHash: hashFor(adminPassword) }]))
  assert.equal((await fetch(`${removed.base}/api/admin/registrations`, { headers: { Cookie: cookie } })).status, 401)
  await new Promise((resolve) => removed.app.close(resolve))
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
    const app = createApp({ dbPath, adminAccountsJson: adminJson })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${app.address().port}`
    const signedIn = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.edu', password: adminPassword }) })
    const listed = await (await fetch(`${base}/api/admin/registrations`, { headers: { Cookie: signedIn.headers.get('set-cookie').split(';')[0] } })).json()
    assert.equal(listed.registrations[0].receipt, 'REG-AAAAAAAAAAAAAAAA')
    assert.equal(listed.registrations[0].reviewStatus, 'pending')
    assert.equal(listed.registrations[0].source, 'website')
    await new Promise((resolve) => app.close(resolve))
  }
})

test('local dev origins are accepted only outside production', async (t) => {
  const dev = await adminFixture(t)
  assert.equal((await dev.call('POST', '/api/admin/login', { email: 'admin@example.edu', password: adminPassword }, undefined, { Origin: 'http://localhost:5173' })).status, 200)
  assert.equal((await dev.call('POST', '/api/admin/logout', {}, undefined, { Origin: 'https://localhost:5173' })).status, 403)
  assert.equal((await dev.call('POST', '/api/admin/logout', {}, undefined, { Origin: 'http://localhost.attacker.example' })).status, 403)
  const production = await adminFixture(t, adminJson, { NODE_ENV: 'production' })
  assert.equal((await production.call('POST', '/api/admin/logout', {}, undefined, { Origin: 'http://localhost:5173' })).status, 403)
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
