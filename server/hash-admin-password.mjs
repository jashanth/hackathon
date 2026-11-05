import { randomBytes, scryptSync } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const SCRYPT_N = 32768
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const SCRYPT_KEYLEN = 64
export const SCRYPT_MAXMEM = 64 * 1024 * 1024

const FORBIDDEN_SUBSTRINGS = [
  'saivaibhav',
  'aluguri',
  'jashanth',
  'gonipati',
  'cybersec',
  'kgrcet',
  'hackathon',
  'ikarus',
]

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'administrator',
  'admin1234567',
  '123456789012',
  'qwertyuiopas',
  'changeme1234',
  'correcthorsebatterystaple',
  'iloveyou1234',
  'welcome12345',
  'letmein12345',
  'hackathon2026',
  'hackathon2027',
])

export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters.'
  }
  const lower = password.toLowerCase()
  for (const sub of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(sub)) {
      return `Password must not contain name, email, or username fragment ("${sub}").`
    }
  }
  if (COMMON_PASSWORDS.has(lower)) {
    return 'Password is in the common passwords list; please choose a stronger password.'
  }
  return null
}

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()

    let value = ''
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') {
          cleanup()
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '\r' || char === '\n') {
          cleanup()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else {
          value += char
        }
      }
    }

    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(wasRaw || false)
      stdin.pause()
    }

    stdin.on('data', onData)
  })
}

async function main() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    console.error('Run this command in an interactive terminal so the password can be entered without echo.')
    process.exit(1)
  }

  const password = await promptHidden('Admin password: ')
  const error = validatePasswordStrength(password)
  if (error) {
    console.error(`Error: ${error}`)
    process.exit(1)
  }

  const confirm = await promptHidden('Confirm admin password: ')
  if (password !== confirm) {
    console.error('Error: Passwords do not match.')
    process.exit(1)
  }

  const hash = hashPassword(password)
  console.log(`\nGenerated password hash:\n${hash}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
