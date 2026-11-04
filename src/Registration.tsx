import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { event } from './config/event'
import './registration.css'

type Member = { name: string; email: string; college: string }
type Data = { teamName: string; teamSize: string; college: string; leadName: string; email: string; phone: string; members: Member[] }
type Draft = { data: Data; step: number; status: string; receipt: string | null; revision: number }
type Rules = { minTeamSize: number | null; maxTeamSize: number | null; submissionEnabled: boolean }
type Reply = { draft: Draft; rules?: Rules; error?: string }
const steps = ['Team details', 'Members', 'Review']
const labels = { teamName: 'Team name', teamSize: 'Team size', college: 'College / institution', leadName: 'Team leader name', email: 'Leader email', phone: 'Leader phone' }

async function request(method: string, body?: unknown, submit = false, signal?: AbortSignal): Promise<Reply> {
  const response = await fetch(`/api/registration${submit ? '/submit' : ''}`, {
    method, credentials: 'same-origin', cache: 'no-store', signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json() as Reply
  if (!response.ok) throw new Error(response.status === 409
    ? 'The server draft changed, possibly in another tab. Retry will save your fields over the latest draft.'
    : result.error || `Request failed (${response.status}).`)
  if (!result.draft || !Number.isInteger(result.draft.revision)) throw new Error('The server returned an invalid draft.')
  return result
}

function validate(data: Data, rules: Rules, members: boolean) {
  const errors: Record<string, string> = {}
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    if (!data[key].trim()) errors[key] = `${labels[key]} is required.`
    else if (data[key].length > 200) errors[key] = 'Use 200 characters or fewer.'
  }
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) errors.email = 'Enter a valid email address.'
  if (data.phone && !/^\+?[1-9]\d{7,14}$/.test(data.phone.replace(/[\s().-]/g, ''))) errors.phone = 'Enter 8 to 15 digits, optionally starting with + and your country code.'
  const size = Number(data.teamSize)
  if (!/^\d+$/.test(data.teamSize) || !Number.isSafeInteger(size) || size < 1) errors.teamSize = 'Enter a whole number of at least 1, including the leader.'
  else if (rules.minTeamSize !== null && size < rules.minTeamSize) errors.teamSize = `The minimum team size is ${rules.minTeamSize}, including the leader.`
  else if (rules.maxTeamSize !== null && size > rules.maxTeamSize) errors.teamSize = `The maximum team size is ${rules.maxTeamSize}, including the leader.`
  if (members) {
    if (data.members.length + 1 !== size) errors.members = `Team size is ${data.teamSize}. Add or remove members so the total, including the leader, matches.`
    const emails = new Set([data.email.trim().toLowerCase()])
    data.members.forEach((member, index) => {
      for (const key of ['name', 'email', 'college'] as const) {
        if (!member[key].trim()) errors[`member-${index}-${key}`] = `${key === 'name' ? 'Name' : key === 'email' ? 'Email' : 'College'} is required.`
        else if (member[key].length > 200) errors[`member-${index}-${key}`] = 'Use 200 characters or fewer.'
      }
      const email = member.email.trim().toLowerCase()
      if (email && !/^\S+@\S+\.\S+$/.test(member.email)) errors[`member-${index}-email`] = 'Enter a valid email address.'
      else if (email && emails.has(email)) errors[`member-${index}-email`] = 'This person is already listed. The leader is counted automatically.'
      emails.add(email)
    })
  }
  return errors
}

