import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, ArrowRight, ChevronDown, Download, Eye, EyeOff, LogOut, Pencil, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import './admin.css'

type Session = { email: string; name: string }
type Member = { name: string; email: string; college: string }
type TeamData = { teamName: string; teamSize: string; college: string; leadName: string; email: string; phone: string; members: Member[] }
type ReviewStatus = 'pending' | 'valid' | 'invalid'
type AdminRegistration = {
  receipt: string
  revision: number
  data: TeamData
  source: 'website' | 'spot'
  reviewStatus: ReviewStatus
  reviewedBy: string | null
  reviewedAt: number | null
  submittedAt: number | null
}
type Rules = { minTeamSize: number | null; maxTeamSize: number | null; submissionEnabled: boolean }
type Tab = 'registrations' | 'spot' | 'counts'

const statusLabels: Record<ReviewStatus, string> = { pending: 'Pending', valid: 'Valid', invalid: 'Invalid' }
const blankTeam = (): TeamData => ({ teamName: '', teamSize: '', college: '', leadName: '', email: '', phone: '', members: [] })

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly remainingLockoutSeconds?: number) {
    super(message)
  }
}

const serverUnavailable = 'The server is not responding. Make sure the backend is running, then try again.'

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new ApiError(serverUnavailable, 0) })
  // The API always answers in JSON, so anything else came from a proxy or static host in front of it.
  const result = await response.json().catch(() => null)
  if (!result) throw new ApiError(serverUnavailable, response.status)
  if (!response.ok) throw new ApiError(result.error || 'The request could not be completed.', response.status, result.remainingLockoutSeconds)
  return result as T
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const peopleIn = (registration: AdminRegistration) => registration.data.members.length + 1
const collegeKey = (college: string) => college.trim().toLowerCase()
const formatDate = (time: number | null) => time ? new Date(time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// A leading =, +, - or @ would run as a formula when the file is opened in a spreadsheet.
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

function downloadCsv(registrations: AdminRegistration[]) {
  const rows = [['Receipt', 'Team', 'Role', 'Name', 'Email', 'Phone', 'College', 'Status', 'Source']]
  for (const { receipt, data, reviewStatus, source } of registrations) {
    rows.push([receipt, data.teamName, 'Leader', data.leadName, data.email, data.phone, data.college, statusLabels[reviewStatus], source])
    for (const member of data.members) rows.push([receipt, data.teamName, 'Member', member.name, member.email, '', member.college, statusLabels[reviewStatus], source])
  }
  const url = URL.createObjectURL(new Blob([`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'kgrcet-hackathon-registrations.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Login({ onLogin, notice }: { onLogin: (session: Session) => void; notice: string }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [lockout, setLockout] = useState(0)

  useEffect(() => {
    if (lockout <= 0) return
    const timer = setTimeout(() => setLockout((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [lockout])

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    if (lockout > 0) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api<{ session: Session }>('login', 'POST', { identifier, email: identifier, password })
      onLogin(result.session)
    } catch (loginError) {
      setPassword('')
      setError(errorText(loginError, 'Could not sign in.'))
      if (loginError instanceof ApiError && loginError.remainingLockoutSeconds) setLockout(loginError.remainingLockoutSeconds)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login container">
      <div className="section-pill"><Sparkles size={12} /> ADMINISTRATIVE PORTAL // ORGANIZER CONSOLE</div>
      <h1>Sign in to <span>Console.</span></h1>
      <p className="admin-login-lede">Only for KGRCET Hackathon organizers.</p>
      <div className="admin-security">
        <span><ShieldCheck size={13} /> Constant-Time Auth</span>
      </div>

      {notice && !error && <p className="admin-notice" role="status">{notice}</p>}
      {lockout > 0 && (
        <div className="admin-lockout" role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>Security lockout activated</strong>
            <p>Too many failed attempts. Please wait {lockout} seconds before retrying.</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="admin-login-form">
        <div className="form-group">
          <label htmlFor="admin-identifier">Organizer username or email</label>
          <input
            id="admin-identifier"
            className="form-input"
            type="text"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            placeholder="e.g. jashanth or organizer email"
            value={identifier}
            onChange={(changeEvent) => setIdentifier(changeEvent.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="admin-password">Password</label>
          <div className="admin-password">
            <input
              id="admin-password"
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Enter password"
              autoComplete="current-password"
              value={password}
              onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && lockout <= 0 && <p className="admin-error" role="alert">{error}</p>}
        <button className="btn-primary-luxury is-wide" type="submit" disabled={submitting || lockout > 0}>
          <span>{submitting ? 'Verifying credentials...' : 'Sign in to Console'}</span>
          <ArrowRight size={16} />
        </button>
      </form>
    </main>
  )
}

/** The form behind both Spot Registration and Edit. Team size follows the people listed. */
function TeamForm({ initial, submitLabel, onSave, onCancel, formId }: {
  initial: TeamData
  submitLabel: string
  onSave: (data: TeamData) => Promise<void>
  onCancel?: () => void
  formId: string
}) {
  const [team, setTeam] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const teamField = (key: 'teamName' | 'college' | 'leadName' | 'email' | 'phone', label: string, type = 'text') => (
    <div className="form-group" key={key}>
      <label htmlFor={`${formId}-${key}`}>{label}</label>
      <input id={`${formId}-${key}`} className="form-input" type={type} required maxLength={200} autoComplete="off" value={team[key]} onChange={(changeEvent) => setTeam({ ...team, [key]: changeEvent.target.value })} />
    </div>
  )

  const updateMember = (index: number, key: keyof Member, value: string) =>
    setTeam({ ...team, members: team.members.map((member, memberIndex) => memberIndex === index ? { ...member, [key]: value } : member) })

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ ...team, teamSize: String(team.members.length + 1) })
    } catch (saveError) {
      setError(errorText(saveError, 'Could not save this team.'))
      setSaving(false)
    }
  }

  return (
    <form className="admin-panel" onSubmit={submit}>
      <div className="form-grid admin-form-grid">
        {teamField('teamName', 'Team name')}
        {teamField('college', 'College / institution')}
        {teamField('leadName', 'Team leader name')}
        {teamField('email', 'Leader email', 'email')}
        {teamField('phone', 'Leader phone', 'tel')}
      </div>

      {team.members.map((member, index) => (
        <fieldset className="admin-member" key={index}>
          <legend>Member {index + 2}</legend>
          <div className="form-grid admin-form-grid">
            {(['name', 'email', 'college'] as const).map((key) => (
              <div className="form-group" key={key}>
                <label htmlFor={`${formId}-member-${index}-${key}`}>{key === 'name' ? 'Full name' : key === 'email' ? 'Email' : 'College / institution'}</label>
                <input id={`${formId}-member-${index}-${key}`} className="form-input" type={key === 'email' ? 'email' : 'text'} required maxLength={200} autoComplete="off" value={member[key]} onChange={(changeEvent) => updateMember(index, key, changeEvent.target.value)} />
              </div>
            ))}
          </div>
          <button type="button" className="admin-text-button is-danger" onClick={() => setTeam({ ...team, members: team.members.filter((_, memberIndex) => memberIndex !== index) })}>
            <Trash2 size={14} /> Remove member {index + 2}
          </button>
        </fieldset>
      ))}

      <button type="button" className="admin-text-button admin-add-member" onClick={() => setTeam({ ...team, members: [...team.members, { name: '', email: '', college: team.college }] })}>
        <Plus size={14} /> Add another member
      </button>

      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-form-actions">
        <span>{team.members.length + 1} {team.members.length ? 'people' : 'person'} including the leader</span>
        {onCancel && <button type="button" className="btn-secondary-luxury" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary-luxury" disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
      </div>
    </form>
  )
}

function CountRow({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return <div className="admin-count-row"><span>{label}</span>{children}<b>{value}</b></div>
}

function Dashboard({ session, onSignOut, onExpired }: { session: Session; onSignOut: () => void; onExpired: () => void }) {
  const [tab, setTab] = useState<Tab>('registrations')
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [draftsInProgress, setDraftsInProgress] = useState(0)
  const [rules, setRules] = useState<Rules | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'website' | 'spot'>('all')
  const [collegeFilter, setCollegeFilter] = useState('all')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'team' | 'college'>('newest')
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminRegistration | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const editHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    api<{ registrations: AdminRegistration[]; draftsInProgress: number; rules: Rules }>('registrations').then((result) => {
      if (!active) return
      setRegistrations(result.registrations)
      setDraftsInProgress(result.draftsInProgress)
      setRules(result.rules)
    }).catch((loadError: unknown) => {
      if (!active) return
      if (loadError instanceof ApiError && loadError.status === 401) onExpired()
      else setError(errorText(loadError, 'Could not load registrations.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onExpired])

  const editingReceipt = editing?.receipt
  useEffect(() => {
    if (!editingReceipt) return
    editHeading.current?.focus({ preventScroll: true })
    editHeading.current?.scrollIntoView({ block: 'start' })
  }, [editingReceipt])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const replace = (updated: AdminRegistration) => setRegistrations((current) => current.map((item) => item.receipt === updated.receipt ? updated : item))
  const statusCount = (status: ReviewStatus) => registrations.filter((registration) => registration.reviewStatus === status).length
  const valid = useMemo(() => registrations.filter((registration) => registration.reviewStatus === 'valid'), [registrations])
  const validPeople = valid.reduce((sum, registration) => sum + peopleIn(registration), 0)

  const colleges = useMemo(() => {
    const names = new Map<string, string>()
    for (const { data } of registrations) if (!names.has(collegeKey(data.college))) names.set(collegeKey(data.college), data.college.trim())
    return [...names].map(([key, name]) => ({ key, name })).sort((left, right) => left.name.localeCompare(right.name))
  }, [registrations])

  // Teams are grouped by the leader's college, participants by each person's own college.
  const counts = useMemo(() => {
    const byCollege = new Map<string, { name: string; teams: number; participants: number }>()
    const entry = (college: string) => {
      const key = collegeKey(college)
      const existing = byCollege.get(key)
      if (existing) return existing
      const created = { name: college.trim(), teams: 0, participants: 0 }
      byCollege.set(key, created)
      return created
    }
    for (const { data } of valid) {
      const lead = entry(data.college)
      lead.teams += 1
      lead.participants += 1
      for (const member of data.members) entry(member.college).participants += 1
    }
    return [...byCollege.values()].sort((left, right) => right.participants - left.participants || left.name.localeCompare(right.name))
  }, [valid])

  const term = search.trim().toLowerCase()
  const visible = useMemo(() => {
    const filtered = registrations.filter(({ receipt, data, reviewStatus, source }) => term
      // Search looks through every registration, ignoring the dropdown filters.
      ? [receipt, data.teamName, data.leadName, data.email, data.phone, data.college, ...data.members.flatMap((member) => [member.name, member.email])].some((field) => field.toLowerCase().includes(term))
      : (statusFilter === 'all' || reviewStatus === statusFilter) &&
        (sourceFilter === 'all' || source === sourceFilter) &&
        (collegeFilter === 'all' || collegeKey(data.college) === collegeFilter))
    return filtered.sort((left, right) => {
      if (sort === 'team') return left.data.teamName.localeCompare(right.data.teamName)
      if (sort === 'college') return left.data.college.localeCompare(right.data.college)
      return sort === 'newest' ? (right.submittedAt || 0) - (left.submittedAt || 0) : (left.submittedAt || 0) - (right.submittedAt || 0)
    })
  }, [registrations, term, statusFilter, sourceFilter, collegeFilter, sort])

  async function setStatus(registration: AdminRegistration, status: ReviewStatus) {
    const { teamName } = registration.data
    if (!window.confirm(status === 'valid' ? `Mark ${teamName} (${registration.receipt}) as VALID?` : `Mark ${teamName} (${registration.receipt}) as INVALID?\n\nThe team is not notified automatically.`)) return
    setUpdating(registration.receipt)
    setError('')
    try {
      const result = await api<{ registration: AdminRegistration }>(`registrations/${registration.receipt}/status`, 'PUT', { status })
      replace(result.registration)
      setToast(`${teamName} marked ${statusLabels[status].toLowerCase()}.`)
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) onExpired()
      else setError(errorText(statusError, 'Could not update the registration.'))
    } finally {
      setUpdating(null)
    }
  }

  // Lets the form show the message, unless the session has ended and it must close.
  const saving = async (save: () => Promise<void>) => {
    try {
      await save()
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) onExpired()
      throw saveError
    }
  }

  const addSpotTeam = (data: TeamData) => saving(async () => {
    const result = await api<{ registration: AdminRegistration }>('registrations', 'POST', { data })
    setRegistrations((current) => [result.registration, ...current])
    setToast(`${data.teamName} registered. Receipt ${result.registration.receipt}.`)
    setTab('registrations')
  })

  const saveEdit = (data: TeamData) => saving(async () => {
    if (!editing) return
    const result = await api<{ registration: AdminRegistration }>(`registrations/${editing.receipt}`, 'PUT', { data, revision: editing.revision })
    replace(result.registration)
    setEditing(null)
    setToast(`${data.teamName} updated.`)
  })

  const tabs: { id: Tab; label: string }[] = [
    { id: 'registrations', label: `Registrations (${registrations.length})` },
    { id: 'spot', label: 'Spot Registration' },
    { id: 'counts', label: `Counts (${valid.length})` },
  ]

  return (
    <main className="admin container">
      {toast && <div className="admin-toast" role="status">{toast}</div>}

      <header className="admin-identity">
        <div>
          <div className="section-pill"><Sparkles size={12} /> ORGANIZER CONSOLE // KGRCET HACKATHON 2027</div>
          <h1>Organizer <span>Console</span></h1>
          <p>{session.name} <span aria-hidden="true">•</span> {session.email}</p>
        </div>
        <button type="button" className="btn-secondary-luxury" onClick={onSignOut}><LogOut size={14} /> Sign Out</button>
      </header>

      <section className="admin-stats" aria-label="Summary">
        <div>
          <span className="admin-stat-label">Total Registrations</span>
          <b>{registrations.length}</b>
          <span className="admin-chips">
            <span className="is-valid">{statusCount('valid')} Valid</span>
            <span className="is-pending">{statusCount('pending')} Pending</span>
            <span className="is-invalid">{statusCount('invalid')} Invalid</span>
          </span>
        </div>
        <div>
          <span className="admin-stat-label">Confirmed Participants</span>
          <b>{validPeople}</b>
          <span className="admin-stat-sub">From valid registrations</span>
        </div>
        <div>
          <span className="admin-stat-label">Drafts in Progress</span>
          <b>{draftsInProgress}</b>
          <span className="admin-stat-sub">Not yet submitted</span>
        </div>
        <div>
          <span className="admin-stat-label">Website Submissions</span>
          <b className="admin-stat-text">{rules?.submissionEnabled ? 'Open' : 'Closed'}</b>
          <span className="admin-stat-sub">
            {rules && rules.minTeamSize !== null && rules.maxTeamSize !== null ? `Teams of ${rules.minTeamSize} to ${rules.maxTeamSize}` : 'Team size limits not set'}
          </span>
        </div>
      </section>

      <nav className="admin-tabs" aria-label="Console sections">
        {tabs.map(({ id, label }) => (
          <button type="button" key={id} aria-current={tab === id && !editing ? 'page' : undefined} onClick={() => { setTab(id); setEditing(null) }}>{label}</button>
        ))}
      </nav>

      {error && <p className="admin-error" role="alert">{error}</p>}

      {editing ? (
        <section aria-label={`Edit ${editing.data.teamName}`}>
          <h2 className="admin-section-title" ref={editHeading} tabIndex={-1}>Edit {editing.data.teamName}</h2>
          <p className="admin-section-note">Receipt {editing.receipt}. Changes do not notify the team.</p>
          <TeamForm key={editing.receipt} formId="edit" initial={editing.data} submitLabel="Save changes" onSave={saveEdit} onCancel={() => setEditing(null)} />
        </section>
      ) : tab === 'spot' ? (
        <section aria-label="Spot registration">
          <h2 className="admin-section-title">Register a team on the spot</h2>
          <p className="admin-section-note">Spot teams are marked valid immediately and work even while website submissions are closed.</p>
          <TeamForm formId="spot" initial={blankTeam()} submitLabel="Register team" onSave={addSpotTeam} />
        </section>
      ) : tab === 'counts' ? (
        <section aria-label="Counts from valid registrations">
          <h2 className="admin-section-title">Valid registrations by college</h2>
          <p className="admin-section-note">Teams count under the leader's college. Participants count under their own college, so a team of 3 counts as 3.</p>
          <div className="admin-panel admin-counts">
            <div className="admin-count-row admin-count-head"><span>College</span><span>Teams</span><b>Participants</b></div>
            {counts.map((college) => <CountRow key={college.name} label={college.name} value={college.participants}><span>{college.teams}</span></CountRow>)}
            {!counts.length && <p className="admin-empty">No valid registrations yet.</p>}
            <CountRow label="Total" value={validPeople}><span>{valid.length}</span></CountRow>
          </div>
          <div className="admin-split">
            <div><span>Website teams</span><b>{valid.filter((registration) => registration.source === 'website').length}</b></div>
            <div><span>Spot teams</span><b>{valid.filter((registration) => registration.source === 'spot').length}</b></div>
          </div>
        </section>
      ) : (
        <section aria-label="Registrations">
          <div className="admin-toolbar">
            <label className="admin-search">
              <span>Search</span>
              <input className="form-input" type="search" value={search} onChange={(changeEvent) => setSearch(changeEvent.target.value)} placeholder="Receipt, team, name, email, phone, college…" />
            </label>
            <label>
              <span>Status</span>
              <select className="form-input" value={statusFilter} onChange={(changeEvent) => setStatusFilter(changeEvent.target.value as typeof statusFilter)}>
                <option value="all">All ({registrations.length})</option>
                <option value="pending">Pending ({statusCount('pending')})</option>
                <option value="valid">Valid ({statusCount('valid')})</option>
                <option value="invalid">Invalid ({statusCount('invalid')})</option>
              </select>
            </label>
            <label>
              <span>College</span>
              <select className="form-input" value={collegeFilter} onChange={(changeEvent) => setCollegeFilter(changeEvent.target.value)}>
                <option value="all">All colleges</option>
                {colleges.map(({ key, name }) => <option value={key} key={key}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>Source</span>
              <select className="form-input" value={sourceFilter} onChange={(changeEvent) => setSourceFilter(changeEvent.target.value as typeof sourceFilter)}>
                <option value="all">All sources</option>
                <option value="website">Website</option>
                <option value="spot">Spot</option>
              </select>
            </label>
            <label>
              <span>Sort by</span>
              <select className="form-input" value={sort} onChange={(changeEvent) => setSort(changeEvent.target.value as typeof sort)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="team">Team A–Z</option>
                <option value="college">College A–Z</option>
              </select>
            </label>
          </div>

          <div className="admin-result-line">
            <p role="status">
              {term ? `${visible.length} match${visible.length === 1 ? '' : 'es'} across all registrations (filters ignored while searching)` : `Showing ${visible.length} of ${registrations.length} registrations`}
            </p>
            <button type="button" className="btn-secondary-luxury" disabled={!visible.length} onClick={() => downloadCsv(visible)} title="Downloads the registrations shown below, one row per person">
              <Download size={14} /> Export CSV
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Team</th><th>Leader</th><th>College</th><th>Receipt</th><th>Status</th><th><span className="registration-sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {visible.map((registration) => {
                  const { receipt, data, reviewStatus, source } = registration
                  const open = openReceipt === receipt
                  return (
                    <tr key={receipt} className={`is-${reviewStatus}`}>
                      <td data-label="Team">
                        <button type="button" className="admin-team-toggle" aria-expanded={open} aria-label={`${data.teamName}, ${peopleIn(registration)} people. ${open ? 'Hide' : 'Show'} members`} onClick={() => setOpenReceipt(open ? null : receipt)}>
                          <strong>{data.teamName}</strong>
                          <ChevronDown size={14} />
                        </button>
                        <small>{peopleIn(registration)} {peopleIn(registration) === 1 ? 'person' : 'people'}</small>
                        {open && (
                          <ul className="admin-members">
                            {data.members.map((member) => <li key={member.email}><b>{member.name}</b><span>{member.email}</span><span>{member.college}</span></li>)}
                            {!data.members.length && <li><span>No additional members.</span></li>}
                          </ul>
                        )}
                      </td>
                      <td data-label="Leader">
                        <span>{data.leadName}</span>
                        <small>{data.email}</small>
                        <small>{data.phone}</small>
                      </td>
                      <td data-label="College">{data.college}</td>
                      <td data-label="Receipt">
                        <span className="admin-receipt">{receipt}</span>
                        {source === 'spot' && <b className="admin-spot">SPOT</b>}
                        <small>{formatDate(registration.submittedAt)}</small>
                      </td>
                      <td data-label="Status">
                        <span className={`admin-status is-${reviewStatus}`}>{statusLabels[reviewStatus]}</span>
                        {registration.reviewedBy && <small>by {registration.reviewedBy}</small>}
                      </td>
                      <td className="admin-actions">
                        {reviewStatus !== 'valid' && <button type="button" className="is-valid" disabled={updating === receipt} onClick={() => void setStatus(registration, 'valid')}>Mark valid</button>}
                        {reviewStatus !== 'invalid' && <button type="button" className="is-invalid" disabled={updating === receipt} onClick={() => void setStatus(registration, 'invalid')}>Mark invalid</button>}
                        <button type="button" disabled={updating === receipt} onClick={() => setEditing(registration)}><Pencil size={12} /> Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!visible.length && (
              <p className="admin-empty">
                {loading ? 'Loading registrations...' : registrations.length ? 'No registrations match the selected filters.' : 'No registrations yet. Submitted teams and spot registrations will appear here.'}
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkAttempt, setCheckAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setChecking(true)
    setCheckError('')
    api<{ session: Session | null }>('session').then((result) => {
      if (active) setSession(result.session)
    }).catch((sessionError: unknown) => {
      if (active) setCheckError(errorText(sessionError, 'Could not verify the admin session.'))
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [checkAttempt])

  // Keeps the address bar on the page actually shown.
  useEffect(() => {
    if (checking) return
    const path = session ? '/admin' : '/admin/login'
    if (window.location.pathname.replace(/\/+$/, '') !== path) window.history.replaceState(null, '', path)
  }, [session, checking])

  const onExpired = useMemo(() => () => {
    setSession(null)
    setNotice('Your session has ended. Please sign in again.')
  }, [])

  async function signOut() {
    try {
      await api('logout', 'POST', {})
      setNotice('')
      setSession(null)
    } catch (signOutError) {
      window.alert(errorText(signOutError, 'Could not sign out. Please try again.'))
    }
  }

  if (checking) return <main className="admin-login container"><p role="status">Verifying administrator session…</p></main>
  if (checkError) return (
    <main className="admin-login container">
      <p className="admin-error" role="alert">{checkError}</p>
      <button type="button" className="btn-secondary-luxury" onClick={() => setCheckAttempt((attempt) => attempt + 1)}>Try again</button>
    </main>
  )
  if (!session) return <Login notice={notice} onLogin={(next) => { setNotice(''); setSession(next) }} />
  return <Dashboard session={session} onSignOut={() => void signOut()} onExpired={onExpired} />
}
