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

/**
 * Extracts a polite last name for formal salutation (e.g. "Dr. Ramesh Kumar" -> "Kumar", "Prof. K. S. Rao" -> "Rao").
 * Falls back to "Professor" if the name is generic, empty, or unparseable.
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
  const last = parts[parts.length - 1]
  if (last.replace(/\./g, '').length <= 1 && parts.length > 1) {
    return parts[0]
  }
  return last || 'Professor'
}

/**
 * Predefined invitation templates for different dignitary and partner categories.
 */
export const INVITATION_TEMPLATES = {
  internal: {
    id: 'internal',
    name: 'Internal College Invitation',
    category: 'Internal College',
    subject: "Invitation to KGRCET's HACKATHON 2027 — 36-Hour National Level Hackathon",
    message: "On behalf of the Department of Computer Science and Engineering, KG Reddy College of Engineering & Technology (KGRCET), Hyderabad, we are delighted to invite you to be a part of **KGRCET's HACKATHON 2027**, a 36-hour national-level hackathon bringing together student innovators, developers and aspiring entrepreneurs from across the country. We look forward to your encouragement, support and participation in making this event a grand success.",
  },
  external: {
    id: 'external',
    name: 'External College Invitation',
    category: 'External College',
    subject: 'KGRCET Hackathon 2027 (Feb 19-20) - could you share with your students?',
    message: `Dear Prof. {LastName},

I'm {YourName}, an organizer with the Cybersecurity & Ethical Hacking Club at KG Reddy College of Engineering & Technology, Hyderabad. We're hosting KGRCET's Hackathon 2027 on February 19-20, 2027, a 36-hour hackathon for teams of 2-4 students, and I'd be grateful if you could pass it on to students in your department.

Registration and details are here:
https://hackathon.cybersec-kgrcet.com/register

If you have any questions, just reply to this email.

Regards,
{YourName}
Cybersecurity & Ethical Hacking Club, KGRCET
cseh@kgrcet.edu.in

If you'd rather not hear from us, reply STOP and we won't write again.`,
  },
  sponsor: {
    id: 'sponsor',
    name: 'Sponsor Invitation',
    category: 'Sponsor',
    subject: "Sponsorship & Brand Partnership Invitation: KGRCET's HACKATHON 2027",
    message: "We are thrilled to invite your esteemed brand to partner as an official sponsor for KGRCET's HACKATHON 2027, Hyderabad's flagship 36-hour national technology sprint happening on February 19–20, 2027. With 700–1000+ verified student developers, engineers, and researchers building live across Autonomous AI, Cybersecurity, FinTech, and HealthTech, your partnership provides direct brand visibility, talent recruitment access, and community leadership.",
  },
  custom: {
    id: 'custom',
    name: 'Custom Invitation',
    category: 'Custom',
    subject: "Special Invitation: KGRCET's HACKATHON 2027",
    message: "You are cordially invited to participate and collaborate with KGRCET's HACKATHON 2027, a premier 36-Hour National Level Hackathon on February 19–20, 2027 at KG Reddy College of Engineering & Technology, Hyderabad.",
  },
}

// Aliases for backwards compatibility
INVITATION_TEMPLATES.official = INVITATION_TEMPLATES.internal
INVITATION_TEMPLATES.college = INVITATION_TEMPLATES.external