export default function Registration() {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [remoteError, setRemoteError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loading server draft...')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const heading = useRef<HTMLHeadingElement>(null)
  const form = useRef<HTMLFormElement>(null)
  // These refs are the write queue's source of truth, including edits made during a request.
  const local = useRef<Draft | null>(null)
  const version = useRef(0)
  const savedVersion = useRef(0)
  const revision = useRef(0)
  const pending = useRef<Promise<boolean> | null>(null)
  const paused = useRef(false)
  const locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    request('GET', undefined, false, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.rules) throw new Error('The server did not return registration rules.')
      local.current = result.draft
      revision.current = result.draft.revision
      setDraft(result.draft)
      setRules(result.rules)
      setSaveStatus('Server draft loaded.')
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setLoadError(error instanceof Error ? error.message : 'Could not load the server draft.')
      setLoading(false)
    })
    return () => controller.abort()
  }, [loadAttempt])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (version.current !== savedVersion.current || pending.current || locked.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timer.current) }
  }, [])

  function save(): Promise<boolean> {
    clearTimeout(timer.current)
    if (pending.current) return pending.current
    if (paused.current || !local.current) return Promise.resolve(false)
    const operation = async () => {
      try {
        while (savedVersion.current !== version.current) {
          const snapshot = local.current!
          const snapshotVersion = version.current
          setSaveStatus('Saving to server...')
          const result = await request('PUT', { data: snapshot.data, step: snapshot.step, revision: revision.current })
          revision.current = result.draft.revision
          savedVersion.current = snapshotVersion
        }
        setSaveStatus('All changes saved to server.')
        return true
      } catch (error) {
        paused.current = true
        setRemoteError(error instanceof Error ? error.message : 'Could not save the draft.')
        setSaveStatus('Save not confirmed. Your fields remain on this page.')
        return false
      }
    }
    pending.current = operation().finally(() => { pending.current = null })
    return pending.current
  }

  function change(next: Draft, immediate = false) {
    local.current = next
    version.current += 1
    setDraft(next)
    setErrors({})
    setSaveStatus(paused.current ? 'Unsaved changes. Retry the server connection.' : 'Unsaved changes...')
    clearTimeout(timer.current)
    if (immediate) void save()
    else timer.current = setTimeout(() => { void save() }, 650)
  }

  function check(includeMembers: boolean) {
    const found = validate(local.current!.data, rules!, includeMembers)
    setErrors(found)
    if (Object.keys(found).length) {
      requestAnimationFrame(() => {
        const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        if (invalid) invalid.focus()
        else heading.current?.focus()
      })
      return false
    }
    return true
  }

  function go(step: number) {
    if (locked.current || !local.current) return
    if (step > local.current.step && !check(step === 2)) return
    change({ ...local.current, step }, true)
    requestAnimationFrame(() => heading.current?.focus())
  }

  async function retry() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setRemoteError('')
    setSaveStatus('Checking server state...')
    try {
      if (pending.current) await pending.current
      const result = await request('GET')
      if (!result.rules) throw new Error('The server did not return registration rules.')
      setRules(result.rules)
      revision.current = result.draft.revision
      if (result.draft.status === 'submitted') {
        local.current = result.draft
        setDraft(result.draft)
        savedVersion.current = version.current
        setSaveStatus('Submission confirmed by server.')
      } else {
        paused.current = false
        // A failed response may have followed a committed write. Rebase only after explicit retry.
        version.current += 1
        await save()
      }
    } catch (error) {
      paused.current = true
      setRemoteError(error instanceof Error ? error.message : 'Could not reconnect.')
      setSaveStatus('Server state could not be confirmed. Your fields remain on this page.')
    } finally { locked.current = false; setBusy(false) }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (locked.current || !local.current) return
    if (local.current.step < 2) { go(local.current.step + 1); return }
    if (!rules?.submissionEnabled || paused.current || !check(true)) return
    locked.current = true
    setBusy(true)
    try {
      if (!await save()) return
      setSaveStatus('Submitting to server...')
      const result = await request('POST', { revision: revision.current }, true)
      if (result.draft.status !== 'submitted' || !result.draft.receipt) throw new Error('The server did not confirm submission. Retry to check its status.')
      revision.current = result.draft.revision
      local.current = result.draft
      setDraft(result.draft)
      setSaveStatus('Submission confirmed by server.')
      requestAnimationFrame(() => heading.current?.focus())
    } catch (error) {
      paused.current = true
      setRemoteError(error instanceof Error ? error.message : 'Submission could not be confirmed.')
      setSaveStatus('Submission not confirmed. Retry to check the server before submitting again.')
    } finally { locked.current = false; setBusy(false) }
  }

  function field(id: string, label: string, value: string, onChange: (value: string) => void, type = 'text', hint?: string, autoComplete = 'off') {
    return <div className="form-group" key={id}>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} className="form-input" type={type} value={value} required maxLength={200}
        autoComplete={autoComplete} inputMode={id === 'teamSize' ? 'numeric' : undefined}
        aria-invalid={Boolean(errors[id])} aria-describedby={[hint ? `${id}-hint` : '', errors[id] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {errors[id] && <span id={`${id}-error`} className="registration-error">{errors[id]}</span>}
    </div>
  }

  const data = draft?.data
  const submitted = draft?.status === 'submitted'
  return <main className="registration container">
    <header className="registration-intro">
      <p className="registration-eyebrow">KGRCET HACKATHON 2027 / {event.dateDisplay}</p>
      <h1>Register your team</h1>
      <p>Start with your team. Add your people. Review together.</p>
    </header>
    {loading ? <p role="status">Loading your server draft...</p> : loadError ? <section className="registration-panel">
      <h2>We could not load your draft</h2><p role="alert">{loadError}</p>
      <p>The form stays closed so an existing draft cannot be overwritten.</p>
      <button className="btn-primary-luxury" onClick={() => setLoadAttempt((n) => n + 1)}>Retry loading</button>
    </section> : draft && data && rules && <>
      <ol className="registration-steps" aria-label="Registration progress">
        {steps.map((label, index) => <li key={label} aria-current={!submitted && draft.step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
      </ol>
      <div className="registration-save"><p role="status" aria-live="polite">{saveStatus}</p>
        {remoteError && <><p role="alert">{remoteError}</p><button type="button" className="btn-secondary-luxury" disabled={busy} onClick={() => void retry()}>Retry connection and save my fields</button></>}
      </div>
      {submitted ? <section className="registration-panel">
        <h2 tabIndex={-1} ref={heading}>Registration received</h2>
        <p>The server has confirmed your submission for <strong>{data.teamName}</strong>.</p>
        <p>Receipt: <strong className="registration-receipt">{draft.receipt || 'Not provided by server'}</strong></p>
        <a href="/" className="btn-secondary-luxury">Back to overview</a>
      </section> : <form ref={form} className="registration-panel" noValidate onSubmit={submit}>
        <h2 ref={heading} tabIndex={-1}> {steps[draft.step]}</h2>
        <p className="registration-note">{draft.step === 0 ? 'All fields are required. The leader counts as one team member.' : draft.step === 1 ? 'Only add the other members. Your leader is already included.' : 'Check every detail before submitting. A saved draft is not a registration.'}</p>
        {Object.keys(errors).length > 0 && <p role="alert" className="registration-error">Please correct the highlighted details.{draft.step === 2 && ' Use Edit to return to the relevant section.'}</p>}
        <fieldset className="registration-fields" disabled={busy}>
          <legend className="registration-sr-only">{steps[draft.step]}</legend>
          {draft.step === 0 && <div className="form-grid registration-grid">
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => field(key, labels[key], data[key], (value) => change({ ...local.current!, data: { ...local.current!.data, [key]: value } }), key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text', key === 'teamSize' ? `Include the leader. ${rules.minTeamSize !== null ? `Minimum: ${rules.minTeamSize}. ` : ''}${rules.maxTeamSize !== null ? `Maximum: ${rules.maxTeamSize}.` : 'No organizer maximum has been announced.'}` : undefined, key === 'leadName' ? 'name' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : key === 'college' ? 'organization' : 'off'))}
          </div>}
          {draft.step === 1 && <div className="registration-members">
            <div className="registration-leader"><strong>{data.leadName} / Team leader</strong><span>{data.email}</span><span>{data.college}</span></div>
            <p id="members-hint">{data.members.length + 1} people listed / {data.teamSize} planned</p>
            {errors.members && <p id="members-error" role="alert" className="registration-error">{errors.members}</p>}
            {data.members.map((member, index) => <fieldset className="registration-member" key={index}>
              <legend>Member {index + 2}</legend>
              <div className="form-grid registration-grid">{(['name', 'email', 'college'] as const).map((key) => field(`member-${index}-${key}`, key === 'name' ? 'Full name' : key === 'email' ? 'Email' : 'College / institution', member[key], (value) => change({ ...local.current!, data: { ...local.current!.data, members: local.current!.data.members.map((item, i) => i === index ? { ...item, [key]: value } : item) } }), key === 'email' ? 'email' : 'text'))}</div>
              <button type="button" className="registration-text-button" onClick={() => change({ ...draft, data: { ...data, members: data.members.filter((_, i) => i !== index) } })}>Remove member {index + 2}</button>
            </fieldset>)}
            <button type="button" className="btn-secondary-luxury" aria-describedby={errors.members ? 'members-error members-hint' : 'members-hint'} aria-invalid={Boolean(errors.members)} disabled={data.members.length >= 20}
              onClick={() => change({ ...draft, data: { ...data, members: [...data.members, { name: '', email: '', college: '' }] } })}>Add another member</button>
            {data.members.length >= 20 && <p className="registration-note">The service supports at most 20 additional members.</p>}
          </div>}
          {draft.step === 2 && <div className="registration-review">
            <div className="registration-review-heading"><h3>Team &amp; leader</h3><button type="button" className="registration-text-button" onClick={() => go(0)}>Edit team details</button></div>
            <dl>{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{data[key]}{errors[key] && <span className="registration-error">{errors[key]}</span>}</dd></div>)}</dl>
            <div className="registration-review-heading"><h3>Additional members ({data.members.length})</h3><button type="button" className="registration-text-button" onClick={() => go(1)}>Edit members</button></div>
            {errors.members && <p className="registration-error">{errors.members}</p>}
            {!data.members.length && <p>No additional members. The leader is the only participant.</p>}
            {data.members.map((member, index) => <section key={index} className="registration-review-member"><h4>Member {index + 2}</h4><dl>{(['name', 'email', 'college'] as const).map((key) => <div key={key}><dt>{key}</dt><dd>{member[key]}{errors[`member-${index}-${key}`] && <span className="registration-error">{errors[`member-${index}-${key}`]}</span>}</dd></div>)}</dl></section>)}
            {!rules.submissionEnabled && <p id="submission-notice" className="registration-notice">Submissions are not open. You can save and edit your draft, but your team is not registered yet.</p>}
          </div>}
          <div className="registration-actions">
            {draft.step > 0 && <button type="button" className="btn-secondary-luxury" onClick={() => go(draft.step - 1)}>Back</button>}
            <button type="submit" className="btn-primary-luxury" disabled={busy || (draft.step === 2 && (!rules.submissionEnabled || Boolean(remoteError)))} aria-describedby={draft.step === 2 && !rules.submissionEnabled ? 'submission-notice' : undefined}>{busy ? 'Please wait...' : draft.step === 2 ? 'Submit registration' : draft.step === 1 ? 'Save & review' : 'Save & continue'}</button>
          </div>
        </fieldset>
      </form>}
      <p className="registration-privacy">Drafts are saved on the server using this browser's session cookie. Personal details are not stored in browser storage. Unsaved fields remain only on this page.</p>
    </>}
  </main>
}
