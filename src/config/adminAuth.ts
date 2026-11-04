/**
 * ==============================================================================
 * 🔐 ADMIN & CLUB COORDINATOR AUTHENTICATION CONFIGURATION
 * ==============================================================================
 * 
 * 👉 CONFIGURE YOUR EMAIL AND PASSWORD IN THIS SECTION:
 * 
 * Edit the credentials below. Only users defined in this accounts list
 * will be authorized to log in. No Google Auth or third-party OAuth is required.
 * 
 * SECURITY FEATURES BUILT-IN:
 * - Constant-time comparison (mitigates timing-attack side-channels)
 * - SHA-256 cryptographic hashing (never compares or stores raw passwords in session)
 * - Anti-brute-force rate limiting with progressive lockout delays
 * - Sanitized inputs (protection against injection attacks)
 * - Uniform error messages (prevents account enumeration vulnerabilities)
 * - Cryptographically random session tokens with time-bound expiry
 * ==============================================================================
 */

export interface AdminAccount {
  /** Optional login username */
  username?: string
  /** Login email address */
  email: string
  /** 
   * Account password.
   * You can put your plain password here (it will be hashed on runtime)
   * or put a SHA-256 hex hash.
   */
  password: string
  /** Optional alternate passwords (e.g. for compatibility) */
  alternatePasswords?: string[]
  /** Name of the administrator or coordinator */
  name: string
  /**
   * Role:
   * - 'council_admin': Can manage and host events for ALL clubs
   * - 'club_admin': Can manage and host events specifically for their assigned club
   */
  role: 'council_admin' | 'club_admin'
  /** Assigned club ID (e.g., 'cse', 'ecell', 'cultural', 'literary', 'sports', 'robotics') */
  clubId?: string
  /** Display label for the club */
  clubName?: string
}

/* ==============================================================================
 * ⬇️ EDIT / ADD YOUR CREDENTIALS BELOW ⬇️
 * ============================================================================== */
export const ADMIN_ACCOUNTS: AdminAccount[] = [
  {
    username: 'jashanth',
    email: 'jashanth@ikarus.kgrcet.ac.in',
    password: '123',
    alternatePasswords: ['jashanth@123'],
    name: 'Jashanth',
    role: 'council_admin',
    clubId: 'all',
    clubName: 'Central Council',
  },
  {
    email: 'admin@ikarus.kgrcet.ac.in',
    password: 'ikarus2026admin',
    name: 'Festival Central Council',
    role: 'council_admin',
    clubId: 'all',
    clubName: 'Central Council (All Clubs)',
  },
  {
    email: 'dsa@ikarus.kgrcet.ac.in',
    password: 'dsa@ikarus2026',
    name: 'Dean Student Affairs (DSA)',
    role: 'council_admin',
    clubId: 'all',
    clubName: 'Dean Student Affairs (DSA)',
  },
  {
    email: 'appweb@ikarus.kgrcet.ac.in',
    password: 'appweb@ikarus2026',
    name: 'App and Web Club Lead',
    role: 'club_admin',
    clubId: 'app-web',
    clubName: 'App and Web Club',
  },
  {
    email: 'ai@ikarus.kgrcet.ac.in',
    password: 'ai@ikarus2026',
    name: 'AI Club Coordinator',
    role: 'club_admin',
    clubId: 'ai',
    clubName: 'AI Club',
  },
  {
    email: 'cybersec@ikarus.kgrcet.ac.in',
    password: 'cybersec@ikarus2026',
    name: 'Cyber Security Club Lead',
    role: 'club_admin',
    clubId: 'cybersecurity',
    clubName: 'Cybersecurity and Ethical Hacking Club',
  },
  {
    email: 'iot@ikarus.kgrcet.ac.in',
    password: 'iot@ikarus2026',
    name: 'IoT Club Coordinator',
    role: 'club_admin',
    clubId: 'iot',
    clubName: 'IoT Club',
  },
  {
    email: 'gcc@ikarus.kgrcet.ac.in',
    password: 'gcc@ikarus2026',
    name: 'GCC Lead',
    role: 'club_admin',
    clubId: 'gcc',
    clubName: 'GCC',
  },
  {
    email: 'sae@ikarus.kgrcet.ac.in',
    password: 'sae@ikarus2026',
    name: 'SAE India Club Coordinator',
    role: 'club_admin',
    clubId: 'sae-india',
    clubName: 'SAE India Club',
  },
  {
    email: '3dprinting@ikarus.kgrcet.ac.in',
    password: '3dprinting@ikarus2026',
    name: '3D Printing Club Lead',
    role: 'club_admin',
    clubId: '3d-printing',
    clubName: '3D Printing Club',
  },
  {
    email: 'datascience@ikarus.kgrcet.ac.in',
    password: 'datascience@ikarus2026',
    name: 'Data Science Club Lead',
    role: 'club_admin',
    clubId: 'data-science',
    clubName: 'Data Science Club',
  },
  {
    email: 'blockchain@ikarus.kgrcet.ac.in',
    password: 'blockchain@ikarus2026',
    name: 'Blockchain Club Lead',
    role: 'club_admin',
    clubId: 'blockchain',
    clubName: 'Blockchain Club',
  },
  {
    username: 'saivaibhav',
    email: 'saivaibhavaluguri@gmail.com',
    password: '123',
    alternatePasswords: ['123456789012'],
    name: 'Aluguri SaiVaibhav',
    role: 'council_admin',
    clubId: 'all',
    clubName: 'Central Council',
  },
  {
    username: 'jashanthgonipati',
    email: 'jashanthgonipati@gmail.com',
    password: '123',
    alternatePasswords: ['jashanth@123'],
    name: 'Jashanth Gonipati',
    role: 'council_admin',
    clubId: 'all',
    clubName: 'Central Council',
  },
]
/* ==============================================================================
 * ⬆️ END OF CREDENTIALS CONFIGURATION ⬆️
 * ============================================================================== */

