import nodemailer from 'nodemailer'

/**
 * Validates an email address against RFC 5322 pattern and checks for header injection.
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false
  const trimmed = email.trim()
  if (trimmed.length > 254 || trimmed.length < 5) return false
  if (/[\r\n\t]/.test(trimmed)) return false
  // Standard RFC 5322 compatible regex
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(trimmed)
}

/**
 * Sanitizes header values to prevent CRLF injection attacks.
 */
export function sanitizeHeader(value) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
}

/**
 * Strips secret tokens/passwords from error messages before logging or saving to SQLite.
 */
export function sanitizeErrorMessage(message, secrets = []) {
  let text = String(message || '')
  for (const secret of secrets) {
    if (secret && typeof secret === 'string' && secret.length >= 4) {
      text = text.replaceAll(secret, '***REDACTED***')
    }
  }
  return text.replace(/(pass(?:word)?[:=]\s*)[^\s&]+/gi, '$1***REDACTED***')
}

/**
 * HTML escaper for safe email rendering.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Default event metadata for KGRCET Hackathon 2027.
 */
export const EVENT_DETAILS = {
  name: "KGRCET's HACKATHON 2027",
  tagline: '36-HOUR NATIONAL LEVEL HACKATHON',
  dates: 'February 19–20, 2027',
  duration: '36 Hours Non-Stop Sprint',
  theme: 'Autonomous AI, Cybersecurity & Breakthrough Systems',
  venue: 'KG Reddy College of Engineering & Technology, Beside Moinabad Police Station, Chilkur, Moinabad, Hyderabad, Telangana - 501504',
  organizer: 'Cybersecurity & Ethical Hacking Club (CSEH Club)',
  contactEmail: 'cseh@kgrcet.edu.in',
}

/**
 * Generates personalized HTML and plain text confirmation emails for an individual team member.
 */
