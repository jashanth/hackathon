import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, ArrowRight, ChevronDown, Download, ExternalLink, Eye, EyeOff, ImageIcon, LogOut, Mail, Pencil, Plus, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import QRCode from 'qrcode'
import { payment as payee, upiLink } from './config/payment'
import { processScreenshotFile } from './image'
import './admin.css'

type Session = { email: string; name: string }
type Member = {
  name: string
  email: string
  phone?: string
  rollNumber?: string
  gender?: string
  year?: string
  college: string
  collegeCode?: string
  courseName?: string
  foodPreference?: string
}
type TeamData = {
  teamName: string
  teamSize: string
  leadName: string
  email: string
  phone: string
  rollNumber?: string
  gender?: string
  year?: string
  college: string
  collegeCode?: string
  courseName?: string
  foodPreference?: string
  members: Member[]
}
type ReviewStatus = 'pending' | 'valid' | 'invalid'
type PaymentMethod = 'upi' | 'cash'
type EmailStatus = 'pending' | 'sending' | 'sent' | 'partial' | 'failed'
type AdminRegistration = {
  receipt: string
  revision: number
  data: TeamData
  source: 'website' | 'spot'
  reviewStatus: ReviewStatus
  reviewedBy: string | null
  reviewedAt: number | null
  submittedAt: number | null
  paymentMethod: PaymentMethod
  utrNumber: string | null
  amount: number
  hasPaymentProof: boolean
  emailStatus?: EmailStatus | null
  emailSentCount?: number
  emailFailedCount?: number
  emailLastAttemptAt?: number | null
  emailLastError?: string | null
}
type Payment = { paymentMethod: PaymentMethod; utrNumber?: string; screenshotDataUrl?: string }
type Rules = { minTeamSize: number | null; maxTeamSize: number | null; feePerPerson: number; submissionEnabled: boolean }
type Tab = 'registrations' | 'spot' | 'counts'