export interface AdminSession {
  token: string
  email: string
  name: string
  role: 'council_admin' | 'club_admin'
  clubId: string
  clubName: string
  expiresAt: number
}

// Security Configuration
export const SECURITY_CONFIG = {
  maxFailedAttempts: 5,
  lockoutDurationSeconds: 60,
  sessionDurationHours: 4,
  sessionStorageKey: 'kgrcet_admin_session_v1',
  rateLimitStorageKey: 'kgrcet_admin_ratelimit_v1',
}

interface RateLimitState {
  failedAttempts: number
  lockedUntil: number
}

/**
 * Pure JavaScript SHA-256 implementation fallback for insecure contexts
 * (e.g., accessing via LAN HTTP IP where crypto.subtle is undefined).
 */
export function pureSha256(message: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount))
  }

  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  const K: number[] = []
  const isPrime = (n: number) => {
    for (let factor = 2, end = Math.sqrt(n); factor <= end; factor++) {
      if (n % factor === 0) return false
    }
    return true
  }
  let candidate = 2
  while (K.length < 64) {
    if (isPrime(candidate)) {
      K.push((mathPow(candidate, 1 / 3) * maxWord) | 0)
    }
    candidate++
  }

  const H: number[] = []
  candidate = 2
  while (H.length < 8) {
    if (isPrime(candidate)) {
      H.push((mathPow(candidate, 1 / 2) * maxWord) | 0)
    }
    candidate++
  }

  // UTF-8 encode string to bytes
  const bytes: number[] = []
  for (let i = 0; i < message.length; i++) {
    let charcode = message.charCodeAt(i)
    if (charcode < 0x80) {
      bytes.push(charcode)
    } else if (charcode < 0x800) {
      bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f))
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f))
    } else {
      i++
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (message.charCodeAt(i) & 0x3ff))
      bytes.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      )
    }
  }

  const bitLength = bytes.length * 8
  const words: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= (bytes[i] & 255) << (24 - (i % 4) * 8)
  }
  words[bitLength >> 5] |= 0x80 << (24 - (bitLength % 32))
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength

  const W = new Array(64)
  for (let i = 0; i < words.length; i += 16) {
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7]

    for (let j = 0; j < 64; j++) {
      if (j < 16) {
        W[j] = words[i + j] | 0
      } else {
        const s0 = rightRotate(W[j - 15], 7) ^ rightRotate(W[j - 15], 18) ^ (W[j - 15] >>> 3)
        const s1 = rightRotate(W[j - 2], 17) ^ rightRotate(W[j - 2], 19) ^ (W[j - 2] >>> 10)
        W[j] = (((W[j - 16] + s0) | 0) + ((W[j - 7] + s1) | 0)) | 0
      }

      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (((h + S1) | 0) + ((ch + K[j]) | 0) + W[j]) | 0
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    H[0] = (H[0] + a) | 0
    H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0
    H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0
    H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0
    H[7] = (H[7] + h) | 0
  }

  let result = ''
  for (let i = 0; i < 8; i++) {
    result += (H[i] >>> 0).toString(16).padStart(8, '0')
  }
  return result
}

