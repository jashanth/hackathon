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
  organizer: 'Cybersecurity & Ethical Hacking Club (CSEH)',
  contactEmail: 'cseh@kgrcet.edu.in',
  websiteUrl: 'https://hackathon.cybersec-kgrcet.com/',
  logoUrl: 'https://hackathon.cybersec-kgrcet.com/assets/kgrcet-logo.png',
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

                      ${teamData.domain ? `<!-- Challenge Domain -->
                      <tr>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; letter-spacing: 0.5px; text-transform: uppercase; border-top: 1px solid #1c1524;">Challenge Track:</td>
                        <td style="padding: 8px 0; font-family: 'Geist Mono', monospace; font-size: 12.5px; color: #dcb872; font-weight: 500; border-top: 1px solid #1c1524;">${escapeHtml(teamData.domain)}</td>
                      </tr>` : ''}

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

export function toTitleCase(fullName) {
  if (!fullName || typeof fullName !== 'string') return ''
  return fullName.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase())
}

/**
 * Converts a recipient name to Title Case, normalizing honorific prefixes ("Dr.", "Prof.")
 * and initials, avoiding uppercase names.
 */
export function formatRecipientName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Sir / Madam'
  let trimmed = fullName.trim()
  if (!trimmed || /^(?:sir|madam|sir\s*\/\s*madam|to whom it may concern|respected sir|respected madam|all)$/i.test(trimmed)) {
    return 'Sir / Madam'
  }

  // Strip leading salutation if present in the name field
  trimmed = trimmed.replace(/^(?:respected|dear)\s+/i, '').trim()
  if (!trimmed) return 'Sir / Madam'

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const formatted = tokens.map((token) => {
    const lower = token.toLowerCase()
    if (lower === 'dr' || lower === 'dr.') return 'Dr.'
    if (lower === 'prof' || lower === 'prof.' || lower === 'professor') return 'Prof.'
    if (lower === 'mr' || lower === 'mr.') return 'Mr.'
    if (lower === 'ms' || lower === 'ms.') return 'Ms.'
    if (lower === 'mrs' || lower === 'mrs.') return 'Mrs.'
    // Handle single-letter initials like "K." or "K"
    if (/^[a-zA-Z]\.?$/.test(token)) {
      return token.charAt(0).toUpperCase() + '.'
    }
    // Handle hyphenated names like "Smith-Jones"
    if (token.includes('-')) {
      return token
        .split('-')
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''))
        .join('-')
    }
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  })

  return formatted.join(' ')
}

/**
 * Extracts a polite last name for formal salutation (e.g. "Dr. Ramesh Kumar" -> "Kumar", "Prof. K. S. Rao" -> "Rao").
 * Falls back to "Professor" if the name is generic, empty, or unparseable.
 * Always formats in Title Case.
 */
export function extractLastName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Professor'
  const trimmed = fullName.trim()
  if (/^(?:sir|madam|sir\s*\/\s*madam|to whom it may concern|respected sir|respected madam|all)$/i.test(trimmed)) {
    return 'Professor'
  }
  const cleaned = trimmed.replace(/^(?:dr\.?|prof\.?|professor|mr\.?|ms\.?|mrs\.?|shri|smt\.?)\s+/i, '').trim()
  if (!cleaned) return 'Professor'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  let last = parts[parts.length - 1]
  if (last.replace(/\./g, '').length <= 1 && parts.length > 1) {
    last = parts[0]
  }
  const result = last ? last.replace(/[^a-zA-Z]/g, '') : ''
  if (!result || result.toLowerCase() === 'professor') return 'Professor'
  return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase()
}

/**
 * Formats a personalized salutation handling "Prof./Dr." prefixes in proper case.
 * e.g. "DR. RAMESH KUMAR" -> "Dear Dr. Kumar,"
 *      "PROF. ANITHA RAO" -> "Dear Prof. Rao,"
 *      "suresh reddy" (HOD) -> "Dear Prof. Reddy,"
 */
