# KGRCET Hackathon 2027
A full-stack national hackathon registration and organizer portal built with a raw `node:http` backend, Node's built-in `node:sqlite` (`DatabaseSync`), and a React/Vite frontend.

---

## Quick Start

### Requirements
- **Node.js `24.20.0` or newer** (required for native `node:sqlite`).
- Zero external runtime framework dependencies for the core server (uses built-in `node:http`, `node:crypto`, `node:sqlite`, and `nodemailer` for transactional emails).

### Development
```bash
# Install dependencies
npm install

# Start both backend (port 3001 or next available) and Vite dev server (port 5173) with API proxying
npm run dev
```

### Production Build & Run
```bash
# Build frontend to dist/
npm run build

# Start the server (serves dist/ and APIs on PORT or 3001)
npm start
```

### Running Tests
```bash
npm run test:server
```

---

## Registration Architecture & 4-Digit IDs

- **4-Digit Chronological Registration IDs**: Registrations are assigned clean, sequential 4-digit identifiers starting from `1001` (e.g. `1001`, `1002`, `1003`, etc.). This replaces complex hash identifiers, making physical desk check-ins, badge printing, and payment reconciliation fast and error-free.
- `GET /api/registration`: Creates or resumes a registration draft.
  ```json
  {
    "draft": { "data": {}, "step": 0, "status": "draft", "receipt": null, "revision": 0 },
    "rules": { "minTeamSize": 2, "maxTeamSize": 4, "submissionEnabled": false }
  }
  ```
- `PUT /api/registration`: Accepts `{ data, step, revision }` and returns the updated draft. Uses optimistic concurrency; stale revisions return `409 Conflict`.
- `POST /api/registration/submit`: Accepts `{ revision }`. Submission is disabled unless `SUBMISSION_ENABLED=true` and team size bounds (`REGISTRATION_MIN_TEAM_SIZE` / `REGISTRATION_MAX_TEAM_SIZE`) are met. Automatically assigns the next 4-digit chronological registration ID.
- **Resume Token**: Cryptographically random 256-bit cookie (`registration_resume`), `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` (in production). Only its SHA-256 hash is persisted in SQLite; raw tokens are never accepted from request payloads.
- **Payload Limits**: Unsafe requests require same-origin verification and `Content-Type: application/json`. Request bodies are limited to 64 KiB (3 MiB for requests carrying payment screenshots).

---

## Transactional Email System (Brevo SMTP)

When an administrator marks a team's registration as **Valid**, the backend compiles individual personalized HTML confirmation emails for the team leader and every team member, dispatching them through Brevo SMTP via a persistent transactional outbox.

### Design & Theme Alignment
The email template is custom-crafted to mirror the website's dark celestial luxury aesthetic:
- **Obsidian & Void Background**: Solid deep obsidian surfaces (`#07060a` and `#0e0b13`) with subtle hairline gilded borders.
- **Celestial Gold Foil Accent**: Header features a top 3px gold foil gradient bar and **Cormorant Serif Display** typography with italic gold year accent.
- **4-Digit Registration Credentials Plaque**: Clean display of the 4-digit Registration ID, Team Name, Designation, and Fee Status `(Paid & Verified)`.
- **Member List**: Clear breakdown of team leader (`◆` gold diamond) and team members (`◇` amethyst diamond).
- **Cosmic Amethyst Schedule Card**: Event schedule and campus venue in deep cosmic purple (`#140d1e`).
- **Resilient Email Compatibility**: Standard table-based layouts with inline CSS, supported across desktop and mobile inboxes (Gmail, Outlook, Apple Mail, Yahoo) with zero broken image dependencies.

### SMTP Configuration (`.env`)
```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-smtp-login
SMTP_PASS=your-smtp-key
SMTP_FROM_EMAIL=no-reply@cybersec-kgrcet.com
SMTP_FROM_NAME=KGRCET Hackathon
```
*Note: In local development, if SMTP credentials are omitted, the server runs in safe dry-run simulation mode.*

---

## Admin Organizer Console

Accessible at `/admin` (with authentication at `/admin/login`).

### Features:
1. **Live Test Email Dispatcher**:
   - Header features a dedicated **Test Email** button.
   - Organizers can enter any target email address and hit Enter to instantly dispatch a sample verified confirmation email to inspect formatting in their actual inbox.
   - Endpoint: `POST /api/admin/test-email` (authenticated).
2. **Real-time SSE & Cross-Tab Sync**:
   - Live push updates via Server-Sent Events (`GET /api/admin/registrations/stream`).
   - Cross-tab synchronization via `BroadcastChannel`.
3. **Optimized Scrolling Performance**:
   - Hardware-accelerated solid surface layer compositing (`contain: paint; transform: translateZ(0)`).
   - Eliminates layout shifting and browser GPU rasterization flickering during page scrolling.
4. **Registration Verification & Status Management**:
   - Mark teams as `Valid` or `Invalid`. Marking valid triggers idempotent automated email queuing.
   - **Resend Email**: Ability to manually re-dispatch confirmation emails to team members with one click.
