import { DatabaseSync } from 'node:sqlite'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')

export function clearAdminSessions(dbPath = databasePath) {
  if (!existsSync(dbPath)) {
    return 0
  }
  const db = new DatabaseSync(dbPath)
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sessions'").get()
    if (!table) return 0
    const result = db.prepare('DELETE FROM admin_sessions').run()
    return result.changes ?? 0
  } finally {
    db.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const removed = clearAdminSessions()
  console.log(`Cleared ${removed} admin session${removed === 1 ? '' : 's'}.`)
}
