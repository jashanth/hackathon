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
 * Sanitizes header values to prevent CRLF injection attacks, header breakout,
 * and recipient injection via quotes/backslashes.
 */
export function sanitizeHeader(value) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["\\]/g, '')
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
  const members = Array.isArray(teamData.members) ? teamData.members : []
  const totalBuilders = members.length + 1

  const membersListHtml = [
    `<tr>
      <td style="padding: 12px 14px;${members.length > 0 ? ' border-bottom: 1px solid #1c1524;' : ''}">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="font-size: 14px; color: #f5efe3;">
              <span style="color: #dcb872; margin-right: 6px;">◆</span> <strong>${escapeHtml(teamData.leadName)}</strong> 
              <span style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #94897c;">(${escapeHtml(teamData.email)})</span>
            </td>
            <td align="right" style="font-family: 'Geist Mono', monospace; font-size: 10.5px; color: #dcb872; text-transform: uppercase; letter-spacing: 1px;">
              Leader
            </td>
          </tr>
        </table>
      </td>
    </tr>`,
    ...members.map(
      (m, idx) => `<tr>
      <td style="padding: 12px 14px;${idx === members.length - 1 ? '' : ' border-bottom: 1px solid #1c1524;'}">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="font-size: 14px; color: #f5efe3;">
              <span style="color: #b48ae0; margin-right: 6px;">◇</span> <strong>${escapeHtml(m.name)}</strong> 
              <span style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #94897c;">(${escapeHtml(m.email)})</span>
            </td>
            <td align="right" style="font-family: 'Geist Mono', monospace; font-size: 10.5px; color: #94897c; text-transform: uppercase; letter-spacing: 1px;">
              Member
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    ),
  ].join('')

  const membersListText = [
    `- ${teamData.leadName} (${teamData.email}) [Leader]`,
    ...members.map((m) => `- ${m.name} (${m.email}) [Member]`),
  ].join('\n')

  const subject = `Registration Verified: Team ${safeTeam} — ${event.name} (${safeReceipt})`

  const html = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(subject)}</title>
  
  <!-- Web fonts with web-safe fallbacks -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Geist+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-p-20 { padding: 24px 18px !important; }
      .mobile-title { font-size: 28px !important; line-height: 1.15 !important; }
      .mobile-stack { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #07060a; font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5efe3; -webkit-font-smoothing: antialiased;">

  <!-- Outer Canvas (Deep Obsidian / Void) -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060a; padding: 44px 12px;">
    <tr>
      <td align="center">
        
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #0e0b13; border: 1px solid #332718; border-radius: 4px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);">
          
          <!-- Top Celestial Gold Foil Accent Bar -->
          <tr>
            <td style="height: 3px; background: #dcb872; background: linear-gradient(90deg, #94702f 0%, #dcb872 30%, #fff4d6 50%, #dcb872 70%, #94702f 100%); font-size: 1px; line-height: 1px;">&nbsp;</td>
          </tr>

          <!-- Banner / Grand Header -->
          <tr>
            <td class="mobile-p-20" style="background-color: #120e18; background: linear-gradient(180deg, #171120 0%, #0e0b13 100%); padding: 36px 32px 30px; text-align: center; border-bottom: 1px solid #2a2016;">

              <!-- Organizer Moniker (Geist Mono) -->
              <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; font-weight: 500; color: #dcb872; letter-spacing: 2.2px; text-transform: uppercase; margin-bottom: 12px;">
                ✦ ${escapeHtml(event.organizer.toUpperCase())} · KGRCET ✦
              </div>

              <!-- Grand Hackathon Title (Cormorant Serif Display) -->
              <h1 class="mobile-title" style="margin: 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 35px; font-weight: 300; line-height: 1.1; letter-spacing: -0.01em; color: #ffffff;">
                KGRCET's HACKATHON <span style="font-style: italic; color: #dcb872; font-weight: 400;">2027</span>
              </h1>

              <!-- Tagline (Mono Spaced) -->
              <p style="margin: 10px 0 0 0; font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 400; color: #c2b9ab; letter-spacing: 2.4px; text-transform: uppercase;">
                ${escapeHtml(event.tagline)}
              </p>

            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="mobile-p-20" style="padding: 36px 32px;">
              
              <!-- Verification Pill (Website Gold & Foil Theme) -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 26px;">
                <tr>
                  <td style="background-color: #17130b; border: 1px solid #dcb872; padding: 6px 14px; border-radius: 2px;">
                    <span style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #f8e8c0; letter-spacing: 1.5px; text-transform: uppercase;">
                      ✓ OFFICIAL REGISTRATION VERIFIED
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Greeting (Cormorant Serif) -->
              <h2 style="margin: 0 0 12px 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 27px; font-weight: 400; color: #ffffff; letter-spacing: 0.01em; line-height: 1.2;">
                Greetings, ${escapeHtml(safeName)}
              </h2>
              
              <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.65; color: #c2b9ab;">
                Your registration credentials for <strong style="color: #f5efe3; font-weight: 600;">Team ${escapeHtml(safeTeam)}</strong> have been reviewed and verified by the organizing committee. Your team is officially confirmed to participate in <strong style="color: #dcb872; font-weight: 600;">${escapeHtml(event.name)}</strong>.
              </p>

              <!-- Registration Credentials Plaque -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #120e18; border: 1px solid #332718; border-left: 3px solid #dcb872; border-radius: 3px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 22px 20px;">
                    
                    <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; font-weight: 600; color: #dcb872; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #231b26;">
                      REGISTRATION CREDENTIALS
                    </div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px;">
                      
                      <!-- Registration ID -->
                      <tr>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; letter-spacing: 0.5px; text-transform: uppercase; width: 40%;">Registration ID:</td>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 14px; font-weight: 600; color: #dcb872; letter-spacing: 1.5px;">${escapeHtml(safeReceipt)}</td>
                      </tr>

                      <!-- Team Name -->
                      <tr>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; letter-spacing: 0.5px; text-transform: uppercase; border-top: 1px solid #1c1524;">Team Name:</td>
                        <td style="padding: 8px 0; color: #f5efe3; font-weight: 600; border-top: 1px solid #1c1524;">${escapeHtml(safeTeam)}</td>
                      </tr>

                      <!-- Role -->
                      <tr>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; letter-spacing: 0.5px; text-transform: uppercase; border-top: 1px solid #1c1524;">Designation:</td>
                        <td style="padding: 8px 0; border-top: 1px solid #1c1524;">
                          <span style="font-family: 'Geist Mono', monospace; font-size: 11px; font-weight: 600; color: #dcb872; background-color: #1f1814; border: 1px solid #4a3821; padding: 2px 8px; border-radius: 2px; letter-spacing: 0.8px; text-transform: uppercase;">
                            ${isLeader ? 'TEAM LEADER' : 'TEAM MEMBER'}
                          </span>
                        </td>
                      </tr>

                      <!-- Amount Paid -->
                      <tr>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; letter-spacing: 0.5px; text-transform: uppercase; border-top: 1px solid #1c1524;">Registration Fee:</td>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 13.5px; color: #f8e8c0; font-weight: 600; border-top: 1px solid #1c1524;">₹${Number(amount || 0).toLocaleString('en-IN')} <span style="font-size: 11px; color: #94897c; font-weight: 400;">(Paid &amp; Verified)</span></td>
                      </tr>

                    </table>
                  </td>
                </tr>
              </table>

              <!-- Member List -->
              <div style="margin-bottom: 28px;">
                <h3 style="margin: 0 0 12px 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 20px; font-weight: 400; color: #f5efe3; letter-spacing: 0.02em;">
                  Member List <span style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #94897c;">(${totalBuilders} Builder${totalBuilders === 1 ? '' : 's'})</span>
                </h3>
                
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0e0b13; border: 1px solid #231b26; border-radius: 3px;">
                  ${membersListHtml}
                </table>
              </div>

              <!-- Event Schedule & Venue (Amethyst Cosmic Card) -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #140d1e; border: 1px solid #37254b; border-radius: 3px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #b48ae0; text-transform: uppercase; letter-spacing: 1.8px; margin-bottom: 12px;">
                      ✦ EVENT SCHEDULE &amp; VENUE
                    </div>
                    
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13.5px; line-height: 1.6;">
                      <tr>
                        <td style="padding: 6px 0; width: 22%; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; vertical-align: top;">Dates:</td>
                        <td style="padding: 6px 0; color: #f5efe3;">
                          <strong style="color: #f8e8c0;">${escapeHtml(event.dates)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; vertical-align: top; border-top: 1px solid #231633;">Theme:</td>
                        <td style="padding: 6px 0; color: #f5efe3; border-top: 1px solid #231633;">${escapeHtml(event.theme)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; vertical-align: top; border-top: 1px solid #231633;">Venue:</td>
                        <td style="padding: 6px 0; color: #c2b9ab; border-top: 1px solid #231633;">${escapeHtml(event.venue)}</td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <!-- Queries -->
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #94897c; text-align: center;">
                Need assistance or have travel queries? Contact the coordination team at<br>
                <a href="mailto:${escapeHtml(event.contactEmail)}" style="color: #dcb872; text-decoration: underline; text-underline-offset: 3px; font-family: 'Geist Mono', monospace; font-size: 12.5px;">${escapeHtml(event.contactEmail)}</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #07060a; border-top: 1px solid #2a2016; padding: 24px 28px; text-align: center;">
              
              <p style="margin: 0 0 6px 0; font-family: 'Geist Mono', monospace; font-size: 11px; color: #94897c; letter-spacing: 1.5px; text-transform: uppercase;">
                ${escapeHtml(event.name)} · ${escapeHtml(event.organizer.toUpperCase())}
              </p>
              
              <p style="margin: 0; font-size: 11px; color: #5a534c; line-height: 1.5;">
                This is an official verification credential dispatched to registered participants.
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

Greetings, ${safeName}

Your registration credentials for Team "${safeTeam}" have been reviewed and verified by the organizing committee. Your team is officially confirmed to participate in ${event.name}.

REGISTRATION CREDENTIALS:
--------------------------------------------------
Registration ID : ${safeReceipt}
Team Name       : ${safeTeam}
Designation     : ${isLeader ? 'TEAM LEADER' : 'TEAM MEMBER'}
Registration Fee: ₹${Number(amount || 0).toLocaleString('en-IN')} (Paid & Verified)

MEMBER LIST:
--------------------------------------------------
${membersListText}

EVENT SCHEDULE & VENUE:
--------------------------------------------------
Dates : ${event.dates}
Theme : ${event.theme}
Venue : ${event.venue}

Queries: ${event.contactEmail}

Organized by ${event.organizer}
==================================================
  `.trim()

  return { subject, html, text }
}
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