export function extractSalutation(fullName, designation = '') {
  if (!fullName || typeof fullName !== 'string') return 'Respected Sir / Madam,'
  const trimmed = fullName.trim()
  if (!trimmed || /^(?:sir|madam|sir\s*\/\s*madam|to whom it may concern|respected sir|respected madam|all)$/i.test(trimmed)) {
    return 'Respected Sir / Madam,'
  }

  const formatted = formatRecipientName(trimmed)
  return `Respected ${formatted},`
}

/**
 * Returns optimized sender information for invitations to minimize promotions tab classification.
 * Sender display name defaults to "CSEH Club - KGRCET" to avoid individual personal sender confusion.
 */
export function getInvitationSender({
  senderName,
  env = process.env,
} = {}) {
  const defaultSenderName = 'CSEH Club - KGRCET'
  const fromName = sanitizeHeader(
    env.SMTP_INVITE_FROM_NAME ||
    (senderName && senderName !== 'Sai Vaibhav' && senderName !== 'Jashanth Gonipati'
      ? (senderName.includes('KGRCET') ? senderName : `${senderName} - KGRCET`)
      : defaultSenderName)
  )
  const fromEmail = sanitizeHeader(
    env.SMTP_INVITE_FROM_EMAIL ||
    env.SMTP_FROM_EMAIL ||
    'cseh@kgrcet.edu.in'
  )
  const replyTo = sanitizeHeader(env.SMTP_REPLY_TO || EVENT_DETAILS.contactEmail || 'cseh@kgrcet.edu.in')

  return {
    from: `"${fromName}" <${fromEmail}>`,
    fromName,
    fromEmail,
    replyTo,
  }
}

/**
 * Standard body text for official KGRCET Hackathon 2027 faculty invitations.
 * Formatted as a personal, 1-to-1 letter to avoid Gmail Promotions / Spam filters.
 */
export const INVITATION_BODY = `Respected {RecipientName},

On behalf of the Department of Computer Science and Engineering at KG Reddy College of Engineering & Technology (KGRCET), Hyderabad, we cordially invite your students to participate in **KGRCET's Hackathon 2027**, a 36-hour national-level hackathon organized by our Cybersecurity & Ethical Hacking Club (CSEH Club), in association with the Blockchain Club and CSI Student Chapter.

We are bringing together 700+ student developers and innovators from across the country to solve real-world industry problems. We would greatly appreciate your support in sharing this opportunity with your students.

Event Overview:
• Dates: February 19–20, 2027 (36 Hours)
• Venue: KGRCET Campus, Moinabad, Hyderabad
• Team Size: 2–4 Students
• Prize Pool: ₹1,00,000 (Provisional)

Challenge Domains:
1. Generative AI & LLM Applications
2. Cybersecurity & Digital Forensics
3. FinTech & Blockchain
4. HealthTech & Mental Well-being
5. Open Innovation

Student teams can find the full details and register directly on our official portal: https://hackathon.cybersec-kgrcet.com/

Warm regards,
Cybersecurity & Ethical Hacking Club (CSEH)
In association with Blockchain Club & CSI Student Chapter
KG Reddy College of Engineering & Technology
Hyderabad, Telangana, India

If you'd rather not hear from us, reply STOP and we won't write again.`

/**
 * External college invitation message copy.
 */
export const EXTERNAL_INVITATION_BODY = `KG Reddy College of Engineering & Technology (KGRCET), Hyderabad, is pleased to invite your institution to participate in **KGRCET's Hackathon 2027**, a 36-hour national-level hackathon organized by our Cybersecurity & Ethical Hacking Club (CSEH Club), in association with the Blockchain Club and CSI Student Chapter. We welcome students from your institution to be part of this event and showcase their innovation, technical skills, and problem-solving abilities. We are bringing together 700+ student developers and innovators from across the country to solve real-world industry problems. We would greatly appreciate your support in sharing this opportunity with your students.

Event Overview:
• Dates: February 19–20, 2027 (36 Hours)
• Venue: KGRCET Campus, Moinabad, Hyderabad
• Team Size: 2–4 Students
• Prize Pool: ₹1,00,000 (Provisional)

Challenge Domains:
1. Generative AI & LLM Applications
2. Cybersecurity & Digital Forensics
3. FinTech & Blockchain
4. HealthTech & Mental Well-being
5. Open Innovation

Student teams can find the full details and register directly on our official portal: https://hackathon.cybersec-kgrcet.com/

Warm regards,
Cybersecurity & Ethical Hacking Club (CSEH)
In association with Blockchain Club & CSI Student Chapter
KG Reddy College of Engineering & Technology
Hyderabad, Telangana, India

If you'd rather not hear from us, reply STOP and we won't write again.`

