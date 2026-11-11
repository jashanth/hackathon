import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  isValidEmail,
  sanitizeHeader,
  sanitizeErrorMessage,
  renderMemberConfirmationEmail,
  createSmtpTransport,
  initEmailTables,
  enqueueConfirmationEmails,
  processEmailQueue,
} from './email-service.mjs'
import { createApp, hashPassword, ALLOWED_ADMINS } from './server.mjs'

const testAdminPassword = 'TestPassword123!Safe'
const testAdminEmail = 'saivaibhavaluguri@gmail.com'

function makeMockMailer(options = {}) {
  const sent = []
  return {
    sent,
    from: '"KGRCET Hackathon" <no-reply@cybersec-kgrcet.com>',
    isConfigured: true,
    sendMail: async (mailOptions) => {
      if (options.failEmails && options.failEmails.includes(mailOptions.to)) {
        throw new Error(`Simulated delivery failure for ${mailOptions.to}`)
      }
      if (options.failAll) {
        throw new Error('SMTP connection timeout: smtp-relay.brevo.com:587')
      }
      sent.push(mailOptions)
      return { messageId: `msg-${Date.now()}-${Math.random()}` }
    },
    verify: async () => true,
  }
}

test('email validation, header sanitization, and secret redaction', () => {
  // Valid emails
  assert.equal(isValidEmail('lead@example.com'), true)
  assert.equal(isValidEmail('student.cs@kgrcet.edu.in'), true)
  assert.equal(isValidEmail('user+tag@domain.co.in'), true)

  // Invalid emails
  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail('notanemail'), false)
  assert.equal(isValidEmail('@nodomain.com'), false)
  assert.equal(isValidEmail('noatsign.com'), false)

  // Header injection attempts rejected
  assert.equal(isValidEmail('test@example.com\r\nBcc: victim@example.com'), false)
  assert.equal(isValidEmail('test@example.com\nSubject: Injected'), false)

  // Sanitizing headers
  assert.equal(sanitizeHeader('Team Name\r\nInjected'), 'Team Name  Injected')
  assert.equal(sanitizeHeader('  Alice Bob  '), 'Alice Bob')

  // Redacting secrets
  const secretKey = 'my-super-secret-brevo-key-999'
  const rawErr = `Failed to connect with key ${secretKey} and password=superSecretPass123`
  const cleaned = sanitizeErrorMessage(rawErr, [secretKey])
  assert.ok(!cleaned.includes(secretKey))
  assert.ok(!cleaned.includes('superSecretPass123'))
  assert.ok(cleaned.includes('***REDACTED***'))
})

test('createSmtpTransport detects configuration and handles port 587 STARTTLS correctly', () => {
  // Unconfigured environment
  const unconfigured = createSmtpTransport({})
  assert.equal(unconfigured.isConfigured, false)

  // Configured environment
  const configured = createSmtpTransport({
    SMTP_HOST: 'smtp-relay.brevo.com',
    SMTP_PORT: '587',
    SMTP_USER: 'brevo-login-user',
    SMTP_PASS: 'brevo-smtp-key-12345',
    SMTP_FROM_EMAIL: 'no-reply@cybersec-kgrcet.com',
    SMTP_FROM_NAME: 'KGRCET Hackathon 2027',
  })
  assert.equal(configured.isConfigured, true)
  assert.match(configured.from, /KGRCET Hackathon 2027/)
  assert.match(configured.from, /no-reply@cybersec-kgrcet.com/)
})

