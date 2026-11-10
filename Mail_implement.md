# Automated Registration Confirmation Emails — Brevo SMTP

This document details the production-ready automated transactional email system implemented for **KGRCET's HACKATHON 2027**.

When an administrator verifies a team registration in the Organizer Console by setting its status from **Pending** to **Valid**, the backend compiles individual personalized HTML confirmation emails for the **team leader and every registered team member**, dispatching them through **Brevo SMTP** via a persistent transactional outbox.

---

## 1. System Architecture

```
[Organizer Console /admin]
  Admin marks Team REG-XXXX as "Valid"
       │
       ▼
[PUT /api/admin/registrations/:receipt/status]
       │
       ├─► 1. Save review_status = 'valid' in SQLite
       │
       ├─► 2. Atomic Idempotency Check:
       │      UPDATE drafts SET email_first_sent_at = now 
       │      WHERE receipt = ? AND email_first_sent_at IS NULL
       │      (If changes === 1: Proceed. If 0: Duplicate detected, skip automatically)
       │
       ├─► 3. Enqueue into Transactional Outbox (email_outbox & email_recipients)
       │      (Extracts leader + all members, validates RFC 5322 & header injection)
       │
       ├─► 4. Return instant HTTP 200 response to Admin Portal (0ms UI lag)
       │
       └─► 5. Background Queue Worker (processEmailQueue):
              - Claims outbox job with status: 'sending'
              - Sequentially sends personalized HTML email to each member via Brevo SMTP (Port 587 STARTTLS)
              - Adds 80ms rate-limit spacing to respect Brevo throughput limits
              - Tracks per-recipient delivery (status: 'sent' | 'failed')
              - Updates overall outbox and draft summary: 'sent' | 'partial' | 'failed'
              - On temporary network failure, schedules retry (up to 3 attempts)
```

---

## 2. Brevo SMTP Configuration

Production email delivery uses **Nodemailer** connecting to **Brevo SMTP relay**:

### Required Environment Variables (`.env`)
```env
# Brevo SMTP Configuration
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
SMTP_FROM_EMAIL=no-reply@cybersec-kgrcet.com
SMTP_FROM_NAME=KGRCET Hackathon
```

### Security & TLS Specifications:
- **Port 587 STARTTLS**: Configured with `secure: false` and `requireTLS: true`.
- **TLS Version**: Enforces modern `TLSv1.2` minimum.
- **Zero Hardcoded Secrets**: Credentials exist exclusively in environment variables and are never checked into git.
- **Credential Leak Prevention**: Passwords and keys are redacted (`***REDACTED***`) from application logs, audit logs, and SQLite error records.
- **Dry-Run Mode in Development**: When `SMTP_USER` and `SMTP_PASS` are omitted (such as in local development or test suites), the system runs in safe dry-run mode, simulating delivery and recording database entries without throwing unhandled network errors.

---

## 3. Database Schema & Transactional Outbox

Two dedicated tables and summary columns on the existing `drafts` table manage persistent delivery records inside `data/registration.sqlite`:

### 1. `email_outbox` Table
| Column | Type | Description |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Unique outbox job ID |
| `receipt` | `TEXT NOT NULL` | Target registration receipt (`REG-XXXX`) |
| `status` | `TEXT NOT NULL` | Job status: `'pending'`, `'sending'`, `'sent'`, `'partial'`, `'failed'`, `'retry'` |
| `trigger_type` | `TEXT NOT NULL` | `'status_valid'` or `'manual_resend'` |
| `recipient_count` | `INTEGER NOT NULL` | Total recipients for the team |
| `sent_count` | `INTEGER NOT NULL` | Number of successfully delivered recipients |
| `failed_count` | `INTEGER NOT NULL` | Number of failed recipients |
| `attempt_count` | `INTEGER NOT NULL` | Delivery attempts made |
| `max_attempts` | `INTEGER NOT NULL` | Maximum retry threshold (default: 3) |
| `created_at` | `INTEGER NOT NULL` | Job creation timestamp |
| `updated_at` | `INTEGER NOT NULL` | Job update timestamp |
| `last_attempt_at` | `INTEGER` | Last delivery timestamp |
| `last_error` | `TEXT` | Sanitized error message if failed |