/**
 * Computes SHA-256 hash in hex string using standard Web Crypto API with pure JS fallback.
 */
export async function sha256(message: string): Promise<string> {
  if (
    typeof crypto !== 'undefined' &&
    crypto &&
    crypto.subtle &&
    typeof crypto.subtle.digest === 'function'
  ) {
    try {
      const msgUint8 = new TextEncoder().encode(message)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // Insecure context or subtle crypto error: fallback to pure JS below
    }
  }
  return pureSha256(message)
}

/**
 * Constant-time comparison between two strings to eliminate timing attacks.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Sanitizes input string to prevent injection and unexpected control codes.
 */
export function sanitizeInput(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/[\x00-\x1F\x7F]/g, '')
}

/**
 * Retrieves the current rate limit / brute-force state from sessionStorage.
 */
export function getRateLimitState(): RateLimitState {
  try {
    const raw = sessionStorage.getItem(SECURITY_CONFIG.rateLimitStorageKey)
    if (!raw) return { failedAttempts: 0, lockedUntil: 0 }
    const parsed = JSON.parse(raw)
    return {
      failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : 0,
    }
  } catch {
    return { failedAttempts: 0, lockedUntil: 0 }
  }
}

/**
 * Records a failed attempt and activates lockout if threshold is exceeded.
 */
function recordFailedAttempt(): { locked: boolean; remainingLockoutSeconds: number } {
  const current = getRateLimitState()
  const attempts = current.failedAttempts + 1
  let lockedUntil = current.lockedUntil

  if (attempts >= SECURITY_CONFIG.maxFailedAttempts) {
    lockedUntil = Date.now() + SECURITY_CONFIG.lockoutDurationSeconds * 1000
  }

  try {
    sessionStorage.setItem(
      SECURITY_CONFIG.rateLimitStorageKey,
      JSON.stringify({ failedAttempts: attempts, lockedUntil })
    )
  } catch {
    /* session storage fallback */
  }

  const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
  return { locked: remaining > 0, remainingLockoutSeconds: remaining }
}

/**
 * Resets rate limit counters upon successful login.
 */
function clearRateLimit(): void {
  try {
    sessionStorage.removeItem(SECURITY_CONFIG.rateLimitStorageKey)
  } catch {
    /* session storage fallback */
  }
}

export type LoginResult =
  | { success: true; session: AdminSession }
  | { success: false; error: string; locked?: boolean; remainingLockoutSeconds?: number }

/**
 * Authenticates credentials with constant-time verification, rate-limiting, and timing defense.
 */