test('renderMemberConfirmationEmail generates personalized branding for leader and members', () => {
  const teamData = {
    teamName: 'CyberKnights',
    leadName: 'Jashanth Lead',
    email: 'jashanth@example.com',
    members: [
      { name: 'Member Alice', email: 'alice@example.com' },
      { name: 'Member Bob', email: 'bob@example.com' },
    ],
  }

  // Render for Leader
  const leadMail = renderMemberConfirmationEmail({
    recipient: { name: teamData.leadName, email: teamData.email, role: 'leader' },
    teamData,
    receipt: 'REG-1122334455667788',
    amount: 1947,
  })

  assert.match(leadMail.subject, /Registration Verified: Team CyberKnights/)
  assert.match(leadMail.subject, /REG-1122334455667788/)
  assert.match(leadMail.html, /Greetings, Jashanth Lead/)
  assert.match(leadMail.html, /TEAM LEADER/)
  assert.match(leadMail.html, /REG-1122334455667788/)
  assert.match(leadMail.html, /KGRCET(?:'|&#39;)s HACKATHON 2027/)
  assert.match(leadMail.html, /CYBERSECURITY &amp; ETHICAL HACKING CLUB/i)
  assert.match(leadMail.text, /Jashanth Lead/)

  // Render for Member
  const memberMail = renderMemberConfirmationEmail({
    recipient: { name: 'Member Alice', email: 'alice@example.com', role: 'member' },
    teamData,
    receipt: 'REG-1122334455667788',
    amount: 1947,
  })

  assert.match(memberMail.html, /Greetings, Member Alice/)
  assert.match(memberMail.html, /TEAM MEMBER/)
  assert.match(memberMail.html, /CyberKnights/)
})

test('outbox queue enqueues all members and processes deliveries sequentially', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'email-test-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const dbPath = join(dir, 'test.sqlite')
  const db = new DatabaseSync(dbPath)

  db.exec(`
    CREATE TABLE drafts (
      receipt TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      amount_rupees INTEGER,
      review_status TEXT NOT NULL,
      email_status TEXT,
      email_sent_count INTEGER DEFAULT 0,
      email_failed_count INTEGER DEFAULT 0,
      email_last_attempt_at INTEGER,
      email_last_error TEXT
    );
  `)
  initEmailTables(db)

  const teamData = {
    teamName: 'SecurityCrew',
    leadName: 'Leader John',
    email: 'john@example.com',
    members: [
      { name: 'Member Jane', email: 'jane@example.com' },
      { name: 'Member Jack', email: 'jack@example.com' },
    ],
  }

  const receipt = 'REG-AAAABBBBCCCCDDDD'
  db.prepare(`
    INSERT INTO drafts (receipt, data, amount_rupees, review_status)
    VALUES (?, ?, 1947, 'valid')
  `).run(receipt, JSON.stringify(teamData))

  // Enqueue confirmation emails
  const { outboxId, recipientCount } = enqueueConfirmationEmails(db, receipt)
  assert.equal(recipientCount, 3)

  // Verify DB state before processing
  const outboxRow = db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(outboxId)
  assert.equal(outboxRow.status, 'pending')
  assert.equal(outboxRow.recipient_count, 3)

  const recipientRows = db.prepare('SELECT * FROM email_recipients WHERE outbox_id = ?').all(outboxId)
  assert.equal(recipientRows.length, 3)
  assert.deepEqual(recipientRows.map((r) => r.email).sort(), ['jack@example.com', 'jane@example.com', 'john@example.com'])

  // Process queue with mock mailer
  const mockMailer = makeMockMailer()
  const result = await processEmailQueue(db, mockMailer, { delayBetweenEmailsMs: 10 })
  assert.equal(result.ran, true)
  assert.equal(mockMailer.sent.length, 3)

  // Verify outbox completed
  const finishedJob = db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(outboxId)
  assert.equal(finishedJob.status, 'sent')
  assert.equal(finishedJob.sent_count, 3)
  assert.equal(finishedJob.failed_count, 0)

  // Verify drafts table summary updated
  const updatedDraft = db.prepare('SELECT email_status, email_sent_count, email_failed_count FROM drafts WHERE receipt = ?').get(receipt)
  assert.equal(updatedDraft.email_status, 'sent')
  assert.equal(updatedDraft.email_sent_count, 3)
  assert.equal(updatedDraft.email_failed_count, 0)

  db.close()
})

test('partial delivery failure records individual recipient error and sets outbox to partial', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'email-fail-test-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const dbPath = join(dir, 'test.sqlite')
  const db = new DatabaseSync(dbPath)

  db.exec(`
    CREATE TABLE drafts (
      receipt TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      amount_rupees INTEGER,
      review_status TEXT NOT NULL,
      email_status TEXT,
      email_sent_count INTEGER DEFAULT 0,
      email_failed_count INTEGER DEFAULT 0,
      email_last_attempt_at INTEGER,
      email_last_error TEXT
    );
  `)
  initEmailTables(db)

  const teamData = {
    teamName: 'GlitchTeam',
    leadName: 'Leader Dave',
    email: 'dave@example.com',
    members: [{ name: 'Member Eve', email: 'eve-fail@example.com' }],
  }

  const receipt = 'REG-9999888877776666'
  db.prepare(`
    INSERT INTO drafts (receipt, data, amount_rupees, review_status)
    VALUES (?, ?, 1298, 'valid')
  `).run(receipt, JSON.stringify(teamData))

  enqueueConfirmationEmails(db, receipt)

  // Mock mailer that fails specifically for eve-fail@example.com
  const mockMailer = makeMockMailer({
    failEmails: ['"Member Eve" <eve-fail@example.com>'],
  })

  await processEmailQueue(db, mockMailer, { delayBetweenEmailsMs: 10 })

  const outboxJob = db.prepare('SELECT * FROM email_outbox WHERE receipt = ?').get(receipt)
  assert.equal(outboxJob.status, 'partial')
  assert.equal(outboxJob.sent_count, 1)
  assert.equal(outboxJob.failed_count, 1)

  const daveRec = db.prepare('SELECT status, last_error FROM email_recipients WHERE email = ?').get('dave@example.com')
  assert.equal(daveRec.status, 'sent')

  const eveRec = db.prepare('SELECT status, last_error FROM email_recipients WHERE email = ?').get('eve-fail@example.com')
  assert.equal(eveRec.status, 'failed')
  assert.match(eveRec.last_error, /Simulated delivery failure/)

  const draftRow = db.prepare('SELECT email_status, email_sent_count, email_failed_count FROM drafts WHERE receipt = ?').get(receipt)
  assert.equal(draftRow.email_status, 'partial')
  assert.equal(draftRow.email_sent_count, 1)
  assert.equal(draftRow.email_failed_count, 1)

  db.close()
})