### 2. `email_recipients` Table
| Column | Type | Description |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Unique recipient entry ID |
| `outbox_id` | `INTEGER REFERENCES email_outbox(id)` | Foreign key to parent job |
| `receipt` | `TEXT NOT NULL` | Target registration receipt |
| `email` | `TEXT NOT NULL` | Registered email address |
| `name` | `TEXT NOT NULL` | Member name |
| `role` | `TEXT NOT NULL` | `'leader'` or `'member'` |
| `status` | `TEXT NOT NULL` | Delivery status: `'pending'`, `'sent'`, `'failed'` |
| `attempt_count` | `INTEGER NOT NULL` | Attempts for this recipient |
| `sent_at` | `INTEGER` | Timestamp of successful transmission |
| `last_error` | `TEXT` | Sanitized error if transmission failed |

### 3. Summary Columns Added to `drafts` Table
- `email_status TEXT`: Cached status for table display (`'pending'`, `'sending'`, `'sent'`, `'partial'`, `'failed'`)
- `email_sent_count INTEGER`: Count of delivered members
- `email_failed_count INTEGER`: Count of failed members
- `email_last_attempt_at INTEGER`: Timestamp of last attempt
- `email_last_error TEXT`: Sanitized error if any
- `email_first_sent_at INTEGER`: Timestamp when first validated (ensures duplicate protection)

---

## 4. Duplicate Protection & Manual Resend

1. **Automatic Status Transition**:
   - Automated emails are queued **only when a team transitions from non-valid to Valid for the very first time**.
   - Repeated status saves (e.g. clicking Valid again, updating team details) perform an atomic check:
     ```sql
     UPDATE drafts SET email_first_sent_at = ? WHERE receipt = ? AND email_first_sent_at IS NULL
     ```
     If `changes === 0`, no duplicate emails are queued.
2. **Intentional Manual Resend**:
   - In the Organizer Console, verified teams have a dedicated **Resend email** action button.
   - When an authenticated organizer confirms the resend dialog, the frontend calls `POST /api/admin/registrations/:receipt/resend-email`.
   - This explicitly queues a fresh outbox record (`trigger_type: 'manual_resend'`) and re-dispatches individual confirmations to all members.

---

## 5. Organizer Console Integration

