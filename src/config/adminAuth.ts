/**
 * Admin Authentication Types & Interfaces
 * Credentials must NEVER be stored in frontend code.
 * Admin accounts are configured on the server via ADMIN_ACCOUNTS_JSON.
 */

export interface AdminAccount {
  username?: string
  email: string
  name: string
  role?: 'council_admin' | 'club_admin'
  clubId?: string
  clubName?: string
}

export const ADMIN_ACCOUNTS: AdminAccount[] = []

export interface AdminSession {
  token: string
  email: string
  name: string
  role?: 'council_admin' | 'club_admin'
  expiresAt: number
}