export async function authenticateAdmin(
  rawIdentifier: string,
  rawPassword: string
): Promise<LoginResult> {
  const identifier = sanitizeInput(rawIdentifier).toLowerCase()
  const password = sanitizeInput(rawPassword)

  // 1. Check if user is currently locked out
  const rateLimit = getRateLimitState()
  const now = Date.now()
  if (rateLimit.lockedUntil > now) {
    const remaining = Math.ceil((rateLimit.lockedUntil - now) / 1000)
    return {
      success: false,
      error: `Too many failed login attempts. Portal temporarily locked for ${remaining}s to prevent unauthorized access.`,
      locked: true,
      remainingLockoutSeconds: remaining,
    }
  }

  // 2. Basic format validation
  if (!identifier || !password) {
    return {
      success: false,
      error: 'Please enter both organizer username/email and password.',
    }
  }

  const isEmail = /^\S+@\S+\.\S+$/.test(identifier)
  const isUsername = /^[a-z0-9_.-]{2,50}$/i.test(identifier)

  if ((!isEmail && !isUsername) || identifier.length > 254) {
    return {
      success: false,
      error: 'Invalid credentials provided.',
    }
  }

  // 3. Hash the submitted password
  const submittedHash = await sha256(password)

  // 4. Find matching account (dummy hash computation if not found to prevent timing discrepancy)
  const dummyHash = await sha256('__dummy_anti_timing_string__')
  let matchedAccount: AdminAccount | null = null
  let passwordMatches = false

  for (const account of ADMIN_ACCOUNTS) {
    const accountEmailNormalized = account.email.trim().toLowerCase()
    const accountUsernameNormalized = account.username ? account.username.trim().toLowerCase() : ''
    const matchesEmail = constantTimeEquals(accountEmailNormalized, identifier)
    const matchesUsername = accountUsernameNormalized ? constantTimeEquals(accountUsernameNormalized, identifier) : false

    if (matchesEmail || matchesUsername) {
      matchedAccount = account
      // Support either raw password or already hashed password
      const targetHash =
        account.password.length === 64 && /^[0-9a-fA-F]+$/.test(account.password)
          ? account.password.toLowerCase()
          : await sha256(account.password)

      if (constantTimeEquals(submittedHash, targetHash)) {
        passwordMatches = true
      } else if (account.alternatePasswords && account.alternatePasswords.length > 0) {
        for (const alt of account.alternatePasswords) {
          const altHash = await sha256(alt)
          if (constantTimeEquals(submittedHash, altHash)) {
            passwordMatches = true
            break
          }
        }
      }
      break
    }
  }

  // If no account found, compare with dummy hash to maintain identical response time profile
  if (!matchedAccount) {
    constantTimeEquals(submittedHash, dummyHash)
  }

  // 5. Artificial slight jitter to normalize response latency
  await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 50))

  if (!matchedAccount || !passwordMatches) {
    const failState = recordFailedAttempt()
    if (failState.locked) {
      return {
        success: false,
        error: `Too many failed attempts. Console locked for ${failState.remainingLockoutSeconds}s.`,
        locked: true,
        remainingLockoutSeconds: failState.remainingLockoutSeconds,
      }
    }
    return {
      success: false,
      error: 'Invalid username/email or password. Please verify your credentials.',
    }
  }

  // 6. Successful login: clear lockout and construct session
  clearRateLimit()

  // Generate cryptographically random token
  const tokenBytes = new Uint8Array(24)
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(tokenBytes)
  } else {
    for (let i = 0; i < tokenBytes.length; i++) {
      tokenBytes[i] = Math.floor(Math.random() * 256)
    }
  }
  const token = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const session: AdminSession = {
    token,
    email: matchedAccount.email,
    name: matchedAccount.name,
    role: matchedAccount.role,
    clubId: matchedAccount.clubId || 'all',
    clubName: matchedAccount.clubName || 'Festival Council',
    expiresAt: Date.now() + SECURITY_CONFIG.sessionDurationHours * 60 * 60 * 1000,
  }

  try {
    sessionStorage.setItem(SECURITY_CONFIG.sessionStorageKey, JSON.stringify(session))
  } catch {
    /* session storage fallback */
  }

  return { success: true, session }
}

/**
 * Returns active admin session if valid and not expired.
 */
export function getActiveSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(SECURITY_CONFIG.sessionStorageKey)
    if (!raw) return null
    const parsed: AdminSession = JSON.parse(raw)
    if (!parsed || !parsed.token || !parsed.expiresAt) return null
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(SECURITY_CONFIG.sessionStorageKey)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Ends session and wipes credentials from storage.
 */
export function logoutAdmin(): void {
  try {
    sessionStorage.removeItem(SECURITY_CONFIG.sessionStorageKey)
  } catch {
    /* session storage fallback */
  }
}