/**
 * Custom / Dignitary (Principal / Director / Others) invitation message copy.
 */
export const CUSTOM_INVITATION_BODY = `On behalf of the Department of Computer Science and Engineering at KG Reddy College of Engineering & Technology (KGRCET), Hyderabad, we cordially invite you to be a part of **KGRCET's Hackathon 2027**, a 36-hour national-level hackathon organized by our Cybersecurity & Ethical Hacking Club (CSEH Club), in association with the Blockchain Club and CSI Student Chapter.

Your presence would be a great honour and would add immense value to this event as we bring together innovative minds to collaborate, build, and solve real-world challenges.

We are bringing together 700+ student developers and innovators from across the country to solve real-world industry problems. We would greatly appreciate your support in sharing this opportunity with your students.

Event Overview:
• Dates: February 19–20, 2027 (36 Hours)
• Venue: KGRCET Campus, Moinabad, Hyderabad
• Team Size: 2–4 Students
• Prize Pool: ₹1,00,000 (Provisional)

Challenge Domains:
1. Generative AI & LLM Applications
2. Cybersecurity & Digital Forensics
3. FinTech & Blockchain
4. HealthTech & Mental Well-being
5. Open Innovation

Student teams can find the full details and register directly on our official portal: https://hackathon.cybersec-kgrcet.com/

Warm regards,
Cybersecurity & Ethical Hacking Club (CSEH)
In association with Blockchain Club & CSI Student Chapter
KG Reddy College of Engineering & Technology
Hyderabad, Telangana, India

If you'd rather not hear from us, reply STOP and we won't write again.`

/**
 * Predefined invitation templates for different dignitary and partner categories.
 * All templates are drafted as personal single-column letters without marketing buzzwords or ALL CAPS.
 */
export const INVITATION_TEMPLATES = {
  internal: {
    id: 'internal',
    name: 'Internal College Invitation',
    category: 'Internal College',
    subject: 'KGRCET Hackathon 2027',
    message: INVITATION_BODY,
  },
  external: {
    id: 'external',
    name: 'External College Invitation',
    category: 'External College',
    subject: 'KGRCET Hackathon 2027',
    message: EXTERNAL_INVITATION_BODY,
  },
  sponsor: {
    id: 'sponsor',
    name: 'Sponsor Invitation',
    category: 'Sponsor',
    subject: 'KGRCET Hackathon 2027',
    message: INVITATION_BODY,
  },
  custom: {
    id: 'custom',
    name: 'Custom (Principal / Director / Others)',
    category: 'Custom',
    subject: 'KGRCET Hackathon 2027',
    message: CUSTOM_INVITATION_BODY,
  },
}

// Aliases for backwards compatibility
INVITATION_TEMPLATES.official = INVITATION_TEMPLATES.internal
INVITATION_TEMPLATES.college = INVITATION_TEMPLATES.external

/**
 * Renders the official dark celestial gold theme around the invitation letter.
 * Features Obsidian black canvas, celestial gold foil bar, grand Cormorant header,
 * college logo plate, official invitation pill, styled event overview & domain plaques,
 * official portal CTA button, and formal institutional footer.
 */
