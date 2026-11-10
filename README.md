# KGRCET Hackathon
A full-stack hackathon registration and organizer portal built with a raw `node:http` backend, Node's built-in `node:sqlite` (`DatabaseSync`), and a React/Vite frontend.

---

## Quick Start

### Requirements
- **Node.js `24.20.0` or newer** (required for native `node:sqlite`).
- No external runtime dependencies for the server (uses built-in `node:http`, `node:crypto`, `node:sqlite`).

### Development
```bash
# Install dependencies
npm install

# Start both backend (port 3001) and Vite dev server (port 5173) with API proxying
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

## Registration API

- `GET /api/registration`: Creates or resumes a registration draft.
  ```json
  {
    "draft": { "data": {}, "step": 0, "status": "draft", "receipt": null, "revision": 0 },
    "rules": { "minTeamSize": null, "maxTeamSize": null, "submissionEnabled": false }
  }
  ```
- `PUT /api/registration`: Accepts `{ data, step, revision }` and returns the updated draft. Uses optimistic concurrency; stale revisions return `409 Conflict`.
- `POST /api/registration/submit`: Accepts `{ revision }`. Submission is disabled unless `SUBMISSION_ENABLED=true` and team size bounds (`REGISTRATION_MIN_TEAM_SIZE` / `REGISTRATION_MAX_TEAM_SIZE`) are met.
- **Resume Token**: Cryptographically random 256-bit cookie (`registration_resume`), `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` (in production). Only its SHA-256 hash is persisted in SQLite; raw tokens are never accepted from request payloads.
- **Payload Limits**: Unsafe requests require same-origin verification and `Content-Type: application/json`. Request bodies are limited to 64 KiB.

---

## Admin Authentication & Security Architecture

The admin portal (`/admin/login` and `/admin`) is hardened against credential theft, brute-force attacks, timing attacks, session hijacking, and CSRF.

### 1. Zero Hardcoded Credentials & Strict Allowlist
- No default accounts, plaintext passwords, or fallback credentials exist in the codebase.
- Accounts are loaded **exclusively** from the `ADMIN_ACCOUNTS_JSON` environment variable.
- Only two organizers are authorized to access the system:
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

### 3. How to Create and Hash Admin Passwords
Use the built-in CLI command to generate scrypt hashes interactively without leaking passwords into shell history or process arguments:

```bash
npm run hash-admin-password
```

#### What happens during execution:
1. **Interactive Prompt**: Prompts for password with input hidden (no terminal echo).
2. **Password Validation**:
   - Must be at least **12 characters** long.
   - Must **not** contain fragments of organizer names or emails (`saivaibhav`, `jashanth`, `aluguri`, `gonipati`, `kgrcet`, `cybersec`, etc.).
   - Must **not** be in the built-in list of common/dictionary passwords.
3. **Confirmation**: Re-prompts to confirm the password with hidden echo.
4. **Hash Output**: Computes the 64-byte scrypt hash with a fresh random salt and prints:
   ```
   scrypt$9a2faabeafee792d603f6adf97ca6890$6f8676884ea018479a95c7a966b12d4be2877401917b7ea48f5de15cd666f1e824efdebfe48a7c85fd9c80f3bb8ffd5132f6f4e989e364246d8c0e6fe64c1d52
   ```

Copy this hash into your `.env` inside `ADMIN_ACCOUNTS_JSON`.

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

When deployed behind an Nginx reverse proxy (e.g. at `https://hackathon.cybersec-kgrcet.com` terminating TLS and forwarding to `127.0.0.1:3002`):

1. **`PUBLIC_ORIGIN`**: Set to the public HTTPS URL (e.g. `https://hackathon.cybersec-kgrcet.com`). State-changing requests (`POST`, `PUT`, etc.) must have an `Origin` or `Referer` matching this exact origin.
2. **`TRUST_PROXY=true`**: Enables reading proxy headers:
   - Evaluates `X-Forwarded-Proto` and `X-Forwarded-Host`.
   - Takes the **last address** from `X-Forwarded-For` (the one appended by the trusted Nginx proxy) for rate limiting and audit logging.
3. **Rejection**: Cross-origin requests and requests without a matching `Origin`/`Referer` receive `HTTP 403 Forbidden` (`"same-origin request required"`).

---

## Brute-Force & Guessing Defense

- **Persistent Counters in SQLite**: Stored in `admin_login_attempts` table so lockouts survive service restarts.
- **Thresholds**: 5 failed login attempts within a 15-minute window locks both the originating IP and target account for 15 minutes. Delay progressively scales on repeated lockouts.
- **Uniform Response & Timing Defense**:
  - Non-existent accounts, incorrect passwords, and locked accounts all return the identical generic status and payload:
    ```
    HTTP 401 Unauthorized
    { "error": "Invalid credentials" }
    ```
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
# Hash for Aluguri SaiVaibhav (saivaibhavaluguri@gmail.com)
npm run hash-admin-password

# Hash for Jashanth Gonipati (jashanthgonipati@gmail.com)
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
# Optional absolute limit: unset = sessions never expire by time
# ADMIN_SESSION_MAX_HOURS=24

SUBMISSION_ENABLED=true
REGISTRATION_MIN_TEAM_SIZE=2
REGISTRATION_MAX_TEAM_SIZE=4
```

### 4. Build Frontend Assets
```bash
npm run build
```

### 5. Restart Systemd Service
```bash
# Restart the hackathon service
sudo systemctl restart hackathon

# Verify service status and logs
sudo systemctl status hackathon
sudo journalctl -u hackathon -n 50 --no-pager
```

### 6. Clearing Test Registrations
If test data accumulated during testing and you want a clean slate before launch:

```bash
# In the project directory on VPS:
npm run clear-registrations
```
This removes all submitted registrations and in-progress registration drafts, reclaims disk space using SQLite `VACUUM`, and leaves admin accounts and active admin login sessions untouched.