const statusLabels: Record<ReviewStatus, string> = { pending: 'Pending', valid: 'Valid', invalid: 'Invalid' }
const methodLabels: Record<PaymentMethod, string> = { upi: 'UPI', cash: 'Cash' }
const choices: Record<string, readonly string[]> = {
  gender: ['Male', 'Female', 'Other'],
  year: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
  foodPreference: ['VEG', 'NON VEG'],
}
const blankTeam = (): TeamData => ({
  teamName: '',
  teamSize: '',
  leadName: '',
  email: '',
  phone: '',
  rollNumber: '',
  gender: '',
  year: '',
  college: '',
  collegeCode: '',
  courseName: '',
  foodPreference: '',
  // Teams have at least 2 people, so a new spot team starts with the leader and one member.
  members: [{ name: '', email: '', college: '' }],
})

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
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`
const sumOf = (list: AdminRegistration[]) => list.reduce((total, registration) => total + registration.amount, 0)
// The revision changes whenever an edit may have replaced the screenshot.
const proofUrl = ({ receipt, revision }: AdminRegistration) => `/api/admin/registrations/${receipt}/payment-proof?v=${revision}`

// A leading =, +, - or @ would run as a formula when the file is opened in a spreadsheet.
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

function downloadCsv(registrations: AdminRegistration[]) {
  const rows = [['Receipt', 'Team', 'Team Size', 'Role', 'Name', 'Email', 'Phone', 'Roll Number', 'Gender', 'Year', 'College', 'College Code', 'Course', 'Food Preference', 'Amount (INR)', 'Payment Method', 'UTR', 'Screenshot', 'Status', 'Email Status', 'Emails Sent', 'Emails Failed', 'Last Email Attempt', 'Reviewed By', 'Source', 'Submitted At']]
  for (const registration of registrations) {
    const { receipt, data, reviewStatus, source } = registration
    const person = (role: string, member: Member | TeamData, name: string) => [
      receipt, data.teamName, String(peopleIn(registration)), role, name, member.email, member.phone || '', member.rollNumber || '', member.gender || '',
      member.year || '', member.college, member.collegeCode || '', member.courseName || '', member.foodPreference || '',
    ]
    // Payment and email columns sit on the leader's row only, so summing the amount column gives the real total.
    rows.push([
      ...person('Leader', data, data.leadName),
      String(registration.amount), methodLabels[registration.paymentMethod], registration.utrNumber || '', registration.hasPaymentProof ? 'Yes' : 'No',
      statusLabels[reviewStatus],
      registration.emailStatus ? registration.emailStatus.toUpperCase() : (reviewStatus === 'valid' ? 'QUEUED' : 'NOT APPLICABLE'),
      String(registration.emailSentCount ?? 0),
      String(registration.emailFailedCount ?? 0),
      formatDate(registration.emailLastAttemptAt ?? null),
      registration.reviewedBy || '', source, registration.submittedAt ? new Date(registration.submittedAt).toISOString() : '',
    ])
    for (const member of data.members) rows.push([...person('Member', member, member.name), '', '', '', '', statusLabels[reviewStatus], '', '', '', '', '', source, ''])
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

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
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
      <p className="admin-login-lede">IP Based Login System</p>
      <div className="admin-security">
        <span><ShieldCheck size={13} /> Constant-Time Auth</span>
      </div>

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

/** One labelled input, or a select when the field has fixed choices. */
function Control({ id, label, value, onChange, type = 'text', required = false }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  const options = choices[id.split('-').pop() || '']
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select id={id} className="form-input" required={required} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)}>
          <option value="">Not recorded</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input id={id} className="form-input" type={type} required={required} maxLength={200} autoComplete="off" value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} />
      )}
    </div>
  )
}

const leaderFields: [keyof Omit<TeamData, 'members' | 'teamSize'>, string, string?][] = [
  ['teamName', 'Team name'], ['leadName', 'Team leader name'], ['email', 'Leader email', 'email'], ['phone', 'Leader phone', 'tel'],
  ['rollNumber', 'Roll number'], ['gender', 'Gender'], ['year', 'Year'], ['college', 'College / institution'],
  ['collegeCode', 'College code'], ['courseName', 'Course'], ['foodPreference', 'Food preference'],
]
const memberFields: [keyof Member, string, string?][] = [
  ['name', 'Full name'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['rollNumber', 'Roll number'], ['gender', 'Gender'],
  ['year', 'Year'], ['college', 'College / institution'], ['collegeCode', 'College code'], ['courseName', 'Course'], ['foodPreference', 'Food preference'],
]
const requiredLeader = new Set(['teamName', 'leadName', 'email', 'phone', 'college'])
const requiredMember = new Set(['name', 'email', 'college'])

/** The form behind both Spot Registration and Edit. Team size and fee follow the people listed. */
function TeamForm({ initial, initialPayment, feePerPerson, minPeople, maxPeople, showQr = false, submitLabel, onSave, onCancel, formId }: {
  initial: TeamData
  initialPayment?: AdminRegistration
  feePerPerson: number
  minPeople: number
  maxPeople: number
  showQr?: boolean
  submitLabel: string
  onSave: (data: TeamData, payment: Payment) => Promise<void>
  onCancel?: () => void
  formId: string
}) {
  const [team, setTeam] = useState(initial)
  const [method, setMethod] = useState<PaymentMethod>(initialPayment?.paymentMethod ?? 'upi')
  const [utrNumber, setUtrNumber] = useState(initialPayment?.utrNumber ?? '')
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const people = team.members.length + 1
  const [qr, setQr] = useState('')
  // The desk shows this to the team; it is redrawn when the team grows or is renamed.
  const payLink = showQr && method === 'upi' ? upiLink(feePerPerson * people, team.teamName || 'Spot registration') : ''

  useEffect(() => {
    if (!payLink) { setQr(''); return }
    let active = true
    QRCode.toDataURL(payLink, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQr(url) })
      .catch(() => { if (active) setError('The payment QR could not be created. Take the payment by cash or the printed QR.') })
    return () => { active = false }
  }, [payLink])

  // Most teams share one college, so members still blank or matching the leader follow the leader's college.
  const setLeader = (key: keyof TeamData, value: string) => {
    const follows = key === 'college' || key === 'collegeCode'
    const previous = (team[key] as string) || ''
    setTeam({
      ...team,
      [key]: value,
      members: follows ? team.members.map((member) => !member[key] || member[key] === previous ? { ...member, [key]: value } : member) : team.members,
    })
  }

  const updateMember = (index: number, key: keyof Member, value: string) =>
    setTeam({ ...team, members: team.members.map((member, memberIndex) => memberIndex === index ? { ...member, [key]: value } : member) })

  async function chooseScreenshot(file: File | undefined) {
    if (!file) {
      setScreenshotDataUrl(undefined)
      setError('')
      return
    }
    try {
      const dataUrl = await processScreenshotFile(file)
      setScreenshotDataUrl(dataUrl)
      setError('')
    } catch (err) {
      setScreenshotDataUrl(undefined)
      setError(err instanceof Error ? err.message : 'The screenshot could not be read. Please choose it again.')
    }
  }

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    if (people < minPeople || people > maxPeople) {
      setError(`A team must have ${minPeople} to ${maxPeople} people, including the leader.`)
      return
    }
    if (method === 'upi' && !/^\d{12}$/.test(utrNumber)) {
      setError('Enter the 12-digit UTR from the UPI payment.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ ...team, teamSize: String(people) }, method === 'cash' ? { paymentMethod: 'cash' } : { paymentMethod: 'upi', utrNumber, ...(screenshotDataUrl ? { screenshotDataUrl } : {}) })
    } catch (saveError) {
      setError(errorText(saveError, 'Could not save this team.'))
      setSaving(false)
    }
  }

  return (
    <form className="admin-panel" onSubmit={submit}>
      <div className="form-grid admin-form-grid">
        {leaderFields.map(([key, label, type]) => (
          <Control key={key} id={`${formId}-${key}`} label={label} type={type} required={requiredLeader.has(key)} value={(team[key] as string) || ''} onChange={(value) => setLeader(key, value)} />
        ))}
      </div>

      {team.members.map((member, index) => (
        <fieldset className="admin-member" key={index}>
          <legend>Member {index + 2}</legend>
          <div className="form-grid admin-form-grid">
            {memberFields.map(([key, label, type]) => (
              <Control key={key} id={`${formId}-member-${index}-${key}`} label={label} type={type} required={requiredMember.has(key)} value={member[key] || ''} onChange={(value) => updateMember(index, key, value)} />
            ))}
          </div>
          {people > minPeople && (
            <button type="button" className="admin-text-button is-danger" onClick={() => setTeam({ ...team, members: team.members.filter((_, memberIndex) => memberIndex !== index) })}>
              <Trash2 size={14} /> Remove member {index + 2}
            </button>
          )}
        </fieldset>
      ))}

      {people < maxPeople ? (
        <button type="button" className="admin-text-button admin-add-member" onClick={() => setTeam({ ...team, members: [...team.members, { name: '', email: '', college: team.college, collegeCode: team.collegeCode }] })}>
          <Plus size={14} /> Add another member
        </button>
      ) : (
        <p className="admin-section-note admin-add-member">Teams can have at most {maxPeople} people.</p>
      )}

      <fieldset className="admin-member admin-payment">
        <legend>Payment</legend>
        <p className="admin-payment-due"><span>Amount</span><b>{rupees(feePerPerson * people)}</b><small>{rupees(feePerPerson)} × {people} {people === 1 ? 'person' : 'people'}</small></p>
        {payLink && (
          <figure className="admin-qr">
            {qr ? <img src={qr} alt={`UPI QR code to pay ${rupees(feePerPerson * people)} to ${payee.payeeName}`} width={480} height={480} /> : <span role="status">Preparing QR…</span>}
            <figcaption>
              <strong>{rupees(feePerPerson * people)}</strong>
              <span>{payee.payeeName}</span>
              <span className="admin-qr-id">{payee.payeeAddress}</span>
            </figcaption>
          </figure>
        )}
        {payLink && <p className="admin-section-note">Ask the team to scan and pay, then enter the 12-digit UTR from their app. Add every member first: the amount follows the team size.</p>}
        <div className="form-grid admin-form-grid">
          <div className="form-group">
            <label htmlFor={`${formId}-method`}>Paid by</label>
            <select id={`${formId}-method`} className="form-input" value={method} onChange={(changeEvent) => setMethod(changeEvent.target.value as PaymentMethod)}>
              <option value="upi">UPI</option>
              <option value="cash">Cash at the desk</option>
            </select>
          </div>
          {method === 'upi' && (
            <div className="form-group">
              <label htmlFor={`${formId}-utr`}>UTR number</label>
              <input id={`${formId}-utr`} className="form-input" inputMode="numeric" required maxLength={12} autoComplete="off" placeholder="12 digits" value={utrNumber} onChange={(changeEvent) => setUtrNumber(changeEvent.target.value.replace(/\D/g, '').slice(0, 12))} />
            </div>
          )}
          {method === 'upi' && (
            <div className="form-group">
              <label htmlFor={`${formId}-screenshot`}>{initialPayment?.hasPaymentProof ? 'Replace screenshot (optional)' : 'Payment screenshot (optional)'}</label>
              <input id={`${formId}-screenshot`} className="form-input admin-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/*" onChange={(changeEvent) => void chooseScreenshot(changeEvent.target.files?.[0])} />
            </div>
          )}
          {method === 'upi' && (screenshotDataUrl || initialPayment?.hasPaymentProof) && (
            <figure className="admin-proof-thumb">
              <img src={screenshotDataUrl || proofUrl(initialPayment!)} alt={screenshotDataUrl ? 'New payment screenshot' : 'Current payment screenshot'} />
              <figcaption>{screenshotDataUrl ? 'New screenshot, saved when you save' : 'Current screenshot'}</figcaption>
            </figure>
          )}
        </div>
        {method === 'cash' && initialPayment?.hasPaymentProof && <p className="admin-section-note">Saving as cash removes the UPI screenshot and UTR from this registration.</p>}
      </fieldset>

      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-form-actions">
        <span>{people} {people === 1 ? 'person' : 'people'} including the leader · {rupees(feePerPerson * people)}</span>
        {onCancel && <button type="button" className="btn-secondary-luxury" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary-luxury" disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
      </div>
    </form>
  )
}

function CountRow({ label, value, children, className = '' }: { label: string; value: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`admin-count-row ${className}`}><span>{label}</span>{children}<b>{value}</b></div>
}

function Dashboard({ session, onSignOut, onUnauthorized }: { session: Session; onSignOut: () => void; onUnauthorized: () => void }) {
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
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all')
  const [sizeFilter, setSizeFilter] = useState('all')
  const [collegeFilter, setCollegeFilter] = useState('all')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'team' | 'college'>('newest')
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminRegistration | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [proofReceipt, setProofReceipt] = useState<string | null>(null)
  const [testEmailOpen, setTestEmailOpen] = useState(false)
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [sendingTestEmail, setSendingTestEmail] = useState(false)
  const editHeading = useRef<HTMLHeadingElement>(null)
  const proofDialog = useRef<HTMLDialogElement>(null)
  const testEmailDialog = useRef<HTMLDialogElement>(null)
  const fee = rules?.feePerPerson ?? 649
  // Same team sizes as the website form, unless the server sets its own limits.
  const minPeople = rules?.minTeamSize ?? 2
  const maxPeople = rules?.maxTeamSize ?? 4

  useEffect(() => {
    let active = true

    const fetchRegistrations = (silent = false) => {
      if (!silent) setLoading(true)
      return api<{ registrations: AdminRegistration[]; draftsInProgress: number; rules: Rules }>('registrations')
        .then((result) => {
          if (!active) return
          setRegistrations(result.registrations)
          setDraftsInProgress(result.draftsInProgress)
          setRules(result.rules)
        })
        .catch((loadError: unknown) => {
          if (!active) return
          if (loadError instanceof ApiError && loadError.status === 401) onUnauthorized()
          else if (!silent) setError(errorText(loadError, 'Could not load registrations.'))
        })
        .finally(() => {
          if (active && !silent) setLoading(false)
        })
    }

    // Initial load
    fetchRegistrations()

    // 1. Real-time Server-Sent Events (instant push notifications from VPS/backend)
    let sse: EventSource | null = null
    try {
      sse = new EventSource('/api/admin/registrations/stream', { withCredentials: true })
      sse.addEventListener('update', () => {
        if (active) fetchRegistrations(true)
      })
      sse.addEventListener('registration_submitted', () => {
        if (active) fetchRegistrations(true)
      })
      sse.addEventListener('registration_created', () => {
        if (active) fetchRegistrations(true)
      })
      sse.addEventListener('registration_updated', () => {
        if (active) fetchRegistrations(true)
      })
      sse.addEventListener('email_update', () => {
        if (active) fetchRegistrations(true)
      })
    } catch {
      // EventSource unsupported in browser/environment
    }

    // 2. Cross-tab BroadcastChannel (instant 1ms sync when testing in another tab)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel('kgrcet_hackathon')
      bc.onmessage = (event) => {
        if (event.data?.type === 'registration_updated' && active) {
          fetchRegistrations(true)
        }
      }
    } catch {
      // BroadcastChannel unsupported
    }

    // 3. Low-overhead background sync: poll only every 10s AND only when tab is actively visible
    const interval = setInterval(() => {
      if (active && document.visibilityState === 'visible') {
        fetchRegistrations(true)
      }
    }, 10000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active) {
        fetchRegistrations(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      if (sse) sse.close()
      if (bc) bc.close()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onUnauthorized])

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

  useEffect(() => {
    if (proofReceipt && !proofDialog.current?.open) proofDialog.current?.showModal()
  }, [proofReceipt])

  useEffect(() => {
    if (testEmailOpen) {
      if (!testEmailDialog.current?.open) testEmailDialog.current?.showModal()
    } else {
      if (testEmailDialog.current?.open) testEmailDialog.current?.close()
    }
  }, [testEmailOpen])

  const replace = (updated: AdminRegistration) => setRegistrations((current) => current.map((item) => item.receipt === updated.receipt ? updated : item))
  const statusCount = (status: ReviewStatus) => registrations.filter((registration) => registration.reviewStatus === status).length
  const valid = useMemo(() => registrations.filter((registration) => registration.reviewStatus === 'valid'), [registrations])
  const validPeople = valid.reduce((sum, registration) => sum + peopleIn(registration), 0)
  const received = sumOf(valid)
  const awaiting = sumOf(registrations.filter((registration) => registration.reviewStatus === 'pending'))
  const proofFor = registrations.find((registration) => registration.receipt === proofReceipt)

  const colleges = useMemo(() => {
    const names = new Map<string, string>()
    for (const { data } of registrations) if (!names.has(collegeKey(data.college))) names.set(collegeKey(data.college), data.college.trim())
    return [...names].map(([key, name]) => ({ key, name })).sort((left, right) => left.name.localeCompare(right.name))
  }, [registrations])
  const sizes = useMemo(() => [...new Set([2, 3, 4, ...registrations.map(peopleIn)])].sort((left, right) => left - right), [registrations])

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

  // Money from valid registrations by team size; 2, 3 and 4 always show, other sizes only from spot teams.
  const bySize = useMemo(() => sizes.map((size) => {
    const teams = valid.filter((registration) => peopleIn(registration) === size)
    return { size, teams: teams.length, people: teams.length * size, amount: sumOf(teams) }
  }).filter(({ size, teams }) => teams || size <= 4), [sizes, valid])
  const money = {
    website: sumOf(valid.filter((registration) => registration.source === 'website')),
    spot: sumOf(valid.filter((registration) => registration.source === 'spot')),
    cash: sumOf(valid.filter((registration) => registration.paymentMethod === 'cash')),
    cashTeams: valid.filter((registration) => registration.paymentMethod === 'cash').length,
  }

  const term = search.trim().toLowerCase()
  const visible = useMemo(() => {
    const filtered = registrations.filter((registration) => {
      const { receipt, data, reviewStatus, source, paymentMethod, utrNumber } = registration
      // Search looks through every registration, ignoring the dropdown filters.
      if (term) return [receipt, data.teamName, data.leadName, data.email, data.phone, data.college, utrNumber || '', ...data.members.flatMap((member) => [member.name, member.email])].some((field) => field.toLowerCase().includes(term))
      return (statusFilter === 'all' || reviewStatus === statusFilter) &&
        (sourceFilter === 'all' || source === sourceFilter) &&
        (methodFilter === 'all' || paymentMethod === methodFilter) &&
        (sizeFilter === 'all' || peopleIn(registration) === Number(sizeFilter)) &&
        (collegeFilter === 'all' || collegeKey(data.college) === collegeFilter)
    })
    return filtered.sort((left, right) => {
      if (sort === 'team') return left.data.teamName.localeCompare(right.data.teamName)
      if (sort === 'college') return left.data.college.localeCompare(right.data.college)
      return sort === 'newest' ? (right.submittedAt || 0) - (left.submittedAt || 0) : (left.submittedAt || 0) - (right.submittedAt || 0)
    })
  }, [registrations, term, statusFilter, sourceFilter, methodFilter, sizeFilter, collegeFilter, sort])

  async function setStatus(registration: AdminRegistration, status: ReviewStatus) {
    const { teamName } = registration.data
    const payment = registration.paymentMethod === 'cash' ? `${rupees(registration.amount)} in cash` : `${rupees(registration.amount)}, UTR ${registration.utrNumber}`
    const emailNotice = status === 'valid' ? `\n\nAutomated confirmation emails will be sent to all ${peopleIn(registration)} member(s).` : '\n\nThe team is not notified automatically.'
    if (!window.confirm(status === 'valid' ? `Mark ${teamName} (${registration.receipt}) as VALID?\n\nPayment: ${payment}${emailNotice}` : `Mark ${teamName} (${registration.receipt}) as INVALID?${emailNotice}`)) return
    setUpdating(registration.receipt)
    setError('')
    try {
      const result = await api<{ registration: AdminRegistration }>(`registrations/${registration.receipt}/status`, 'PUT', { status })
      replace(result.registration)
      setToast(status === 'valid' ? `${teamName} marked valid. Confirmation emails queued.` : `${teamName} marked invalid.`)
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) onUnauthorized()
      else setError(errorText(statusError, 'Could not update the registration.'))
    } finally {
      setUpdating(null)
    }
  }

  async function resendConfirmation(registration: AdminRegistration) {
    const { teamName } = registration.data
    const count = peopleIn(registration)
    if (!window.confirm(`Resend confirmation email to all ${count} member(s) of ${teamName} (${registration.receipt})?\n\nEach member will receive their personalized verified registration confirmation.`)) return
    setUpdating(registration.receipt)
    setError('')
    try {
      const result = await api<{ registration: AdminRegistration }>(`registrations/${registration.receipt}/resend-email`, 'POST', {})
      replace(result.registration)
      setToast(`Confirmation emails queued for ${teamName}.`)
    } catch (resendError) {
      if (resendError instanceof ApiError && resendError.status === 401) onUnauthorized()
      else setError(errorText(resendError, 'Could not resend confirmation email.'))
    } finally {
      setUpdating(null)
    }
  }

  async function handleSendTestEmail(e: FormEvent) {
    e.preventDefault()
    const target = testEmailAddr.trim()
    if (!target) return
    setSendingTestEmail(true)
    setError('')
    try {
      const res = await api<{ ok: boolean; dryRun?: boolean }>('test-email', 'POST', { email: target })
      setTestEmailOpen(false)
      if (res.dryRun) {
        setToast(`Test email simulated in dry-run mode (Brevo SMTP not configured in .env).`)
      } else {
        setToast(`Sample test email sent successfully to ${target}! Check your inbox.`)
      }
    } catch (sendErr) {
      setError(errorText(sendErr, 'Failed to send test email.'))
      setToast(errorText(sendErr, 'Failed to send test email.'))
    } finally {
      setSendingTestEmail(false)
    }
  }

  // Lets the form show the message, unless the session is unauthorized and must close.
  const saving = async (save: () => Promise<void>) => {
    try {
      await save()
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) onUnauthorized()
      throw saveError
    }
  }

  const addSpotTeam = (data: TeamData, payment: Payment) => saving(async () => {
    const result = await api<{ registration: AdminRegistration }>('registrations', 'POST', { data, ...payment })
    setRegistrations((current) => [result.registration, ...current])
    setToast(`${data.teamName} registered. Receipt ${result.registration.receipt}.`)
    setTab('registrations')
  })

  const saveEdit = (data: TeamData, payment: Payment) => saving(async () => {
    if (!editing) return
    const result = await api<{ registration: AdminRegistration }>(`registrations/${editing.receipt}`, 'PUT', { data, revision: editing.revision, ...payment })
    replace(result.registration)
    setEditing(null)
    setToast(`${data.teamName} updated.`)
  })

  const tabs: { id: Tab; label: string }[] = [
    { id: 'registrations', label: `Registrations (${registrations.length})` },
    { id: 'spot', label: 'Spot Registration' },
    { id: 'counts', label: `Counts & Collections (${valid.length})` },
  ]

  const statusActions = (registration: AdminRegistration) => (
    <>
      {registration.reviewStatus !== 'valid' && <button type="button" className="is-valid" disabled={updating === registration.receipt} onClick={() => void setStatus(registration, 'valid')}>Mark valid</button>}
      {registration.reviewStatus !== 'invalid' && <button type="button" className="is-invalid" disabled={updating === registration.receipt} onClick={() => void setStatus(registration, 'invalid')}>Mark invalid</button>}
      {registration.reviewStatus === 'valid' && (
        <button
          type="button"
          className="is-resend"
          disabled={updating === registration.receipt || registration.emailStatus === 'sending'}
          onClick={() => void resendConfirmation(registration)}
          title="Manually resend confirmation email to all team members"
        >
          <Mail size={12} /> Resend email
        </button>
      )}
    </>
  )

  return (
    <main className="admin container">
      {toast && <div className="admin-toast" role="status">{toast}</div>}

      <header className="admin-identity">
        <div>
          <div className="section-pill"><Sparkles size={12} /> ORGANIZER CONSOLE // KGRCET HACKATHON 2027</div>
          <h1>Organizer <span>Console</span></h1>
          <p>{session.name} <span aria-hidden="true">•</span> {session.email}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary-luxury"
            onClick={() => {
              setTestEmailAddr(session.email || '')
              setTestEmailOpen(true)
            }}
            title="Send sample test confirmation email"
          >
            <Mail size={14} /> Test Email
          </button>
          <button type="button" className="btn-secondary-luxury" onClick={onSignOut}><LogOut size={14} /> Sign Out</button>
        </div>
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
          <span className="admin-stat-label">Amount Received</span>
          <b>{rupees(received)}</b>
          <span className="admin-stat-sub">{rupees(awaiting)} awaiting verification</span>
        </div>
        <div>
          <span className="admin-stat-label">Website Submissions</span>
          <b className="admin-stat-text">{rules?.submissionEnabled ? 'Open' : 'Closed'}</b>
          <span className="admin-stat-sub">
            {rupees(fee)} per person · {draftsInProgress} {draftsInProgress === 1 ? 'draft' : 'drafts'} in progress
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
          <p className="admin-section-note">Receipt {editing.receipt}. Changes do not notify the team. The amount follows the team size.</p>
          <TeamForm key={editing.receipt} formId="edit" initial={editing.data} initialPayment={editing} feePerPerson={fee} minPeople={minPeople} maxPeople={maxPeople} submitLabel="Save changes" onSave={saveEdit} onCancel={() => setEditing(null)} />
        </section>
      ) : tab === 'spot' ? (
        <section aria-label="Spot registration">
          <h2 className="admin-section-title">Register a team on the spot</h2>
          <p className="admin-section-note">Spot teams are marked valid immediately and work even while website submissions are closed. Take cash, or a UPI payment with its UTR.</p>
          <TeamForm formId="spot" initial={blankTeam()} feePerPerson={fee} minPeople={minPeople} maxPeople={maxPeople} showQr submitLabel="Register team" onSave={addSpotTeam} />
        </section>
      ) : tab === 'counts' ? (
        <section aria-label="Counts and collections from valid registrations">
          <h2 className="admin-section-title">Collections</h2>
          <p className="admin-section-note">Money from valid registrations only, at {rupees(fee)} per person. Pending teams are not counted until you mark them valid.</p>
          <div className="admin-panel admin-counts">
            <div className="admin-count-row is-money admin-count-head"><span>Team size</span><span>Teams</span><span>People</span><b>Amount</b></div>
            {bySize.map(({ size, teams, people, amount }) => (
              <CountRow key={size} className="is-money" label={`Teams of ${size} · ${rupees(fee * size)} each`} value={rupees(amount)}><span>{teams}</span><span>{people}</span></CountRow>
            ))}
            <CountRow className="is-money" label="Total received" value={rupees(received)}><span>{valid.length}</span><span>{validPeople}</span></CountRow>
          </div>
          <div className="admin-split is-three">
            <div><span>Website</span><b>{rupees(money.website)}</b></div>
            <div><span>Spot</span><b>{rupees(money.spot)}</b></div>
            <div><span>Awaiting verification</span><b>{rupees(awaiting)}</b></div>
          </div>
          <div className="admin-split">
            <div><span>UPI ({valid.length - money.cashTeams})</span><b>{rupees(received - money.cash)}</b></div>
            <div><span>Cash ({money.cashTeams})</span><b>{rupees(money.cash)}</b></div>
          </div>

          <h2 className="admin-section-title admin-section-gap">Valid registrations by college</h2>
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
              <input className="form-input" type="search" value={search} onChange={(changeEvent) => setSearch(changeEvent.target.value)} placeholder="Receipt, team, name, email, phone, UTR, college…" />
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
              <span>Team size</span>
              <select className="form-input" value={sizeFilter} onChange={(changeEvent) => setSizeFilter(changeEvent.target.value)}>
                <option value="all">All sizes</option>
                {sizes.map((size) => <option value={size} key={size}>{size} people ({registrations.filter((registration) => peopleIn(registration) === size).length})</option>)}
              </select>
            </label>
            <label>
              <span>Payment</span>
              <select className="form-input" value={methodFilter} onChange={(changeEvent) => setMethodFilter(changeEvent.target.value as typeof methodFilter)}>
                <option value="all">UPI and cash</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
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
              {term ? `${visible.length} match${visible.length === 1 ? '' : 'es'} across all registrations (filters ignored while searching)` : `Showing ${visible.length} of ${registrations.length} registrations`} · {rupees(sumOf(visible))}
            </p>
            <button type="button" className="btn-secondary-luxury" disabled={!visible.length} onClick={() => downloadCsv(visible)} title="Downloads the registrations shown below, one row per person, with payment details on each leader's row">
              <Download size={14} /> Export CSV
            </button>
          </div>

          <div className="admin-table-wrap">
            {visible.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr><th>Team</th><th>Leader</th><th>College</th><th>Payment</th><th>Receipt</th><th>Status</th><th>Email</th><th><span className="registration-sr-only">Actions</span></th></tr>
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
                              {data.members.map((member, index) => <li key={index}><b>{member.name}</b><span>{member.email}{member.phone ? ` · ${member.phone}` : ''}</span><span>{[member.college, member.year, member.courseName].filter(Boolean).join(' · ')}</span></li>)}
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
                        <td data-label="Payment">
                          <span className="admin-amount">{rupees(registration.amount)}</span>
                          <small><b className="admin-method">{methodLabels[registration.paymentMethod]}</b>{registration.utrNumber && <span className="admin-receipt"> {registration.utrNumber}</span>}</small>
                          {registration.hasPaymentProof && (
                            <button type="button" className="admin-proof-link" onClick={() => setProofReceipt(receipt)}><ImageIcon size={13} /> View proof</button>
                          )}
                        </td>
                        <td data-label="Receipt">
                          <span className="admin-receipt">{receipt}</span>
                          {source === 'spot' && <b className="admin-spot">SPOT</b>}
                          <small>{formatDate(registration.submittedAt)}</small>
                        </td>
                        <td data-label="Status">
                          <span className={`admin-status is-${reviewStatus}`}>{statusLabels[reviewStatus]}</span>
                          {registration.reviewedBy && <small>by {registration.reviewedBy}</small>}
                        </td>
                        <td data-label="Email">
                          {reviewStatus === 'valid' ? (
                            <div className="admin-email-col">
                              <span className={`admin-email-badge is-${registration.emailStatus || 'pending'}`}>
                                {registration.emailStatus === 'sent' && 'Sent'}
                                {registration.emailStatus === 'sending' && 'Sending...'}
                                {registration.emailStatus === 'pending' && 'Queued'}
                                {registration.emailStatus === 'partial' && 'Partial'}
                                {registration.emailStatus === 'failed' && 'Failed'}
                                {!registration.emailStatus && 'Queued'}
                              </span>
                              <small>
                                {registration.emailSentCount ?? 0}/{peopleIn(registration)} sent
                                {(registration.emailFailedCount ?? 0) > 0 && <span className="admin-email-err"> ({registration.emailFailedCount} failed)</span>}
                              </small>
                              {registration.emailLastAttemptAt ? (
                                <small className="admin-email-time" title={registration.emailLastError || undefined}>
                                  {formatDate(registration.emailLastAttemptAt)}
                                </small>
                              ) : null}
                            </div>
                          ) : (
                            <span className="admin-email-dash">—</span>
                          )}
                        </td>
                        <td className="admin-actions">
                          {statusActions(registration)}
                          <button type="button" disabled={updating === receipt} onClick={() => setEditing(registration)}><Pencil size={12} /> Edit</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p className="admin-empty">
                {loading ? 'Loading registrations...' : registrations.length ? 'No registrations match the selected filters.' : 'No registrations yet. Submitted teams and spot registrations will appear here.'}
              </p>
            )}
          </div>
        </section>
      )}

      <dialog ref={testEmailDialog} className="admin-proof" style={{ maxWidth: '520px' }} aria-labelledby="test-email-title" onClose={() => setTestEmailOpen(false)}>
        <header>
          <div>
            <span className="admin-stat-label">Transactional Email Preview</span>
            <h2 id="test-email-title" style={{ fontSize: '24px' }}>Send Test Email</h2>
          </div>
          <button type="button" className="admin-proof-close" aria-label="Close" onClick={() => setTestEmailOpen(false)}><X size={18} /></button>
        </header>
        <form onSubmit={handleSendTestEmail} style={{ padding: '24px clamp(20px, 3vw, 32px)' }}>
          <p className="admin-section-note" style={{ margin: '0 0 16px' }}>
            Enter your email to receive a live sample verification email and inspect its formatting in your actual inbox.
          </p>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label htmlFor="test-email-addr">Recipient Email Address</label>
            <input
              id="test-email-addr"
              className="form-input"
              type="email"
              required
              autoFocus
              placeholder="e.g. yourname@example.com"
              value={testEmailAddr}
              onChange={(e) => setTestEmailAddr(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn-secondary-luxury" onClick={() => setTestEmailOpen(false)} disabled={sendingTestEmail}>Cancel</button>
            <button type="submit" className="btn-primary-luxury" disabled={sendingTestEmail || !testEmailAddr.trim()}>
              <span>{sendingTestEmail ? 'Sending...' : 'Send Test Email'}</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={proofDialog} className="admin-proof" aria-labelledby="proof-title" onClose={() => setProofReceipt(null)}>
        {proofFor && (
          <>
            <header>
              <div>
                <span className="admin-stat-label">Payment proof · {proofFor.receipt}</span>
                <h2 id="proof-title">{proofFor.data.teamName}</h2>
              </div>
              <button type="button" className="admin-proof-close" aria-label="Close" onClick={() => proofDialog.current?.close()}><X size={18} /></button>
            </header>
            <div className="admin-proof-body">
              <a href={proofUrl(proofFor)} target="_blank" rel="noreferrer" title="Open full size in a new tab">
                <img src={proofUrl(proofFor)} alt={`Payment screenshot from ${proofFor.data.teamName}`} />
              </a>
              <div>
                <dl>
                  <div><dt>Amount due</dt><dd>{rupees(proofFor.amount)} <small>({peopleIn(proofFor)} × {rupees(fee)})</small></dd></div>
                  <div><dt>UTR entered</dt><dd className="admin-receipt">{proofFor.utrNumber || '—'}</dd></div>
                  <div><dt>Leader</dt><dd>{proofFor.data.leadName}<small>{proofFor.data.phone}</small></dd></div>
                  <div><dt>Status</dt><dd><span className={`admin-status is-${proofFor.reviewStatus}`}>{statusLabels[proofFor.reviewStatus]}</span></dd></div>
                </dl>
                <p className="admin-section-note">Check that the screenshot shows {rupees(proofFor.amount)} and the same UTR, and that the payment reached the account.</p>
                <div className="admin-actions admin-proof-actions">
                  {statusActions(proofFor)}
                  <a href={proofUrl(proofFor)} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Full size</a>
                </div>
              </div>
            </div>
          </>
        )}
      </dialog>
    </main>
  )
}

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState('')
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

  const onUnauthorized = () => {
    setSession(null)
  }

  async function signOut() {
    try {
      await api('logout', 'POST', {})
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
  if (!session) return <Login onLogin={(next) => setSession(next)} />
  return <Dashboard session={session} onSignOut={() => void signOut()} onUnauthorized={onUnauthorized} />
}
