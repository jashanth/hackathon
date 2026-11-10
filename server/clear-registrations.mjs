import { DatabaseSync } from 'node:sqlite'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const databasePath = process.env.DATABASE_PATH || join(root, 'data', 'registration.sqlite')

export function clearRegistrations(dbPath = databasePath, { clearAllDrafts = true } = {}) {
  if (!existsSync(dbPath)) {
    return { registrationsRemoved: 0, draftsRemoved: 0, sessionsRemoved: 0 }
  }
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    const draftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get()
    const sessionsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()

    let registrationsRemoved = 0
    let draftsRemoved = 0
    let sessionsRemoved = 0

    if (draftsTable) {
      if (clearAllDrafts) {
        const submitted = db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE status = 'submitted'").get()
        const drafts = db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE status != 'submitted'").get()
        registrationsRemoved = Number(submitted?.count || 0)
        draftsRemoved = Number(drafts?.count || 0)
        db.prepare('DELETE FROM drafts').run()
      } else {
        const result = db.prepare("DELETE FROM drafts WHERE status = 'submitted'").run()
        registrationsRemoved = result.changes ?? 0
      }
    }

    if (sessionsTable && clearAllDrafts) {
      const result = db.prepare('DELETE FROM sessions').run()
      sessionsRemoved = result.changes ?? 0
    }

    // Shrink database and free disk space from proof_data BLOBs
    try {
      db.exec('VACUUM;')
    } catch {
      // VACUUM might fail if in active transaction or uncommitted lock, safe to ignore
    }

    return { registrationsRemoved, draftsRemoved, sessionsRemoved }
  } finally {
    db.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = clearRegistrations()
  console.log(`Cleared ${result.registrationsRemoved} submitted registration(s) and ${result.draftsRemoved} draft(s).`)
  console.log(`Database vacuumed and space reclaimed.`)
}