export function renderMemberConfirmationEmail({ recipient, teamData, receipt, amount, event = EVENT_DETAILS }) {
  const safeName = sanitizeHeader(recipient.name || 'Hacker')
  const safeTeam = sanitizeHeader(teamData.teamName || 'Your Team')
  const safeReceipt = sanitizeHeader(receipt)
  const isLeader = recipient.role === 'leader'

  const membersListHtml = [
    `<li style="margin-bottom: 6px;"><strong>${escapeHtml(teamData.leadName)}</strong> (${escapeHtml(teamData.email)}) — <em>Team Leader</em></li>`,
    ...(teamData.members || []).map(
      (m) => `<li style="margin-bottom: 6px;"><strong>${escapeHtml(m.name)}</strong> (${escapeHtml(m.email)}) — <em>Member</em></li>`
    ),
  ].join('')

  const membersListText = [
    `- ${teamData.leadName} (${teamData.email}) [Team Leader]`,
    ...(teamData.members || []).map((m) => `- ${m.name} (${m.email}) [Member]`),
  ].join('\n')

  const subject = `Registration Verified: Team ${safeTeam} — ${event.name} (${safeReceipt})`

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b0f19; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
          
          <!-- Banner / Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0284c7 100%); padding: 36px 28px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <div style="font-size: 11px; font-weight: 700; color: #38bdf8; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px;">
                ORGANIZED BY ${escapeHtml(event.organizer.toUpperCase())}
              </div>
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2;">
                ${escapeHtml(event.name)}
              </h1>
              <p style="margin: 8px 0 0 0; color: #cbd5e1; font-size: 13px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase;">
                ${escapeHtml(event.tagline)}
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 28px;">
              
              <!-- Verification Pill -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #065f46; color: #34d399; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; padding: 6px 14px; border-radius: 999px; text-transform: uppercase; border: 1px solid #059669;">
                    ✓ Registration Verified &amp; Confirmed
                  </td>
                </tr>
              </table>

              <!-- Greeting -->
              <h2 style="margin: 0 0 14px 0; color: #f9fafb; font-size: 20px; font-weight: 700;">
                Hello, ${escapeHtml(safeName)}!
              </h2>
              <p style="margin: 0 0 24px 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Great news! Your registration for <strong style="color: #f3f4f6;">Team ${escapeHtml(safeTeam)}</strong> has been verified by the organizing committee. Your team is officially confirmed to participate in <strong style="color: #f3f4f6;">${escapeHtml(event.name)}</strong>.
              </p>

              <!-- Registration Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px;">
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; width: 38%;">Registration ID:</td>
                        <td style="padding: 6px 0; color: #38bdf8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700;">${escapeHtml(safeReceipt)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;">Team Name:</td>
                        <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${escapeHtml(safeTeam)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;">Your Role:</td>
                        <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${isLeader ? 'Team Leader' : 'Team Member'}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;">Total Paid:</td>
                        <td style="padding: 6px 0; color: #34d399; font-weight: 700;">₹${Number(amount || 0).toLocaleString('en-IN')}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Team Roster -->
              <div style="margin-bottom: 28px;">
                <h3 style="margin: 0 0 12px 0; color: #f3f4f6; font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  Team Roster (${(teamData.members || []).length + 1} Hacker${(teamData.members || []).length === 0 ? '' : 's'})
                </h3>
                <ul style="margin: 0; padding-left: 20px; color: #9ca3af; font-size: 14px; line-height: 1.6;">
                  ${membersListHtml}
                </ul>
              </div>

              <!-- Event Details Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #1e1b4b; border: 1px solid #312e81; border-radius: 8px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="font-size: 12px; font-weight: 700; color: #a5b4fc; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                      Event Schedule &amp; Venue
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13.5px; color: #cbd5e1; line-height: 1.6;">
                      <tr>
                        <td style="padding: 4px 0; width: 24%; color: #94a3b8; vertical-align: top;"><strong>Dates:</strong></td>
                        <td style="padding: 4px 0; color: #f8fafc;">${escapeHtml(event.dates)} (${escapeHtml(event.duration)})</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #94a3b8; vertical-align: top;"><strong>Theme:</strong></td>
                        <td style="padding: 4px 0; color: #f8fafc;">${escapeHtml(event.theme)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #94a3b8; vertical-align: top;"><strong>Venue:</strong></td>
                        <td style="padding: 4px 0; color: #f8fafc;">${escapeHtml(event.venue)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Important Check-in Instructions -->
              <div style="background-color: #172554; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 0 6px 6px 0; margin-bottom: 28px;">
                <h4 style="margin: 0 0 6px 0; color: #93c5fd; font-size: 14px;">Important Check-In Instructions:</h4>
                <p style="margin: 0; color: #bfdbfe; font-size: 13px; line-height: 1.5;">
                  • Please carry your valid College Identity Card and this confirmation email (digital or printed).<br>
                  • Keep your Registration ID (<strong>${escapeHtml(safeReceipt)}</strong>) ready at the welcome desk.<br>
                  • Remember to bring your own laptops, chargers, and extension cords for the 36-hour sprint.
                </p>
              </div>

              <!-- Queries -->
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">
                Have questions or need assistance? Reach out to the organizing team at 
                <a href="mailto:${escapeHtml(event.contactEmail)}" style="color: #38bdf8; text-decoration: none;">${escapeHtml(event.contactEmail)}</a>.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; border-top: 1px solid #1f2937; padding: 24px 28px; text-align: center;">
              <p style="margin: 0 0 6px 0; color: #94a3b8; font-size: 12px;">
                ${escapeHtml(event.name)} · ${escapeHtml(event.organizer)}
              </p>
              <p style="margin: 0; color: #475569; font-size: 11px;">
                This is an automated confirmation sent to verified participants.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const text = `
==================================================
${event.name} — REGISTRATION VERIFIED
${event.tagline}
==================================================

Hello, ${safeName}!

Your registration for Team "${safeTeam}" has been verified and confirmed by the organizing committee.

REGISTRATION DETAILS:
--------------------------------------------------
Registration ID : ${safeReceipt}
Team Name       : ${safeTeam}
Your Role       : ${isLeader ? 'Team Leader' : 'Team Member'}
Total Paid      : ₹${Number(amount || 0).toLocaleString('en-IN')}

TEAM ROSTER:
--------------------------------------------------
${membersListText}

EVENT SCHEDULE & VENUE:
--------------------------------------------------
Dates   : ${event.dates} (${event.duration})
Theme   : ${event.theme}
Venue   : ${event.venue}

CHECK-IN INSTRUCTIONS:
- Carry your valid College Identity Card.
- Have your Registration ID (${safeReceipt}) ready at the check-in desk.
- Bring your laptops, chargers, and build essentials.

Queries: ${event.contactEmail}

Organized by ${event.organizer}
==================================================
  `.trim()

  return { subject, html, text }
}

/**
 * Creates and validates the Nodemailer Brevo SMTP transport.
 * Falls back to dry-run simulation mode when SMTP credentials are not configured.
 */
export function createSmtpTransport(env = process.env) {
  const host = sanitizeHeader(env.SMTP_HOST || 'smtp-relay.brevo.com')
  const port = Number(env.SMTP_PORT || 587)
  const user = env.SMTP_USER ? String(env.SMTP_USER).trim() : ''
  const pass = env.SMTP_PASS ? String(env.SMTP_PASS).trim() : ''
  const fromEmail = sanitizeHeader(env.SMTP_FROM_EMAIL || 'no-reply@cybersec-kgrcet.com')
  const fromName = sanitizeHeader(env.SMTP_FROM_NAME || 'KGRCET Hackathon')

  const isConfigured = Boolean(user && pass)

  if (!isConfigured) {
    return {
      isConfigured: false,
      from: `"${fromName}" <${fromEmail}>`,
      fromEmail,
      fromName,
      sendMail: async (options) => {
        return {
          messageId: `dry-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          accepted: [options.to],
          rejected: [],
          response: '250 Dry-run simulated (SMTP credentials not configured in environment)',
        }
      },
      verify: async () => false,
    }
  }

  // Production Brevo SMTP using STARTTLS on port 587
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: {
      user,
      pass,
    },
    tls: {
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })

  return {
    isConfigured: true,
    from: `"${fromName}" <${fromEmail}>`,
    fromEmail,
    fromName,
    sendMail: (options) => transporter.sendMail(options),
    verify: () => transporter.verify(),
    transporter,
  }
}

/**
 * Initializes SQLite tables for email outbox and recipient delivery tracking.
 */
export function initEmailTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_type TEXT NOT NULL DEFAULT 'status_valid',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_attempt_at INTEGER,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS email_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbox_id INTEGER NOT NULL REFERENCES email_outbox(id) ON DELETE CASCADE,
      receipt TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_receipt ON email_outbox(receipt);
    CREATE INDEX IF NOT EXISTS idx_email_recipients_outbox ON email_recipients(outbox_id);
  `)
}

/**
 * Enqueues confirmation emails for all members of a registration.
 * Ensures transactional atomicity and returns the created outbox id.
 */
export function enqueueConfirmationEmails(db, receipt, { triggerType = 'status_valid' } = {}) {
  const row = db.prepare('SELECT data, amount_rupees, review_status FROM drafts WHERE receipt = ?').get(receipt)
  if (!row) {
    throw new Error(`Registration not found: ${receipt}`)
  }

  const teamData = JSON.parse(row.data)
  const recipients = []

  // 1. Team Leader
  if (teamData.email && isValidEmail(teamData.email)) {
    recipients.push({
      email: teamData.email.trim().toLowerCase(),
      name: teamData.leadName || 'Team Leader',
      role: 'leader',
    })
  }

  // 2. Members
  if (Array.isArray(teamData.members)) {
    for (const m of teamData.members) {
      if (m?.email && isValidEmail(m.email)) {
        recipients.push({
          email: m.email.trim().toLowerCase(),
          name: m.name || 'Team Member',
          role: 'member',
        })
      }
    }
  }

  if (recipients.length === 0) {
    throw new Error(`No valid recipient emails found for registration: ${receipt}`)
  }

  const now = Date.now()

  // Execute in a transaction for atomicity
  db.exec('BEGIN IMMEDIATE')
  try {
    const outboxInsert = db.prepare(`
      INSERT INTO email_outbox (receipt, status, trigger_type, recipient_count, sent_count, failed_count, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, 0, 0, 0, 3, ?, ?)
    `).run(receipt, triggerType, recipients.length, now, now)

    const outboxId = Number(outboxInsert.lastInsertRowid)

    const recipientInsert = db.prepare(`
      INSERT INTO email_recipients (outbox_id, receipt, email, name, role, status, attempt_count)
      VALUES (?, ?, ?, ?, ?, 'pending', 0)
    `)

    for (const r of recipients) {
      recipientInsert.run(outboxId, receipt, r.email, r.name, r.role)
    }

    db.prepare(`
      UPDATE drafts 
      SET email_status = 'pending', email_last_attempt_at = ?
      WHERE receipt = ?
    `).run(now, receipt)

    db.exec('COMMIT')
    return { outboxId, recipientCount: recipients.length }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/**
 * In-memory concurrency lock to prevent overlapping queue executions.
 */
let isQueueProcessing = false

/**
 * Processes pending items in the email outbox.
 * Loops through pending jobs, sends to each recipient, tracks delivery, and updates states.
 */
export async function processEmailQueue(db, mailer, { delayBetweenEmailsMs = 80, secrets = [] } = {}) {
  if (isQueueProcessing) {
    return { ran: false, reason: 'already_running' }
  }

  isQueueProcessing = true
  try {
    let processedCount = 0

    while (true) {
      // Find the oldest pending or retryable outbox job
      let job
      try {
        job = db.prepare(`
          SELECT id, receipt, trigger_type, recipient_count, attempt_count, max_attempts
          FROM email_outbox
          WHERE status IN ('pending', 'retry')
          ORDER BY id ASC
          LIMIT 1
        `).get()
      } catch (err) {
        if (err.message && err.message.includes('database is not open')) {
          return { ran: false, reason: 'database_closed' }
        }
        throw err
      }

      if (!job) break

      const outboxId = job.id
      const receipt = job.receipt
      const now = Date.now()

      // Claim job atomically
      db.prepare(`
        UPDATE email_outbox 
        SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?, last_attempt_at = ?
        WHERE id = ?
      `).run(now, now, outboxId)

      db.prepare(`UPDATE drafts SET email_status = 'sending', email_last_attempt_at = ? WHERE receipt = ?`).run(now, receipt)

      // Fetch registration data
      const regRow = db.prepare('SELECT data, amount_rupees FROM drafts WHERE receipt = ?').get(receipt)
      const teamData = regRow ? JSON.parse(regRow.data) : { teamName: 'Hackathon Team', leadName: 'Leader', members: [] }
      const amount = regRow?.amount_rupees ?? 0

      // Fetch pending recipients for this outbox job
      const recipients = db.prepare(`
        SELECT id, email, name, role, status
        FROM email_recipients
        WHERE outbox_id = ?
      `).all(outboxId)

      let sentCount = 0
      let failedCount = 0
      let lastError = null

      for (const recipient of recipients) {
        if (recipient.status === 'sent') {
          sentCount++
          continue
        }

        try {
          const emailContent = renderMemberConfirmationEmail({
            recipient,
            teamData,
            receipt,
            amount,
          })

          await mailer.sendMail({
            from: mailer.from,
            to: `"${sanitizeHeader(recipient.name)}" <${recipient.email}>`,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          })

          db.prepare(`
            UPDATE email_recipients 
            SET status = 'sent', sent_at = ?, attempt_count = attempt_count + 1, last_error = NULL
            WHERE id = ?
          `).run(Date.now(), recipient.id)

          sentCount++
        } catch (sendErr) {
          failedCount++
          const safeError = sanitizeErrorMessage(sendErr.message, secrets)
          lastError = safeError

          db.prepare(`
            UPDATE email_recipients 
            SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?
            WHERE id = ?
          `).run(safeError, recipient.id)
        }

        // Brevo rate-limiting delay between sequential recipient messages
        if (delayBetweenEmailsMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenEmailsMs))
        }
      }

      // Determine overall outbox status
      let finalStatus
      if (failedCount === 0) {
        finalStatus = 'sent'
      } else if (sentCount > 0) {
        finalStatus = 'partial'
      } else {
        // Complete failure
        finalStatus = job.attempt_count + 1 < job.max_attempts ? 'retry' : 'failed'
      }

      const finishTime = Date.now()

      db.prepare(`
        UPDATE email_outbox
        SET status = ?, sent_count = ?, failed_count = ?, updated_at = ?, last_error = ?
        WHERE id = ?
      `).run(finalStatus, sentCount, failedCount, finishTime, lastError, outboxId)

      // Update summary fields on drafts table
      db.prepare(`
        UPDATE drafts
        SET email_status = ?, email_sent_count = ?, email_failed_count = ?, email_last_attempt_at = ?, email_last_error = ?
        WHERE receipt = ?
      `).run(finalStatus, sentCount, failedCount, finishTime, lastError, receipt)

      processedCount++
    }

    return { ran: true, processedCount }
  } finally {
    isQueueProcessing = false
  }
}