5. **Spot Registration & Editing**:
   - Register walk-in spot teams with instant 4-digit ID assignment and receipt generation.
   - Edit submitted team details or reconcile payment information (Cash or UPI).
6. **CSV Export**:
   - Export all registrations, participant rosters, and payment reconciliation records to clean CSV.

---

## Admin Authentication & Security Architecture

The admin portal is hardened against credential theft, brute-force attacks, timing attacks, session hijacking, and CSRF.

### 1. Zero Hardcoded Credentials & Strict Allowlist
- No default accounts, plaintext passwords, or fallback credentials exist in the codebase.
- Accounts are loaded **exclusively** from the `ADMIN_ACCOUNTS_JSON` environment variable.
- Only authorized organizers are permitted access:
  1. `saivaibhavaluguri@gmail.com` ("Aluguri SaiVaibhav")
  2. `jashanthgonipati@gmail.com`, username `jashanth` ("Jashanth Gonipati")
- In production (`NODE_ENV=production`), the server **refuses to start** if `ADMIN_ACCOUNTS_JSON` is missing, empty, contains unallowlisted accounts, or has invalid password hashes.

### 2. Password Hashing with scrypt (`node:crypto`)
- Admin passwords use Node's native `scrypt` with production parameters:
  - $N = 32768$ (CPU/memory cost)
  - $r = 8$ (block size)
  - $p = 1$ (parallelization)
  - Key length: 64 bytes
  - Unique cryptographically random 16-byte salt per hash
- Stored string format: `scrypt$<salt-hex>$<hash-hex>`
- Constant-time verification with `crypto.timingSafeEqual`.

### 3. Password Generator CLI
Generate scrypt hashes interactively without leaking passwords into shell history or process arguments:

```bash
npm run hash-admin-password
```

#### Verification Rules:
- Must be at least **12 characters** long.
- Must **not** contain fragments of organizer names or emails (`saivaibhav`, `jashanth`, `aluguri`, `gonipati`, `kgrcet`, etc.).
- Must **not** be in the dictionary of common passwords.

---

## Configuring `ADMIN_ACCOUNTS_JSON`

In `.env` (or in your host service environment), configure `ADMIN_ACCOUNTS_JSON` as a single-quoted JSON array of organizer objects:

```env
ADMIN_ACCOUNTS_JSON='[
  {
    "email": "saivaibhavaluguri@gmail.com",
    "name": "Aluguri SaiVaibhav",
    "passwordHash": "scrypt$<salt-hex>$<hash-hex>"
  },
  {
    "email": "jashanthgonipati@gmail.com",
    "username": "jashanth",
    "name": "Jashanth Gonipati",
    "passwordHash": "scrypt$<salt-hex>$<hash-hex>"
  }
]'
```

---

## Reverse Proxy & Origin Protection (`PUBLIC_ORIGIN`)

When deployed behind an Nginx reverse proxy (terminating TLS and forwarding to local port):

1. **`PUBLIC_ORIGIN`**: Set to the public HTTPS URL (e.g. `https://hackathon.cybersec-kgrcet.com`). State-changing requests (`POST`, `PUT`, etc.) must have an `Origin` or `Referer` matching this exact origin.
2. **`TRUST_PROXY=true`**: Enables reading proxy headers:
   - Evaluates `X-Forwarded-Proto` and `X-Forwarded-Host`.
   - Takes the **last address** from `X-Forwarded-For` (appended by the trusted proxy) for rate limiting and audit logging.
3. **Rejection**: Cross-origin requests and requests without a matching `Origin`/`Referer` receive `HTTP 403 Forbidden`.

---

## Brute-Force & Guessing Defense

- **Persistent Counters in SQLite**: Stored in `admin_login_attempts` table so lockouts survive service restarts.
- **Thresholds**: 5 failed login attempts within a 15-minute window locks both the originating IP and target account for 15 minutes. Delay progressively scales on repeated lockouts.
- **Uniform Response & Timing Defense**:
  - Non-existent accounts, incorrect passwords, and locked accounts all return the identical generic status and payload (`HTTP 401 Unauthorized`).
  - For non-existent accounts and locked targets, a **dummy scrypt verification** is executed against a constant salt to ensure identical CPU execution time (~20–40ms), preventing timing enumeration.
- **Body & Content-Type Restriction**: `POST /api/admin/login` strictly enforces `Content-Type: application/json` and rejects payloads exceeding 4 KB with `HTTP 413 Payload Too Large`.

---

## Session Management

- **Hardened Persistent Cookie**: Stored under cookie name `__Host-admin` with flags `HttpOnly; SameSite=Strict; Path=/; Secure` and `Max-Age=31536000` (1 year). Closing the browser does not log the organizer out.
- **Token Security**: 32 cryptographically random bytes (`crypto.randomBytes(32)`). Only the SHA-256 hash is stored in SQLite table `admin_sessions`. Pre-login tokens are revoked upon successful authentication.
- **Session Lifetime**:
  - By default, sessions **never expire by elapsed time**. Organizers remain logged in indefinitely until manual logout, password change, or session clear.
  - Optional absolute limit via `ADMIN_SESSION_MAX_HOURS` (unset or `0` = no expiry).
