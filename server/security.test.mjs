import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, containsDangerousHtml, sanitizeInputText, RateLimiter } from './server.mjs'
import { sanitizeHeader, renderMemberConfirmationEmail } from './email-service.mjs'

const testAccounts = [
  {
    email: 'saivaibhavaluguri@gmail.com',
    name: 'Aluguri SaiVaibhav',
    passwordHash: 'scrypt$5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
]

async function createTestServer(t, envOverrides = {}) {
  const origEnv = { ...process.env }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    SUBMISSION_ENABLED: 'true',
    REGISTRATION_MIN_TEAM_SIZE: '2',
    REGISTRATION_MAX_TEAM_SIZE: '5',
    REGISTRATION_FEE_PER_PERSON: '649',
    ...envOverrides,
  })

  const dir = await mkdtemp(join(tmpdir(), 'sec-test-'))
  const dbPath = join(dir, 'test.sqlite')
  const app = createApp({ dbPath, adminAccounts: testAccounts })

  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  const port = app.address().port
  const base = `http://127.0.0.1:${port}`

  t.after(async () => {
    await new Promise((resolve) => app.close(resolve))
    await rm(dir, { recursive: true, force: true })
    process.env = origEnv
  })

  return { base, app, dbPath }
}

test('SQL Injection: receipt and query parameters are strictly parameterized and validated', async (t) => {
  const { base } = await createTestServer(t)

  // 1. Direct SQL injection attempts in receipt URL path
  const sqliPayloads = [
    "1001' OR '1'='1",
    "1001; DROP TABLE drafts;--",
    "1001' UNION SELECT 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17--",
    "1001' AND 1=0 UNION ALL SELECT null--",
  ]

  for (const payload of sqliPayloads) {
    const encoded = encodeURIComponent(payload)
    const res = await fetch(`${base}/api/admin/registrations/${encoded}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ status: 'valid' }),
    })
    // Must be rejected with 401 (unauthorized) or 404 (not found / regex rejected)
    // NEVER 500 (SQL syntax error or table drop)
    assert.ok([401, 404].includes(res.status), `Payload ${payload} returned unexpected status ${res.status}`)
  }
})

test('XSS & HTML Injection: malicious tags and script payloads in draft fields are rejected', async (t) => {
  const { base } = await createTestServer(t)

  // Get session cookie
  const getRes = await fetch(`${base}/api/registration`)
  const cookie = getRes.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)

  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(document.cookie)>',
    'javascript:alert(1)',
    '<iframe src="https://evil.example.com">',
    'Team <b onmouseover="alert(1)">Awesome</b>',
  ]

  for (const payload of xssPayloads) {
    const putRes = await fetch(`${base}/api/registration`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: base,
        Cookie: cookie,
      },
      body: JSON.stringify({
        step: 0,
        revision: 0,
        data: {
          teamName: payload,
          teamSize: '2',
          college: 'Cyber College',
          leadName: 'Leader',
          email: 'leader@example.com',
          phone: '+919876543210',
          members: [],
        },
      }),
    })

    assert.equal(putRes.status, 400, `Payload ${payload} was not rejected with 400`)
    const body = await putRes.json()
    assert.match(body.error, /HTML tags or script payloads are not permitted/)
  }
})

test('containsDangerousHtml correctly classifies safe vs attack payloads', () => {
  // Attack vectors that must be blocked
  assert.equal(containsDangerousHtml('<script>alert(1)</script>'), true)
  assert.equal(containsDangerousHtml('<SCRIPT SRC="//evil.com/x.js"></SCRIPT>'), true)
  assert.equal(containsDangerousHtml('<img src=x onerror=alert(1)>'), true)
  assert.equal(containsDangerousHtml('<svg onload=alert(1)>'), true)
  assert.equal(containsDangerousHtml('javascript:alert(1)'), true)
  assert.equal(containsDangerousHtml('" onfocus="alert(1)'), true)
  assert.equal(containsDangerousHtml('<iframe src="data:text/html,<script>alert(1)</script>">'), true)
  assert.equal(containsDangerousHtml('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), true)

  // Legitimate strings that must be allowed
  assert.equal(containsDangerousHtml('Cyber Security Club'), false)
  assert.equal(containsDangerousHtml('KG Reddy College of Engg & Tech'), false)
  assert.equal(containsDangerousHtml('Team Alpha-1 (CSE & IT)'), false)
  assert.equal(containsDangerousHtml('Jashanth Gonipati'), false)
  assert.equal(containsDangerousHtml(''), false)
})

test('sanitizeInputText strips control characters and Trojan Source bidi overrides', () => {
  // Strips null byte and bell
  const withControl = 'Team\x00Name\x07'
  assert.equal(sanitizeInputText(withControl), 'Team Name')

  // Strips Unicode right-to-left override (Trojan Source attack)
  const withBidi = 'user\u202Ereversed'
  assert.equal(sanitizeInputText(withBidi), 'userreversed')

  // Strips zero-width space
  const withZws = 'hack\u200Bathon'
  assert.equal(sanitizeInputText(withZws), 'hackathon')

  // Truncates to max length
  const longStr = 'a'.repeat(300)
  assert.equal(sanitizeInputText(longStr, 50).length, 50)
})

test('Email Header Injection & CRLF breakout are completely neutralized', () => {
  // CRLF injection replaced
  const crlfInjected = 'Legit Team\r\nBcc: victim@example.com'
  assert.equal(sanitizeHeader(crlfInjected), 'Legit Team  Bcc: victim@example.com')

  // Quote breakout attempt to inject extra recipient in To: header
  const quoteBreakout = 'Hacker" <attacker@evil.com>, "Legit Name'
  const sanitized = sanitizeHeader(quoteBreakout)
  assert.ok(!sanitized.includes('"'), 'Quotes must be stripped to prevent header breakout')
  assert.ok(!sanitized.includes('\\'), 'Backslashes must be stripped')

  // Verify email rendering safely escapes HTML in emails
  const rendered = renderMemberConfirmationEmail({
    recipient: { name: '<script>alert("name")</script>', role: 'leader' },
    teamData: {
      teamName: '<b>DarkArmy</b>',
      leadName: '<img src=x onerror=alert(1)>',
      email: 'lead@test.com',
      members: [],
    },
    receipt: '1001',
    amount: 1298,
  })

  assert.ok(!rendered.html.includes('<script>'), 'Email HTML must not include unescaped script tag')
  assert.ok(!rendered.html.includes('<img src=x'), 'Email HTML must not include unescaped img tag')
  assert.ok(rendered.html.includes('&lt;script&gt;'), 'Email HTML must escape script tag')
  assert.ok(rendered.html.includes('&lt;b&gt;DarkArmy&lt;/b&gt;'), 'Email HTML must escape team name')
})

test('Directory Traversal: directory requests (/assets) do not leak server paths or throw EISDIR', async (t) => {
  const { base } = await createTestServer(t)

  // Requesting /assets (a real folder) must not throw EISDIR or leak filesystem path
  const dirRes = await fetch(`${base}/assets`)
  const body = await dirRes.text()
  assert.ok(!body.includes('EISDIR'), 'Must not leak EISDIR error')
  assert.ok(!body.includes('Users\\'), 'Must not leak Windows user path')
  assert.ok(!body.includes('/home/'), 'Must not leak Unix home path')

  // Probing sensitive hidden files must return 404
  const envRes = await fetch(`${base}/.env`)
  assert.equal(envRes.status, 404)

  const gitRes = await fetch(`${base}/.git`)
  assert.equal(gitRes.status, 404)

  // Null byte in URL must return 400
  const nullRes = await fetch(`${base}/assets%00.png`)
  assert.equal(nullRes.status, 400)
})

test('Prototype Pollution: dangerous keys (__proto__, constructor, prototype) are ignored in JSON bodies', async (t) => {
  const { base } = await createTestServer(t)

  const polluter = JSON.stringify({
    __proto__: { polluted: true },
    constructor: { prototype: { alsoPolluted: true } },
    step: 0,
    revision: 0,
    data: {
      teamName: 'CleanTeam',
      teamSize: '2',
      college: 'CleanCollege',
      leadName: 'Leader',
      email: 'leader@example.com',
      phone: '+919876543210',
      members: [],
    },
  })

  const getRes = await fetch(`${base}/api/registration`)
  const cookie = getRes.headers.get('set-cookie')?.split(';')[0]

  await fetch(`${base}/api/registration`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: polluter,
  })

  // Verify Object prototype was not contaminated
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(Object.prototype.alsoPolluted, undefined)
})

test('RateLimiter enforces request limits and returns standard headers and 429', () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 })
  try {
    assert.equal(limiter.check('ip1').allowed, true)
    assert.equal(limiter.check('ip1').allowed, true)
    assert.equal(limiter.check('ip1').allowed, true)

    // 4th request must be rejected
    const blocked = limiter.check('ip1')
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.remaining, 0)
    assert.ok(blocked.retryAfterSeconds > 0)

    // Different IP must still be allowed
    assert.equal(limiter.check('ip2').allowed, true)
  } finally {
    limiter.destroy()
  }
})

test('HTTP Security Headers include modern hardening standards', async (t) => {
  const { base } = await createTestServer(t)

  const res = await fetch(`${base}/api/registration`)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('referrer-policy'), 'same-origin')
  assert.equal(res.headers.get('x-xss-protection'), '0')
  assert.ok(res.headers.get('permissions-policy')?.includes('camera=()'))
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(res.headers.get('x-permitted-cross-domain-policies'), 'none')
  assert.equal(res.headers.get('x-dns-prefetch-control'), 'off')
  assert.ok(res.headers.get('content-security-policy')?.includes("form-action 'self'"))
  assert.ok(res.headers.get('cache-control')?.includes('no-store'))
})