test('full server integration: status change to valid enqueues emails, duplicate calls are ignored, and manual resend works', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'email-server-test-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const dbPath = join(dir, 'test.sqlite')
  const mockMailer = makeMockMailer()

  const adminHash = hashPassword(testAdminPassword)
  const adminAccounts = [{ email: testAdminEmail, name: 'Aluguri SaiVaibhav', passwordHash: adminHash }]

  const app = createApp({ dbPath, adminAccounts, mailer: mockMailer })
  let server, base
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
  t.after(() => {
    server.close()
  })

  async function call(method, path, body, cookie) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: base,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => null)
    const setCookie = res.headers.get('set-cookie')
    return { status: res.status, body: json, cookie: setCookie }
  }

  // 1. Log in as admin
  const loginRes = await call('POST', '/api/admin/login', { email: testAdminEmail, password: testAdminPassword })
  assert.equal(loginRes.status, 200)
  const adminCookie = loginRes.cookie.split(';')[0]

  // 2. Create a registration via spot registration
  const teamData = {
    teamName: 'AlphaSquad',
    teamSize: '2',
    college: 'KGRCET',
    leadName: 'Alpha Lead',
    email: 'alpha.lead@example.com',
    phone: '+919876543210',
    members: [{ name: 'Alpha Two', email: 'alpha.two@example.com', college: 'KGRCET' }],
  }

  const spotRes = await call('POST', '/api/admin/registrations', {
    data: teamData,
    paymentMethod: 'cash',
  }, adminCookie)

  assert.equal(spotRes.status, 201)
  const receipt = spotRes.body.registration.receipt
  assert.ok(receipt)

  // Wait a moment for background queue processing
  await new Promise((r) => setTimeout(r, 200))

  // Spot registration creates as valid and enqueues confirmation email
  const initialSentCount = mockMailer.sent.length
  assert.ok(initialSentCount >= 2, `Expected at least 2 emails sent for spot registration, got ${initialSentCount}`)

  // 3. Duplicate protection test:
  // If we call PUT /status with 'valid' again, it must NOT send duplicate emails
  const putValidRes = await call('PUT', `/api/admin/registrations/${receipt}/status`, { status: 'valid' }, adminCookie)
  assert.equal(putValidRes.status, 200)

  await new Promise((r) => setTimeout(r, 100))
  assert.equal(mockMailer.sent.length, initialSentCount, 'Repeated valid status update must NOT send duplicate emails')

  // 4. Manual Resend test:
  // Admin calls POST /resend-email
  const resendRes = await call('POST', `/api/admin/registrations/${receipt}/resend-email`, {}, adminCookie)
  assert.equal(resendRes.status, 200)
  assert.equal(resendRes.body.ok, true)

  // Wait for queue processing of resend
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(mockMailer.sent.length, initialSentCount + 2, 'Manual resend should dispatch emails to all team members again')

  // 5. Security: Unauthenticated resend must be denied
  const unauthRes = await call('POST', `/api/admin/registrations/${receipt}/resend-email`, {})
  assert.equal(unauthRes.status, 401)
})