- **Session Revocation**:
  - Single session logout: `POST /api/admin/logout` (destroys active session and clears cookie).
  - All-device logout: `POST /api/admin/logout-all` (deletes all active sessions for that admin account).
  - Password change: modifying an account's password hash in `ADMIN_ACCOUNTS_JSON` automatically invalidates all previous sessions for that account.
  - Global reset script: `npm run clear-admin-sessions` clears all admin sessions from the database.
- **Deny-by-Default**: Every `/api/admin/*` endpoint (except public login and session check) requires a valid session; unauthenticated requests receive `HTTP 401`.

---

## Security Headers & Audit Logging

### Headers Applied to Every Response
- **Content-Security-Policy**:
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';`
- **X-Content-Type-Options**: `nosniff`
- **X-Frame-Options**: `DENY`
- **Referrer-Policy**: `same-origin`
- **Cache-Control**: `no-store` on all `/api/admin/*` routes.
- **Strict-Transport-Security**: `max-age=31536000; includeSubDomains` applied whenever the request arrived via HTTPS (or trusted proxy proto https).

### Audit Logging
All admin login attempts are recorded in SQLite table `admin_audit_log` (`timestamp`, `ip`, `email_attempted`, `result` ['success' | 'fail' | 'locked'], `user_agent`).
- Passwords and password hashes are **never** logged.
- Authenticated organizers can inspect the last 100 authentication events via `GET /api/admin/audit-log`.

---

## Environment Variables Reference

| Variable | Description | Example / Default |
|---|---|---|
| `NODE_ENV` | Environment mode (`production` enables strict checks & HTTPS cookies) | `production` |
| `PORT` | Listening port for Node server | `3002` (default `3001`) |
| `DATABASE_PATH` | Path to SQLite database file | `data/registration.sqlite` |
| `ADMIN_ACCOUNTS_JSON` | JSON string defining allowlisted admins & scrypt hashes | See example above |
| `ADMIN_SESSION_MAX_HOURS` | Optional absolute session lifetime in hours (`unset` or `0` = never expire) | Optional (default: no expiry) |
| `PUBLIC_ORIGIN` | Single authorized origin for CSRF/Origin validation | `https://hackathon.cybersec-kgrcet.com` |
| `TRUST_PROXY` | Whether Node sits behind a trusted reverse proxy | `true` or `false` |
| `SUBMISSION_ENABLED` | Whether public registrations are accepted | `true` or `false` |
| `REGISTRATION_MIN_TEAM_SIZE` | Minimum team size for submission | `2` |
| `REGISTRATION_MAX_TEAM_SIZE` | Maximum team size for submission | `4` |
| `SMTP_HOST` | Brevo SMTP server host | `smtp-relay.brevo.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | Confidential login |
| `SMTP_PASS` | SMTP password / key | Confidential secret |
| `SMTP_FROM_EMAIL` | Verified sender email address | `no-reply@cybersec-kgrcet.com` |
| `SMTP_FROM_NAME` | Sender display name | `KGRCET Hackathon` |

---

## VPS Deployment Guide

Step-by-step commands to deploy and configure the site on the VPS:

### 1. SSH into the VPS
```bash
ssh user@your-vps-ip
cd /srv/hackathon
```

### 2. Generate Hashes for Both Admins
Run the password generator for each organizer:

```bash
# Hash for Aluguri SaiVaibhav
npm run hash-admin-password

# Hash for Jashanth Gonipati
npm run hash-admin-password
```

### 3. Configure `/srv/hackathon/.env`
Create or edit `/srv/hackathon/.env`:

```env
NODE_ENV=production
PORT=3002
PUBLIC_ORIGIN=https://hackathon.cybersec-kgrcet.com
TRUST_PROXY=true
DATABASE_PATH=/srv/hackathon/data/registration.sqlite
ADMIN_ACCOUNTS_JSON='[{"email":"saivaibhavaluguri@gmail.com","name":"Aluguri SaiVaibhav","passwordHash":"scrypt$<salt-hex>$<hash-hex>"},{"email":"jashanthgonipati@gmail.com","username":"jashanth","name":"Jashanth Gonipati","passwordHash":"scrypt$<salt-hex>$<hash-hex>"}]'

SUBMISSION_ENABLED=true
REGISTRATION_MIN_TEAM_SIZE=2
REGISTRATION_MAX_TEAM_SIZE=4

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-user
SMTP_PASS=your-brevo-smtp-key
SMTP_FROM_EMAIL=no-reply@cybersec-kgrcet.com
SMTP_FROM_NAME=KGRCET Hackathon
```

### 4. Build Frontend Assets
```bash
npm run build
```

### 5. Restart Systemd Service
```bash
sudo systemctl restart hackathon
sudo systemctl status hackathon
```

### 6. Clearing Test Registrations
If test data accumulated during testing and you want a clean slate before launch:

```bash
npm run clear-registrations
```
This removes all submitted registrations and in-progress drafts, resets database sequence allocation, reclaims disk space using SQLite `VACUUM`, and leaves admin accounts and active admin login sessions untouched.