/**
 * Generates personalized HTML and plain text invitation emails for dignitaries, HODs, principals, guests and sponsors.
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
  const safeRecipient = sanitizeHeader(recipientName || 'Sir / Madam')
  const safeDesignation = sanitizeHeader(designation || 'Academic Dignitary')
  const safeInstitution = sanitizeHeader(institution || 'KG Reddy College of Engineering & Technology')
  const safeCategory = sanitizeHeader(category || template.category || 'Internal College')
  const effectiveSender = sanitizeHeader(senderName || 'Sai Vaibhav')
  const lastName = extractLastName(recipientName)
  const resolvedSalutation = lastName === 'Professor' ? 'Dear Professor,' : `Dear Prof. ${lastName},`

  let rawSubject = customSubject ? sanitizeHeader(customSubject) : template.subject
  rawSubject = rawSubject
    .replace(/Dear Prof\.\s*\{LastName\},?/gi, resolvedSalutation)
    .replace(/\{LastName\}/g, lastName)
    .replace(/\{YourName\}/g, effectiveSender)

  let bodyMessage = (customMessage !== undefined && customMessage !== null ? String(customMessage) : template.message).trim()
  bodyMessage = bodyMessage
    .replace(/Dear Prof\.\s*\{LastName\},?/gi, resolvedSalutation)
    .replace(/\{LastName\}/g, lastName)
    .replace(/\{YourName\}/g, effectiveSender)

  const subject = rawSubject

  const isOutreach =
    templateKey === 'external' ||
    templateKey === 'college' ||
    bodyMessage.includes('reply STOP') ||
    bodyMessage.includes('could you share with your students') ||
    bodyMessage.startsWith('Dear Prof')

  if (isOutreach) {
    const text = bodyMessage

    const paragraphs = bodyMessage.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

    const renderedParagraphsHtml = paragraphs
      .map((p) => {
        if (/^Dear\s+/i.test(p)) {
          return `<h2 style="margin: 0 0 16px 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 26px; font-weight: 400; color: #ffffff; letter-spacing: 0.01em; line-height: 1.25;">${escapeHtml(p)}</h2>`
        }
        if (p.includes('https://hackathon.cybersec-kgrcet.com/register')) {
          const intro = p.replace(/https?:\/\/[^\s]+/g, '').trim()
          return `
              <div style="margin: 24px 0; padding: 18px 20px; background-color: #120e18; border: 1px solid #332718; border-left: 3px solid #dcb872; border-radius: 3px;">
                <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #dcb872; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;">
                  ✦ REGISTRATION &amp; EVENT DETAILS
                </div>
                ${intro ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #c2b9ab;">${escapeHtml(intro)}</p>` : ''}
                <a href="https://hackathon.cybersec-kgrcet.com/register" style="color: #f8e8c0; font-size: 15px; font-weight: 600; text-decoration: underline; word-break: break-all;">
                  https://hackathon.cybersec-kgrcet.com/register
                </a>
              </div>`
        }
        if (/^(?:warm\s+)?regards,?/i.test(p)) {
          const lines = p.split('\n').map((l) => l.trim()).filter(Boolean)
          return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top: 1px solid #231b26; padding-top: 20px; margin-top: 24px;">
                <tr>
                  <td>
                    ${lines
                      .map((line, idx) => {
                        const safeLine = escapeHtml(line)
                        if (idx === 0) return `<p style="margin: 0 0 6px 0; font-size: 14px; color: #94897c;">${safeLine}</p>`
                        if (idx === 1) return `<p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #ffffff;">${safeLine}</p>`
                        if (line.includes('@')) {
                          return `<p style="margin: 0; font-size: 13px; color: #94897c;"><a href="mailto:${safeLine}" style="color: #dcb872; text-decoration: none;">${safeLine}</a></p>`
                        }
                        return `<p style="margin: 0 0 2px 0; font-size: 13.5px; color: #dcb872;">${safeLine}</p>`
                      })
                      .join('')}
                  </td>
                </tr>
              </table>`
        }
        if (/reply STOP/i.test(p)) {
          return `<p style="margin: 24px 0 0 0; font-size: 12px; line-height: 1.5; color: #73695c; font-style: italic;">${escapeHtml(p)}</p>`
        }
        return `<p style="margin: 0 0 16px 0; font-size: 14.5px; line-height: 1.7; color: #c2b9ab;">${escapeHtml(p).replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #ffffff;">$1</strong>').replace(/\n/g, '<br>')}</p>`
      })
      .join('')

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
      .mobile-title { font-size: 27px !important; line-height: 1.15 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #07060a; font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5efe3; -webkit-font-smoothing: antialiased;">

  <!-- Outer Canvas (Deep Obsidian / Void) -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060a; padding: 40px 12px;">
    <tr>
      <td align="center">
        
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 620px; background-color: #0e0b13; border: 1px solid #332718; border-radius: 4px; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);">
          
          <!-- Top Celestial Gold Foil Accent Bar -->
          <tr>
            <td style="height: 3px; background: #dcb872; background: linear-gradient(90deg, #94702f 0%, #dcb872 30%, #fff4d6 50%, #dcb872 70%, #94702f 100%); font-size: 1px; line-height: 1px;">&nbsp;</td>
          </tr>

          <!-- Banner / Grand Institutional Header -->
          <tr>
            <td class="mobile-p-20" style="background-color: #120e18; background: linear-gradient(180deg, #171120 0%, #0e0b13 100%); padding: 36px 32px 28px; text-align: center; border-bottom: 1px solid #2a2016;">
              <h1 class="mobile-title" style="margin: 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 34px; font-weight: 300; line-height: 1.1; letter-spacing: -0.01em; color: #ffffff;">
                KGRCET's HACKATHON <span style="font-style: italic; color: #dcb872; font-weight: 400;">2027</span>
              </h1>
              <p style="margin: 10px 0 0 0; font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 400; color: #c2b9ab; letter-spacing: 2.4px; text-transform: uppercase;">
                A 36-HOUR NATIONAL-LEVEL HACKATHON
              </p>
              <div style="margin-top: 14px; font-family: 'Geist Mono', monospace; font-size: 10px; color: #94897c; letter-spacing: 1.2px; text-transform: uppercase;">
                Led by <span style="color: #f8e8c0; font-weight: 600;">CSEH Club</span> · In association with <span style="color: #f8e8c0; font-weight: 600;">Blockchain Club</span> &amp; <span style="color: #f8e8c0; font-weight: 600;">CSI Student Chapter</span>
              </div>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="mobile-p-20" style="padding: 34px 32px;">
              
              <!-- Official Invitation Badge -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #1a140d; border: 1px solid #dcb872; padding: 6px 14px; border-radius: 2px;">
                    <span style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #f8e8c0; letter-spacing: 1.6px; text-transform: uppercase;">
                      ✦ OFFICIAL EVENT INVITATION
                    </span>
                  </td>
                </tr>
              </table>

              ${renderedParagraphsHtml}

            </td>
          </tr>

          <!-- Footer / Legal & Campus Details -->
          <tr>
            <td style="background-color: #09070d; border-top: 1px solid #1f1722; padding: 26px 32px; text-align: center;">
              <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #dcb872; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;">
                KG REDDY COLLEGE OF ENGINEERING AND TECHNOLOGY
              </div>
              <p style="margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #94897c;">
                Beside Moinabad Police Station, Chilkur Village, Moinabad Mandal, Ranga Reddy District, Hyderabad, Telangana — 501504
              </p>
              <p style="margin: 0; font-family: 'Geist Mono', monospace; font-size: 11px; color: #94897c;">
                Inquiries &amp; Official Communications: <a href="mailto:${escapeHtml(event.contactEmail)}" style="color: #dcb872; text-decoration: none;">${escapeHtml(event.contactEmail)}</a>
              </p>
              <div style="margin-top: 16px; font-size: 10.5px; color: #5a5246; font-family: 'Geist Mono', monospace;">
                © 2027 KGRCET · DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING · ALL RIGHTS RESERVED
              </div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
    `.trim()

    return { subject, html, text }
  }

  const messageParagraphsHtml = bodyMessage
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin: 0 0 16px 0; font-size: 14.5px; line-height: 1.7; color: #c2b9ab;">${escapeHtml(p).replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #ffffff;">$1</strong>').replace(/\n/g, '<br>')}</p>`)
    .join('')

  const isInternal = templateKey === 'internal' || templateKey === 'official' || safeCategory.toLowerCase().includes('internal')
  const isExternalInstitution = !isInternal && (templateKey === 'external' || templateKey === 'college' || safeCategory.toLowerCase().includes('external') || safeCategory.toLowerCase().includes('other'))

  const externalCtaNoteDefault = "We encourage your institution to share this invitation with interested students and faculty members and motivate them to participate in this national-level initiative.\n\nWe look forward to your institution's participation and to building meaningful connections between students, academia and industry."

  const ctaNoteTextContent = isInternal
    ? ''
    : (ctaNote !== undefined ? String(ctaNote || '').trim() : (isExternalInstitution ? externalCtaNoteDefault : ''))

  const ctaNoteHtml = ctaNoteTextContent
    ? `
              <!-- Institutional Outreach & Call to Action Message -->
              <div style="margin: 24px 0; padding: 16px 20px; background-color: #120e18; border: 1px solid #2a2016; border-left: 3px solid #dcb872; border-radius: 3px;">
                ${ctaNoteTextContent
                  .split(/\n\s*\n/)
                  .map((p, idx) => `<p style="margin: 0${idx === 0 ? ' 0 10px 0' : ''}; font-size: 14px; line-height: 1.65; color: ${idx === 0 ? '#f5efe3' : '#dcb872'};">${escapeHtml(p).replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #ffffff;">$1</strong>').replace(/\n/g, '<br>')}</p>`)
                  .join('')}
              </div>`
    : ''

  const ctaNotePlainText = ctaNoteTextContent ? `\n${ctaNoteTextContent}\n` : ''

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
    /* Client resets */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    
    /* Responsive breakpoints */
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-p-20 { padding: 24px 18px !important; }
      .mobile-title { font-size: 27px !important; line-height: 1.15 !important; }
      .mobile-stat-col { display: block !important; width: 100% !important; margin-bottom: 12px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #07060a; font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5efe3; -webkit-font-smoothing: antialiased;">

  <!-- Outer Canvas (Deep Obsidian / Void) -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060a; padding: 40px 12px;">
    <tr>
      <td align="center">
        
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 620px; background-color: #0e0b13; border: 1px solid #332718; border-radius: 4px; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);">
          
          <!-- Top Celestial Gold Foil Accent Bar -->
          <tr>
            <td style="height: 3px; background: #dcb872; background: linear-gradient(90deg, #94702f 0%, #dcb872 30%, #fff4d6 50%, #dcb872 70%, #94702f 100%); font-size: 1px; line-height: 1px;">&nbsp;</td>
          </tr>

          <!-- Banner / Grand Institutional Header -->
          <tr>
            <td class="mobile-p-20" style="background-color: #120e18; background: linear-gradient(180deg, #171120 0%, #0e0b13 100%); padding: 36px 32px 28px; text-align: center; border-bottom: 1px solid #2a2016;">

              <!-- Grand Hackathon Title (Cormorant Serif Display) -->
              <h1 class="mobile-title" style="margin: 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 34px; font-weight: 300; line-height: 1.1; letter-spacing: -0.01em; color: #ffffff;">
                KGRCET's HACKATHON <span style="font-style: italic; color: #dcb872; font-weight: 400;">2027</span>
              </h1>

              <!-- Tagline (Mono Spaced) -->
              <p style="margin: 10px 0 0 0; font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 400; color: #c2b9ab; letter-spacing: 2.4px; text-transform: uppercase;">
                A 36-HOUR NATIONAL-LEVEL HACKATHON
              </p>

              <!-- Affiliation Badges -->
              <div style="margin-top: 14px; font-family: 'Geist Mono', monospace; font-size: 10px; color: #94897c; letter-spacing: 1.2px; text-transform: uppercase;">
                Led by <span style="color: #f8e8c0; font-weight: 600;">CSEH Club</span> · In association with <span style="color: #f8e8c0; font-weight: 600;">Blockchain Club</span> &amp; <span style="color: #f8e8c0; font-weight: 600;">CSI Student Chapter</span>
              </div>

            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td class="mobile-p-20" style="padding: 34px 32px;">
              
              <!-- Official Invitation Badge -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #1a140d; border: 1px solid #dcb872; padding: 6px 14px; border-radius: 2px;">
                    <span style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #f8e8c0; letter-spacing: 1.6px; text-transform: uppercase;">
                      ✦ OFFICIAL EVENT INVITATION
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Formal Dignitary Salutation -->
              <h2 style="margin: 0 0 8px 0; font-family: 'Cormorant', Garamond, 'Times New Roman', Georgia, serif; font-size: 26px; font-weight: 400; color: #ffffff; letter-spacing: 0.01em; line-height: 1.25;">
                Respected ${escapeHtml(safeRecipient)},
              </h2>
              
              <div style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #dcb872; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 22px;">
                ${escapeHtml(safeDesignation)}${safeInstitution ? ` · ${escapeHtml(safeInstitution)}` : ''}
              </div>

              <!-- Message Body -->
              ${messageParagraphsHtml}

              <!-- The Vision Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #16101d; border: 1px solid #dcb872; border-radius: 3px; margin: 24px 0 28px;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #dcb872; letter-spacing: 1.6px; text-transform: uppercase; margin-bottom: 8px;">
                      ✦ THE VISION
                    </div>
                    <p style="margin: 0; font-size: 14px; line-height: 1.65; color: #f8e8c0;">
                      Connecting students with real-world industry challenges and creating opportunities for promising solutions to grow beyond the hackathon.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Event Details Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #120e18; border: 1px solid #332718; border-left: 3px solid #dcb872; border-radius: 3px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px 22px;">
                    
                    <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #dcb872; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #231b26;">
                      ✦ EVENT DETAILS
                    </div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13.5px; line-height: 1.65; border-collapse: collapse;">
                      <tr style="border-bottom: 1px solid #2a2016;">
                        <th align="left" style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11px; color: #dcb872; text-transform: uppercase; letter-spacing: 1px; width: 38%;">Detail</th>
                        <th align="left" style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11px; color: #dcb872; text-transform: uppercase; letter-spacing: 1px;">Information</th>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Dates</td>
                        <td style="padding: 8px 6px; color: #f8e8c0; font-weight: 700; border-top: 1px solid #1c1524;">February 19–20, 2027</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Duration</td>
                        <td style="padding: 8px 6px; color: #f8e8c0; font-weight: 700; border-top: 1px solid #1c1524;">36 Hours</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Participation Target</td>
                        <td style="padding: 8px 6px; color: #f8e8c0; font-weight: 700; border-top: 1px solid #1c1524;">700–1,000 Students Nationwide</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Prize Pool</td>
                        <td style="padding: 8px 6px; color: #dcb872; font-weight: 700; border-top: 1px solid #1c1524;">₹1,00,000 (Provisional)</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Team Size</td>
                        <td style="padding: 8px 6px; color: #f8e8c0; font-weight: 700; border-top: 1px solid #1c1524;">2–4 Students</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 6px; font-family: 'Geist Mono', monospace; font-size: 11.5px; color: #94897c; text-transform: uppercase; border-top: 1px solid #1c1524;">Venue</td>
                        <td style="padding: 8px 6px; color: #c2b9ab; border-top: 1px solid #1c1524;">KGRCET, Moinabad, Hyderabad, Telangana – 501504</td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <!-- Challenge Domains -->
              <div style="margin-bottom: 28px;">
                <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; color: #dcb872; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;">
                  ✦ CHALLENGE DOMAINS
                </div>
                
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0e0b13; border: 1px solid #231b26; border-radius: 3px;">
                  <tr>
                    <td style="padding: 10px 14px; border-bottom: 1px solid #1c1524; font-size: 13.5px; color: #f5efe3;">
                      <span style="font-family: 'Geist Mono', monospace; color: #dcb872; font-weight: 600; margin-right: 8px;">1.</span>
                      Generative AI &amp; LLM Applications
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 14px; border-bottom: 1px solid #1c1524; font-size: 13.5px; color: #f5efe3;">
                      <span style="font-family: 'Geist Mono', monospace; color: #dcb872; font-weight: 600; margin-right: 8px;">2.</span>
                      Cybersecurity &amp; Digital Forensics
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 14px; border-bottom: 1px solid #1c1524; font-size: 13.5px; color: #f5efe3;">
                      <span style="font-family: 'Geist Mono', monospace; color: #dcb872; font-weight: 600; margin-right: 8px;">3.</span>
                      FinTech &amp; Blockchain
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 14px; border-bottom: 1px solid #1c1524; font-size: 13.5px; color: #f5efe3;">
                      <span style="font-family: 'Geist Mono', monospace; color: #dcb872; font-weight: 600; margin-right: 8px;">4.</span>
                      HealthTech &amp; Mental Well-being
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 14px; font-size: 13.5px; color: #f5efe3;">
                      <span style="font-family: 'Geist Mono', monospace; color: #dcb872; font-weight: 600; margin-right: 8px;">5.</span>
                      Open Innovation
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Call to Action Note (Institutional Outreach, strictly External College) -->
              ${ctaNoteHtml}

              ${isExternalInstitution ? `<p style="margin: 20px 0 16px 0; font-size: 14.5px; line-height: 1.65; color: #c2b9ab;">We look forward to your institution's participation and support in making this event a success.</p>` : ''}

              <!-- Direct Links (Text-Only to maximize Primary inbox delivery) -->
              <div style="margin: 24px 0 20px 0; font-size: 14px; line-height: 1.8; color: #f5efe3;">
                <p style="margin: 0 0 10px 0;">
                  <strong style="color: #ffffff; font-family: 'Geist Mono', monospace; font-size: 12px; letter-spacing: 0.5px;">REGISTER STUDENT TEAMS:</strong><br>
                  <a href="https://hackathon.cybersec-kgrcet.com/register" style="color: #dcb872; text-decoration: underline; word-break: break-all;">https://hackathon.cybersec-kgrcet.com/register</a>
                </p>
                <p style="margin: 12px 0 0 0;">
                  <strong style="color: #ffffff; font-family: 'Geist Mono', monospace; font-size: 12px; letter-spacing: 0.5px;">Official Website:</strong> <a href="https://hackathon.cybersec-kgrcet.com/" style="color: #dcb872; text-decoration: underline; word-break: break-all;">https://hackathon.cybersec-kgrcet.com/</a>
                </p>
              </div>

              <!-- Formal Committee Sign-Off -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top: 1px solid #231b26; padding-top: 22px; margin-top: 24px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #94897c; line-height: 1.6;">
                      Warm Regards,
                    </p>
                    <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #f5efe3;">
                      Cybersecurity &amp; Ethical Hacking Club (CSEH)
                    </p>
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #dcb872;">
                      In association with Blockchain Club &amp; CSI Student Chapter
                    </p>
                    <p style="margin: 0 0 2px 0; font-size: 13px; color: #c2b9ab;">
                      KG Reddy College of Engineering &amp; Technology
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #94897c;">
                      Hyderabad, Telangana, India
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer / Legal & Campus Details -->
          <tr>
            <td style="background-color: #09070d; border-top: 1px solid #1f1722; padding: 26px 32px; text-align: center;">
              
              <div style="font-family: 'Geist Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #dcb872; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;">
                KG REDDY COLLEGE OF ENGINEERING AND TECHNOLOGY
              </div>

              <p style="margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #94897c;">
                Beside Moinabad Police Station, Chilkur Village, Moinabad Mandal, Ranga Reddy District, Hyderabad, Telangana — 501504
              </p>

              <p style="margin: 0; font-family: 'Geist Mono', monospace; font-size: 11px; color: #94897c;">
                Inquiries &amp; Official Communications: <a href="mailto:${escapeHtml(event.contactEmail)}" style="color: #dcb872; text-decoration: none;">${escapeHtml(event.contactEmail)}</a>
              </p>

              <div style="margin-top: 16px; font-size: 10.5px; color: #5a5246; font-family: 'Geist Mono', monospace;">
                © 2027 KGRCET · DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING · ALL RIGHTS RESERVED
              </div>

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
# KGRCET's HACKATHON 2027
### A 36-HOUR NATIONAL-LEVEL HACKATHON
Led by CSEH Club · In association with Blockchain Club & CSI Student Chapter
==================================================

✦ OFFICIAL EVENT INVITATION

Respected ${safeRecipient},
${safeDesignation}${safeInstitution ? ` · ${safeInstitution}` : ''}

${bodyMessage}

✦ THE VISION
--------------------------------------------------
Connecting students with real-world industry challenges and creating opportunities for promising solutions to grow beyond the hackathon.

✦ EVENT DETAILS
--------------------------------------------------
Detail               | Information
---------------------|--------------------------------------------
Dates                | February 19–20, 2027
Duration             | 36 Hours
Participation Target | 700–1,000 Students Nationwide
Prize Pool           | ₹1,00,000 (Provisional)
Team Size            | 2–4 Students
Venue                | KGRCET, Moinabad, Hyderabad, Telangana – 501504

✦ CHALLENGE DOMAINS
--------------------------------------------------
1. Generative AI & LLM Applications
2. Cybersecurity & Digital Forensics
3. FinTech & Blockchain
4. HealthTech & Mental Well-being
5. Open Innovation
${ctaNotePlainText}${isExternalInstitution ? "\nWe look forward to your institution's participation and support in making this event a success.\n" : ''}
REGISTER STUDENT TEAMS:
https://hackathon.cybersec-kgrcet.com/register

Official Website: https://hackathon.cybersec-kgrcet.com/

---
Warm Regards,

Cybersecurity & Ethical Hacking Club (CSEH)
In association with Blockchain Club & CSI Student Chapter
KG Reddy College of Engineering & Technology
Hyderabad, Telangana, India
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
