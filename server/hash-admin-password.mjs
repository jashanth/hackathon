import { randomBytes, scryptSync } from 'node:crypto'

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  console.error('Run this command in an interactive terminal so the password can be entered without echo.')
  process.exit(1)
}

process.stdout.write('Admin password: ')
process.stdin.setRawMode(true)
process.stdin.resume()

let password = ''
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString()) {
    if (character === '\u0003') {
      process.stdout.write('\n')
      process.exit(130)
    }
    if (character === '\r' || character === '\n') {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      if (password.length < 12) {
        process.stdout.write('\nPassword must be at least 12 characters.\n')
        process.exit(1)
      }
      const salt = randomBytes(16)
      const hash = scryptSync(password, salt, 64)
      password = ''
      process.stdout.write(`\nscrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`)
      process.exit(0)
    }
    if (character === '\u007f' || character === '\b') {
      password = password.slice(0, -1)
    } else {
      password += character
    }
  }
})