function renderInvitationHtmlTheme({ subject, paragraphs, formattedRecipient, effectiveSender, event = EVENT_DETAILS }) {
  const contentHtml = paragraphs
    .map((p) => {
      const trimmed = p.trim()
      if (!trimmed) return ''

      // Salutation line
      if (/^(?:respected|dear)\s+/i.test(trimmed) && trimmed.split('\n').length <= 2) {
        return `<h2 style="margin: 0 0 18px 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 26px; font-weight: 400; color: #ffffff; letter-spacing: 0.01em; line-height: 1.2;">${escapeHtml(trimmed)}</h2>`
      }

      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)

      // Ordered / Numbered list (e.g. Challenge Domains)
      if (lines.length > 1 && lines.slice(1).every((l) => /^\d+[\.)]\s*/.test(l))) {
        const header = lines[0]
        const items = lines.slice(1)
        const rows = items
          .map((item, idx) => {
            const num = (idx + 1).toString().padStart(2, '0')
            const content = escapeHtml(item.replace(/^\d+[\.)]\s*/, ''))
            const isLast = idx === items.length - 1
            return `<tr>
              <td style="padding: 10px 14px;${isLast ? '' : ' border-bottom: 1px solid #231633;'} color: #f5efe3; font-size: 13.5px;">
                <span style="font-family: 'Geist Mono', SFMono-Regular, Menlo, monospace; color: #dcb872; font-weight: 600; margin-right: 10px;">${num}</span>
                <strong>${content}</strong>
              </td>
              <td align="right" style="padding: 10px 14px;${isLast ? '' : ' border-bottom: 1px solid #231633;'} font-family: 'Geist Mono', SFMono-Regular, Menlo, monospace; font-size: 10px; color: #94897c; text-transform: uppercase; letter-spacing: 1px;">
                Track ${num}
              </td>
            </tr>`
          })
          .join('')

        return `
          <!-- Challenge Domains (Amethyst Cosmic Card) -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #140d1e; border: 1px solid #37254b; border-radius: 3px; margin: 24px 0;">
            <tr>
              <td style="padding: 20px;">
                <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; font-weight: 600; color: #b48ae0; text-transform: uppercase; letter-spacing: 1.8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #261738;">
                  ✦ ${escapeHtml(header.toUpperCase())}
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0e0914; border: 1px solid #231633; border-radius: 3px;">
                  ${rows}
                </table>
              </td>
            </tr>
          </table>`
      }

      // Unordered / Bullet list (e.g. Event Overview)
      if (lines.length > 1 && lines.slice(1).every((item) => item.startsWith('- ') || item.startsWith('• '))) {
        const header = lines[0]
        const items = lines.slice(1)
        const rows = items
          .map((item, idx) => {
            const raw = item.replace(/^[-•]\s*/, '')
            const colonIdx = raw.indexOf(':')
            const label = colonIdx !== -1 ? raw.slice(0, colonIdx).trim() : ''
            const val = colonIdx !== -1 ? raw.slice(colonIdx + 1).trim() : raw
            return `<tr>
              <td style="padding: 8px 0; width: 32%; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; vertical-align: top;${idx > 0 ? ' border-top: 1px solid #1c1524;' : ''}">
                ${escapeHtml(label)}:
              </td>
              <td style="padding: 8px 0; color: ${label.toLowerCase().includes('prize') ? '#dcb872' : label.toLowerCase().includes('date') ? '#f8e8c0' : '#f5efe3'}; font-weight: 500; font-size: 13.5px;${idx > 0 ? ' border-top: 1px solid #1c1524;' : ''}">
                ${escapeHtml(val)}
              </td>
            </tr>`
          })
          .join('')

        return `
          <!-- Event Overview Plaque -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #120e18; border: 1px solid #332718; border-left: 3px solid #dcb872; border-radius: 3px; margin: 24px 0;">
            <tr>
              <td style="padding: 22px 20px;">
                <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; font-weight: 600; color: #dcb872; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #231b26;">
                  ✦ ${escapeHtml(header.toUpperCase())}
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  ${rows}
                </table>
              </td>
            </tr>
          </table>`
      }

      // Plain link line / Call to action
      if (/https?:\/\//i.test(trimmed)) {
        return `
          <!-- Call to Action (Official Portal) -->
          <div style="text-align: center; margin: 28px 0;">
            <p style="margin: 0 0 16px 0; font-size: 14.5px; line-height: 1.6; color: #c2b9ab;">
              ${escapeHtml(trimmed.replace(/https?:\/\/[^\s<]+/g, '')).trim() || 'Student teams can find the full details and register directly on our official portal:'}
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 12px;">
              <tr>
                <td align="center" style="background-color: #dcb872; background: linear-gradient(135deg, #f8e8c0 0%, #dcb872 60%, #b8924b 100%); border-radius: 3px; box-shadow: 0 4px 18px rgba(220, 184, 114, 0.35);">
                  <a href="https://hackathon.cybersec-kgrcet.com/" target="_blank" style="display: inline-block; padding: 13px 32px; font-family: 'Geist Mono', monospace; font-size: 12.5px; font-weight: 600; color: #0f0c08; text-decoration: none; text-transform: uppercase; letter-spacing: 1.5px;">
                    OFFICIAL HACKATHON PORTAL ↗
                  </a>
                </td>
              </tr>
            </table>
            <div style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #94897c;">
              <a href="https://hackathon.cybersec-kgrcet.com/" target="_blank" style="color: #dcb872; text-decoration: underline;">https://hackathon.cybersec-kgrcet.com/</a>
            </div>
          </div>`
      }

      // Formal sign-off
      if (/^(?:warm\s+)?regards,?/i.test(trimmed)) {
        return `
          <!-- Formal Committee Sign-Off -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top: 1px solid #231b26; padding-top: 22px; margin-top: 26px;">
            <tr>
              <td>
                <p style="margin: 0 0 6px 0; font-size: 14px; color: #94897c; line-height: 1.6;">Warm regards,</p>
                <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #f5efe3;">Cybersecurity &amp; Ethical Hacking Club (CSEH)</p>
                <p style="margin: 0 0 2px 0; font-size: 13px; color: #dcb872; font-family: 'Geist Mono', monospace;">In association with Blockchain Club &amp; CSI Student Chapter</p>
                <p style="margin: 0 0 2px 0; font-size: 13px; color: #c2b9ab;">KG Reddy College of Engineering &amp; Technology</p>
                <p style="margin: 0; font-size: 12px; color: #94897c;">Hyderabad, Telangana, India</p>
              </td>
            </tr>
          </table>`
      }

      // Opt-out / STOP line
      if (/reply STOP/i.test(trimmed)) {
        return `<p style="margin: 22px 0 0 0; font-size: 11.5px; line-height: 1.5; color: #5a524a; text-align: center;">${escapeHtml(trimmed)}</p>`
      }

      // Standard letter paragraph
      const formatted = escapeHtml(trimmed)
        .replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #ffffff;">$1</strong>')
        .replace(/\n/g, '<br>')
      return `<p style="margin: 0 0 16px 0; font-size: 14.5px; line-height: 1.65; color: #c2b9ab;">${formatted}</p>`
    })
    .filter(Boolean)
    .join('\n')

  return `
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
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060a; padding: 40px 12px;">
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

              <!-- College Logo Plate -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 18px;">
                <tr>
                  <td align="center" style="background: #ffffff; padding: 8px 16px; border-radius: 4px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);">
                    <img src="${escapeHtml(event.logoUrl || 'https://hackathon.cybersec-kgrcet.com/assets/kgrcet-logo.png')}" alt="KG Reddy College of Engineering &amp; Technology" width="180" style="display: block; width: 180px; max-width: 100%; height: auto; border: 0;" />
                  </td>
                </tr>
              </table>

              <!-- Organizer Moniker (Geist Mono) -->
              <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; font-weight: 500; color: #dcb872; letter-spacing: 2.2px; text-transform: uppercase; margin-bottom: 12px;">
                ✦ DEPARTMENT OF COMPUTER SCIENCE &amp; ENGINEERING · KGRCET ✦
              </div>

              <!-- Grand Hackathon Title (Cormorant Serif Display) -->
              <h1 class="mobile-title" style="margin: 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 34px; font-weight: 300; line-height: 1.1; letter-spacing: -0.01em; color: #ffffff;">
                KGRCET's HACKATHON <span style="font-style: italic; color: #dcb872; font-weight: 400;">2027</span>
              </h1>

              <!-- Tagline (Mono Spaced) -->
              <p style="margin: 10px 0 0 0; font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 400; color: #c2b9ab; letter-spacing: 2.4px; text-transform: uppercase;">
                ${escapeHtml(event.tagline || '36-HOUR NATIONAL LEVEL HACKATHON')}
              </p>

            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="mobile-p-20" style="padding: 36px 32px;">
              
              <!-- Official Invitation Pill -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #17130b; border: 1px solid #dcb872; padding: 6px 14px; border-radius: 2px;">
                    <span style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #f8e8c0; letter-spacing: 1.5px; text-transform: uppercase;">
                      ✦ OFFICIAL INVITATION
                    </span>
                  </td>
                </tr>
              </table>

              ${contentHtml}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #07060a; border-top: 1px solid #2a2016; padding: 24px 28px; text-align: center;">
              
              <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #dcb872; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;">
                KG REDDY COLLEGE OF ENGINEERING AND TECHNOLOGY
              </div>

              <p style="margin: 0 0 8px 0; font-size: 11.5px; line-height: 1.5; color: #94897c;">
                Beside Moinabad Police Station, Chilkur Village, Moinabad, Hyderabad, Telangana — 501504
              </p>

              <p style="margin: 0; font-family: 'Geist Mono', monospace; font-size: 11px; color: #73695f;">
                Inquiries &amp; Official Communications: <a href="mailto:${escapeHtml(event.contactEmail)}" style="color: #dcb872; text-decoration: none;">${escapeHtml(event.contactEmail)}</a>
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
}

/**
 * Generates personalized HTML and plain text invitation emails.
 * Formats as a minimal, single-column letter without badges, boxes, tables, images or tracking pixels.
 * Contains only one plain-URL link (https://hackathon.cybersec-kgrcet.com/).
 * All recipient names are formatted in Title Case with proper Respected Jashanth handling.
 */
export function renderInvitationEmail({
  recipientName = 'Sir / Madam',
  designation = 'Academic Dignitary',
  institution = 'KG Reddy College of Engineering & Technology',
  category = 'Internal College',
  templateKey = 'internal',
  senderName = 'Sai Vaibhav',
  subject: customSubject,
  message: customMessage,
  ctaNote,
  event = EVENT_DETAILS,
}) {
  const template = INVITATION_TEMPLATES[templateKey] || INVITATION_TEMPLATES.internal || INVITATION_TEMPLATES.official
  const formattedRecipient = formatRecipientName(recipientName)
  const salutation = extractSalutation(recipientName, designation)
  const lastName = extractLastName(recipientName)
  const effectiveSender = sanitizeHeader(senderName || 'Sai Vaibhav')

  // Subject line: ensure Title Case names, no ALL CAPS, defaults to 'KGRCET Hackathon 2027'
  let rawSubject = customSubject ? sanitizeHeader(customSubject) : template.subject
  rawSubject = rawSubject
    .replace(/Dear Prof\.\s*\{LastName\},?/gi, salutation)
    .replace(/Respected\s+Jashanth\s*\([^)]*\),?/gi, salutation)
    .replace(/Respected\s+Jashanth,?/gi, salutation)
    .replace(/Respected\s+\{RecipientName\},?/gi, salutation)
    .replace(/Dear\s+\{RecipientName\},?/gi, salutation)
    .replace(/\{LastName\}/g, lastName)
    .replace(/\{RecipientName\}/g, formattedRecipient)
    .replace(/\{YourName\}/g, effectiveSender)
    .replace(/\bhackathon\b/gi, 'Hackathon')
    .replace(/\bNATIONAL LEVEL HACKATHON\b/gi, 'National Hackathon')

  const subject = rawSubject.trim() || 'KGRCET Hackathon 2027'

  // Body message: resolve placeholders
  let rawBody = (customMessage !== undefined && customMessage !== null ? String(customMessage) : template.message).trim()

  const OFFICIAL_SIGN_OFF = [
    'Warm regards,',
    'Cybersecurity & Ethical Hacking Club (CSEH)',
    'In association with Blockchain Club & CSI Student Chapter',
    'KG Reddy College of Engineering & Technology',
    'Hyderabad, Telangana, India',
  ].join('\n')

  // Clean out meta instructions if prompt was pasted directly into the body
  rawBody = rawBody
    .replace(/and then only put these:\s*/gi, '')
    .replace(/followed by Warm regards as usual.*$/gis, OFFICIAL_SIGN_OFF)
    .replace(/Fix Name Capitalization:.*$/gim, '')

  rawBody = rawBody
    .replace(/Respected\s+Jashanth\s*\([^)]*\),?/gi, salutation)
    .replace(/Respected\s+Jashanth,?/gi, salutation)
    .replace(/Respected\s+\{RecipientName\},?/gi, salutation)
    .replace(/Dear Prof\.\s*\{LastName\},?/gi, salutation)
    .replace(/Dear\s+\{RecipientName\},?/gi, salutation)
    .replace(/\{LastName\}/g, lastName)
    .replace(/\{RecipientName\}/g, formattedRecipient)
    .replace(/\{YourName\}/g, effectiveSender)
    .replace(/\bHACKATHON\b/g, 'Hackathon')

  // Check what facts are present
  const hasLink = rawBody.includes('https://hackathon.cybersec-kgrcet.com')
  const hasTracks = /challenge domains|domains|tracks|generative ai/i.test(rawBody)

  // Build the complete letter paragraphs
  const paragraphs = []

  // 1. Salutation
  if (!/^(?:respected|dear)\s+/i.test(rawBody)) {
    paragraphs.push(salutation)
  }

  // 2. Body paragraphs
  const rawParagraphs = rawBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  for (const p of rawParagraphs) {
    paragraphs.push(p)
  }

  // 3. Optional ctaNote if passed and not already included
  if (ctaNote && typeof ctaNote === 'string' && ctaNote.trim()) {
    const safeNote = ctaNote.trim()
    if (!paragraphs.some((p) => p.includes(safeNote))) {
      paragraphs.push(safeNote)
    }
  }

  // 4. Ensure key facts (dates, venue, team size, tracks) if missing
  if (!hasTracks) {
    paragraphs.push(
      `Event Overview:\n• Dates: February 19–20, 2027 (36 Hours)\n• Venue: KGRCET Campus, Moinabad, Hyderabad\n• Team Size: 2–4 Students\n• Prize Pool: ₹1,00,000 (Provisional)`
    )
    paragraphs.push(
      `Challenge Domains:\n1. Generative AI & LLM Applications\n2. Cybersecurity & Digital Forensics\n3. FinTech & Blockchain\n4. HealthTech & Mental Well-being\n5. Open Innovation`
    )
  }

  // 5. Ensure registration link if missing
  if (!hasLink) {
    paragraphs.push(
      `Student teams can find the full details and register directly on our official portal: https://hackathon.cybersec-kgrcet.com/`
    )
  }

  // 6. Ensure closing sign-off: always use official institutional sign-off without personal names
  const signOffIdx = paragraphs.findIndex((p) => /^(?:warm\s+)?regards,?/i.test(p))
  if (signOffIdx !== -1) {
    paragraphs[signOffIdx] = OFFICIAL_SIGN_OFF
  } else {
    paragraphs.push(OFFICIAL_SIGN_OFF)
  }

  // 7. Ensure plain STOP opt-out line at the very end
  const stopLine = "If you'd rather not hear from us, reply STOP and we won't write again."
  const filteredParagraphs = paragraphs.filter((p) => !/reply STOP/i.test(p))
  filteredParagraphs.push(stopLine)

  // Plain text part
  const text = filteredParagraphs.join('\n\n')

  // HTML theme part
  const html = renderInvitationHtmlTheme({
    subject,
    paragraphs: filteredParagraphs,
    formattedRecipient,
    effectiveSender,
    event,
  })

  return {
    subject,
    html,
    text,
    recipientName: formattedRecipient,
  }
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