The Admin Portal table ([`src/Admin.tsx`](file:///C:/Users/JASHANTH/Desktop/2k27/src/Admin.tsx)) includes:
- **Email Status Column**:
  - `Sent` badge (green) when all recipients received the email (`3/3 sent`).
  - `Sending...` badge (gold) during transmission.
  - `Queued` badge (gold) while pending in outbox.
  - `Partial` badge (orange) if some members failed (`2/3 sent (1 failed)`).
  - `Failed` badge (red) if delivery failed.
  - Timestamp of the last attempt displayed in monospace subtitle.
- **Resend Action**:
  - Clicking `<Mail /> Resend email` prompts for confirmation and triggers an authorized background resend.
- **CSV Export**:
  - The exported CSV includes `Email Status`, `Emails Sent`, `Emails Failed`, and `Last Email Attempt`.

---

## 6. Email Template Specifications

Each team member receives an individual personalized email containing:
- **Branding**: KGRCET's HACKATHON 2027, 36-Hour National Level Hackathon banner and Cybersecurity & Ethical Hacking Club branding.
- **Personalized Salutation**: "Hello, [Recipient Name]!" with clear indication of their role (Team Leader vs Team Member).
- **Status Confirmation**: Prominent green badge confirming verified status.
- **Registration Data**: Registration ID (`REG-XXXX`), Team Name, and Total Amount Paid.
- **Full Team Roster**: Lists the leader and all team members.
- **Event Logistics**: Dates (February 19–20, 2027), Duration (36 Hours Non-Stop Sprint), Theme, Venue address, and Queries contact email (`cseh@kgrcet.edu.in`).
- **Check-in Instructions**: Reminders to bring College ID cards, Registration ID, and build essentials (laptops, chargers).
- **Plain-Text Alternative**: Generated in parallel for email clients with HTML disabled.

---

## 7. Files Created or Modified

1. **[`server/email-service.mjs`](file:///C:/Users/JASHANTH/Desktop/2k27/server/email-service.mjs)** *(Created)*:
   - Email validation & CRLF injection sanitization.
   - Secret redaction helper.
   - Responsive HTML & text template renderer.
   - Brevo SMTP transport setup (`nodemailer`).
   - Transactional outbox SQLite migrations & queue processor.
2. **[`server/server.mjs`](file:///C:/Users/JASHANTH/Desktop/2k27/server/server.mjs)** *(Modified)*:
   - Initialized email tables and schema migrations on boot.
   - Integrated status transition hook to enqueue emails on first `"valid"` transition.
   - Added spot registration confirmation trigger.
   - Added `POST /api/admin/registrations/:receipt/resend-email` endpoint.
   - Added email status columns to `allRegistrations` and `publicRegistration`.
3. **[`src/Admin.tsx`](file:///C:/Users/JASHANTH/Desktop/2k27/src/Admin.tsx)** *(Modified)*:
   - Added `Email` table column with status badges, counts, and attempt times.
   - Added `Resend email` action button with confirmation prompt.
   - Added email delivery metrics to CSV export.
4. **[`src/admin.css`](file:///C:/Users/JASHANTH/Desktop/2k27/src/admin.css)** *(Modified)*:
   - Styled `.admin-email-badge` for all delivery states.
   - Configured responsive mobile grid layout for the new Email column.
5. **[`server/email-service.test.mjs`](file:///C:/Users/JASHANTH/Desktop/2k27/server/email-service.test.mjs)** *(Created)*:
   - Comprehensive test suite covering validation, templates, outbox queue, partial failures, retries, duplicate protection, and manual resend.
6. **[`.env.example`](file:///C:/Users/JASHANTH/Desktop/2k27/.env.example)** *(Modified)*:
   - Documented Brevo SMTP configuration variables.

---

## 8. Hostinger VPS Production Deployment Instructions

When ready to deploy these changes from your local workspace to your Hostinger Ubuntu VPS:

### Step 1: Commit and Push Changes from Local
```bash
git add .
git commit -m "Implement automated registration confirmation emails via Brevo SMTP"
git push origin main
```

### Step 2: SSH into your Hostinger VPS
```bash
ssh user@your-vps-ip
cd /srv/hackathon
```

### Step 3: Pull Latest Code and Install Dependencies
```bash
git pull origin main
npm install --omit=dev
```

### Step 4: Configure Brevo Credentials in Production `.env`
Edit `/srv/hackathon/.env`:
```bash
nano /srv/hackathon/.env
```
Add your Brevo SMTP credentials:
```env
# Brevo SMTP Configuration
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
SMTP_FROM_EMAIL=no-reply@cybersec-kgrcet.com
SMTP_FROM_NAME=KGRCET Hackathon
```
Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Step 5: Build Frontend Assets
```bash
npm run build
```

### Step 6: Restart Systemd Service
```bash
sudo systemctl restart hackathon
```

### Step 7: Verify Service Logs
```bash
sudo journalctl -u hackathon -n 50 --no-pager
```

### Step 8: Database Migration
**Automatic**: The Node.js server automatically runs table creation and column migrations for `email_outbox`, `email_recipients`, and `drafts` on boot. No manual SQL commands are required.
