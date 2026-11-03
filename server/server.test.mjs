import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
