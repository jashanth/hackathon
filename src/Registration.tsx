import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import { payment, upiLink } from './config/payment'
import { processScreenshotFile } from './image'
import './registration.css'

export type Member = {
  name: string
  email: string
  phone: string
  rollNumber: string
  gender: string
  year: string
  college: string
  collegeCode: string
  courseName: string
  foodPreference: string
}

export type Data = {
  teamName: string
  teamSize: string
  leadName: string
  email: string
  phone: string
  rollNumber: string
  gender: string
  year: string
  college: string
  collegeCode: string
  courseName: string
  foodPreference: string
  members: Member[]
}

type Draft = { data: Data; step: number; status: string; receipt: string | null; revision: number }
type Rules = { minTeamSize: number | null; maxTeamSize: number | null; feePerPerson: number; submissionEnabled: boolean }
type Reply = { draft: Draft; rules?: Rules; error?: string }

const steps = ['Team details', 'Members', 'Payment and Review']
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`

const teamSizeOptions = ['2', '3', '4'] as const
const genderOptions = ['Male', 'Female', 'Other'] as const
const yearOptions = ['1st Year', '2nd Year', '3rd Year', '4th Year'] as const
const foodOptions = ['VEG', 'NON VEG'] as const

const leaderFieldMeta = [
  { key: 'leadName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone number' },
  { key: 'rollNumber', label: 'Roll number' },
  { key: 'gender', label: 'Gender' },
  { key: 'year', label: 'Year' },
  { key: 'college', label: 'College name' },
  { key: 'collegeCode', label: 'College code' },
  { key: 'courseName', label: 'Course name' },
  { key: 'foodPreference', label: 'Food preference' },
] as const

const memberFieldMeta = [
  { key: 'name', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone number' },
  { key: 'rollNumber', label: 'Roll number' },
  { key: 'gender', label: 'Gender' },
  { key: 'year', label: 'Year' },
  { key: 'college', label: 'College name' },
  { key: 'collegeCode', label: 'College code' },
  { key: 'courseName', label: 'Course name' },
  { key: 'foodPreference', label: 'Food preference' },
] as const

function blankMember(): Member {
  return {
    name: '',
    email: '',
    phone: '',
    rollNumber: '',
    gender: '',
    year: '',
    college: '',
    collegeCode: '',
    courseName: '',
    foodPreference: '',
  }
}

function syncMembersForSize(data: Data): Member[] {
  const size = Number(data.teamSize)
  if (![2, 3, 4].includes(size)) return data.members || []
  const needed = size - 1
  const current = data.members || []
  const result: Member[] = []
  for (let i = 0; i < needed; i++) {
    result.push(current[i] ? { ...blankMember(), ...current[i] } : blankMember())
  }
  return result
}

async function request(method: string, body?: unknown, submit = false, signal?: AbortSignal): Promise<Reply> {
  const response = await fetch(`/api/registration${submit ? '/submit' : ''}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = (await response.json()) as Reply
  if (!response.ok) {
    throw Object.assign(new Error(
      response.status === 409
        ? 'The server draft changed, possibly in another tab. Retry will save your fields over the latest draft.'
        : result.error || `Request failed (${response.status}).`
    ), { status: response.status })
  }
  if (!result.draft || !Number.isInteger(result.draft.revision)) {
    throw new Error('The server returned an invalid draft.')
  }
  return result
}

function validate(data: Data, rules: Rules, members: boolean) {
  const errors: Record<string, string> = {}

  if (!data.teamName || !data.teamName.trim()) {
    errors.teamName = 'Team name is required.'
  } else if (data.teamName.length > 200) {
    errors.teamName = 'Use 200 characters or fewer.'
  }

  const size = Number(data.teamSize)
  if (!['2', '3', '4'].includes(data.teamSize)) {
    errors.teamSize = 'Please select a team size of 2, 3, or 4.'
  } else if (rules.minTeamSize !== null && size < rules.minTeamSize) {
    errors.teamSize = `The minimum team size is ${rules.minTeamSize}, including the leader.`
  } else if (rules.maxTeamSize !== null && size > rules.maxTeamSize) {
    errors.teamSize = `The maximum team size is ${rules.maxTeamSize}, including the leader.`
  }

  for (const { key, label } of leaderFieldMeta) {
    const val = data[key as keyof Data] as string
    if (!val || !val.trim()) {
      errors[key] = `${label} is required.`
    } else if (val.length > 200) {
      errors[key] = 'Use 200 characters or fewer.'
    }
  }

  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (data.phone && !/^\+?[1-9]\d{7,14}$/.test(data.phone.replace(/[\s().-]/g, ''))) {
    errors.phone = 'Enter a valid phone number.'
  }

  if (members) {
    if (data.members.length + 1 !== size) {
      errors.members = `Team size is ${data.teamSize}. Expected ${size - 1} additional ${size - 1 === 1 ? 'member' : 'members'}, but found ${data.members.length}.`
    }
    const emails = new Set([data.email.trim().toLowerCase()])
    const phones = new Set([data.phone.replace(/[\s().-]/g, '')])
    const rollNumbers = new Set([data.rollNumber.trim().toLowerCase()])

    data.members.forEach((member, index) => {
      for (const { key, label } of memberFieldMeta) {
        const val = member[key as keyof Member]
        if (!val || !val.trim()) {
          errors[`member-${index}-${key}`] = `${label} is required.`
        } else if (val.length > 200) {
          errors[`member-${index}-${key}`] = 'Use 200 characters or fewer.'
        }
      }

      const email = member.email ? member.email.trim().toLowerCase() : ''
      if (email) {
        if (!/^\S+@\S+\.\S+$/.test(member.email)) {
          errors[`member-${index}-email`] = 'Enter a valid email address.'
        } else if (emails.has(email)) {
          errors[`member-${index}-email`] = 'This email is already listed. Each participant must have a unique email.'
        }
        emails.add(email)
      }

      const phone = member.phone ? member.phone.replace(/[\s().-]/g, '') : ''
      if (phone) {
        if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
          errors[`member-${index}-phone`] = 'Enter a valid phone number.'
        } else if (phones.has(phone)) {
          errors[`member-${index}-phone`] = 'This phone number is already listed. Each participant must have a unique phone number.'
        }
        phones.add(phone)
      }

      const roll = member.rollNumber ? member.rollNumber.trim().toLowerCase() : ''
      if (roll) {
        if (rollNumbers.has(roll)) {
          errors[`member-${index}-rollNumber`] = 'This roll number is already listed. Each participant must have a unique roll number.'
        }
        rollNumbers.add(roll)
      }
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
  // Payment details stay on this page and are sent only with the final submission.
  const [utrNumber, setUtrNumber] = useState('')
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('')
  const [readingScreenshot, setReadingScreenshot] = useState(false)
  const [paymentQr, setPaymentQr] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const form = useRef<HTMLFormElement>(null)

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
    request('GET', undefined, false, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.rules) throw new Error('The server did not return registration rules.')
        const raw = result.draft.data || ({} as Partial<Data>)
        const loadedData: Data = {
          teamName: raw.teamName || '',
          teamSize: raw.teamSize || '',
          leadName: raw.leadName || '',
          email: raw.email || '',
          phone: raw.phone || '',
          rollNumber: raw.rollNumber || '',
          gender: raw.gender || '',
          year: raw.year || '',
          college: raw.college || '',
          collegeCode: raw.collegeCode || '',
          courseName: raw.courseName || '',
          foodPreference: raw.foodPreference || '',
          members: Array.isArray(raw.members)
            ? raw.members.map((m: Partial<Member>) => ({ ...blankMember(), ...m }))
            : [],
        }
        if (result.draft.step >= 1) {
          loadedData.members = syncMembersForSize(loadedData)
        }
        const loadedDraft: Draft = {
          ...result.draft,
          data: loadedData,
        }
        local.current = loadedDraft
        revision.current = loadedDraft.revision
        setDraft(loadedDraft)
        setRules(result.rules)
        setSaveStatus('Server draft loaded.')
        setLoading(false)
      })
      .catch((error: unknown) => {
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
    return () => {
      window.removeEventListener('beforeunload', warn)
      clearTimeout(timer.current)
    }
  }, [])

  // The QR carries this team's exact amount, so a new one is drawn whenever the amount or team name changes.
  const amountDue = rules && draft ? rules.feePerPerson * (draft.data.members.length + 1) : 0
  const payLink = draft && amountDue ? upiLink(amountDue, draft.data.teamName) : ''
  useEffect(() => {
    if (!payLink) return
    let active = true
    setPaymentQr('')
    QRCode.toDataURL(payLink, { width: 560, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setPaymentQr(url) })
      .catch(() => { if (active) setErrors((current) => ({ ...current, payment: 'The payment QR could not be created. Please contact the organizers.' })) })
    return () => { active = false }
  }, [payLink])

  async function chooseScreenshot(file: File | undefined) {
    const { screenshot: _, ...rest } = errors
    if (!file) {
      setScreenshotDataUrl('')
      setErrors(rest)
      return
    }
    setReadingScreenshot(true)
    try {
      const dataUrl = await processScreenshotFile(file)
      setScreenshotDataUrl(dataUrl)
      setErrors(rest)
    } catch (err) {
      setScreenshotDataUrl('')
      setErrors({ ...rest, screenshot: err instanceof Error ? err.message : 'The payment screenshot could not be read. Please choose it again.' })
    } finally {
      setReadingScreenshot(false)
    }
  }

  function checkPayment() {
    const found: Record<string, string> = {}
    if (!/^\d{12}$/.test(utrNumber)) found.utrNumber = 'Enter the 12-digit UTR number from your UPI app.'
    if (!screenshotDataUrl) found.screenshot = errors.screenshot || 'Upload the payment screenshot.'
    setErrors(found)
    if (Object.keys(found).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return false
    }
    return true
  }

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
    pending.current = operation().finally(() => {
      pending.current = null
    })
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
    else timer.current = setTimeout(() => void save(), 650)
  }

  function updateLeaderField(key: keyof Omit<Data, 'members'>, value: string) {
    if (!local.current) return
    change({
      ...local.current,
      data: {
        ...local.current.data,
        [key]: value,
      },
    })
  }

  function handleTeamSizeChange(newSize: string) {
    if (!local.current) return
    const nextData = {
      ...local.current.data,
      teamSize: newSize,
    }
    nextData.members = syncMembersForSize(nextData)
    change({
      ...local.current,
      data: nextData,
    })
  }

  function updateMember(index: number, key: keyof Member, value: string) {
    if (!local.current) return
    const members = local.current.data.members.map((item, i) =>
      i === index ? { ...item, [key]: value } : item
    )
    change({
      ...local.current,
      data: {
        ...local.current.data,
        members,
      },
    })
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
    let nextData = { ...local.current.data }
    if (step >= 1) {
      nextData.members = syncMembersForSize(nextData)
    }
    change({ ...local.current, data: nextData, step }, true)
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
        version.current += 1
        await save()
      }
    } catch (error) {
      paused.current = true
      setRemoteError(error instanceof Error ? error.message : 'Could not reconnect.')
      setSaveStatus('Server state could not be confirmed. Your fields remain on this page.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (locked.current || !local.current) return
    if (local.current.step < 2) {
      go(local.current.step + 1)
      return
    }
    if (!rules?.submissionEnabled || paused.current || !check(true) || !checkPayment()) return
    locked.current = true
    setBusy(true)
    if (!screenshotDataUrl) {
      setErrors({ screenshot: 'Upload the payment screenshot.' })
      locked.current = false
      setBusy(false)
      return
    }
    try {
      if (!(await save())) return
      setSaveStatus('Submitting to server...')
      const result = await request('POST', { revision: revision.current, utrNumber, screenshotDataUrl }, true)
      if (result.draft.status !== 'submitted' || !result.draft.receipt) {
        throw new Error('The server did not confirm submission. Retry to check its status.')
      }
      revision.current = result.draft.revision
      local.current = result.draft
      setDraft(result.draft)
      setSaveStatus('Submission confirmed by server.')
      requestAnimationFrame(() => heading.current?.focus())
    } catch (error) {
      // The server rejected the details (for example a UTR already used), so the team can correct them and submit again.
      if ((error as { status?: number }).status === 400) {
        setErrors({ payment: error instanceof Error ? error.message : 'The submission was rejected.' })
        setSaveStatus('Submission not accepted. Correct the details below and submit again.')
        requestAnimationFrame(() => heading.current?.focus())
        return
      }
      paused.current = true
      setRemoteError(error instanceof Error ? error.message : 'Submission could not be confirmed.')
      setSaveStatus('Submission not confirmed. Retry to check the server before submitting again.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  function field(
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    type = 'text',
    placeholder?: string,
    autoComplete = 'off',
    hint?: string
  ) {
    return (
      <div className="form-group" key={id}>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={id}
          className="form-input"
          type={type}
          value={value}
          required
          maxLength={200}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(errors[id])}
          aria-describedby={[hint ? `${id}-hint` : '', errors[id] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {hint && <small id={`${id}-hint`}>{hint}</small>}
        {errors[id] && <span id={`${id}-error`} className="registration-error">{errors[id]}</span>}
      </div>
    )
  }

  function selectField(
    id: string,
    label: string,
    value: string,
    options: readonly string[],
    onChange: (value: string) => void,
    placeholder = 'Select an option'
  ) {
    return (
      <div className="form-group" key={id}>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          name={id}
          className="form-input"
          value={value}
          required
          aria-invalid={Boolean(errors[id])}
          aria-describedby={errors[id] ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>{placeholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {errors[id] && <span id={`${id}-error`} className="registration-error">{errors[id]}</span>}
      </div>
    )
  }

  const data = draft?.data
  const submitted = draft?.status === 'submitted'

  return (
    <main className="registration container">
      <header className="registration-intro">
        <h1>Register your team</h1>
        <p>Start with your team. Add your people. Review together.</p>
      </header>

      {loading ? (
        <p role="status">Loading your server draft...</p>
      ) : loadError ? (
        <section className="registration-panel">
          <h2>We could not load your draft</h2>
          <p role="alert">{loadError}</p>
          <p>The form stays closed so an existing draft cannot be overwritten.</p>
          <button className="btn-primary-luxury" onClick={() => setLoadAttempt((n) => n + 1)}>
            Retry loading
          </button>
        </section>
      ) : (
        draft &&
        data &&
        rules && (
          <>
            <ol className="registration-steps" aria-label="Registration progress">
              {steps.map((label, index) => (
                <li key={label} aria-current={!submitted && draft.step === index ? 'step' : undefined}>
                  <span>{index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>

            <div className="registration-save">
              <p role="status" aria-live="polite">{saveStatus}</p>
              {remoteError && (
                <>
                  <p role="alert">{remoteError}</p>
                  <button type="button" className="btn-secondary-luxury" disabled={busy} onClick={() => void retry()}>
                    Retry connection and save my fields
                  </button>
                </>
              )}
            </div>

            {submitted ? (
              <section className="registration-panel">
                <h2 tabIndex={-1} ref={heading}>Payment under verification</h2>
                <p>Your registration for <strong>{data.teamName}</strong> is recorded. The organizers will check your payment against the UTR and screenshot you sent, then confirm your team.</p>
                <p>Save your receipt: <strong className="registration-receipt">{draft.receipt || 'Not provided by server'}</strong></p>
                <a href="/" className="btn-secondary-luxury">Back to overview</a>
              </section>
            ) : (
              <form ref={form} className="registration-panel" noValidate onSubmit={submit}>
                <h2 ref={heading} tabIndex={-1}>
                  {steps[draft.step]}
                </h2>
                <p className="registration-note">
                  {draft.step === 0
                    ? `All fields are required. The leader counts as one team member. The fee is ${rupees(rules.feePerPerson)} per person.`
                    : draft.step === 1
                    ? 'Fill in the details for the remaining team members. Your leader is already included.'
                    : 'Check every detail, pay the fee, then submit with your payment proof. A saved draft is not a registration.'}
                </p>

                {Object.keys(errors).length > 0 && (
                  <p role="alert" className="registration-error">
                    Please correct the highlighted details.
                    {draft.step === 2 && ' Use Edit to return to the relevant section.'}
                  </p>
                )}

                <fieldset className="registration-fields" disabled={busy}>
                  <legend className="registration-sr-only">{steps[draft.step]}</legend>

                  {draft.step === 0 && (
                    <div className="form-grid registration-grid">
                      {field('teamName', 'Team name', data.teamName, (val) => updateLeaderField('teamName', val), 'text', 'Enter team name')}
                      {selectField('teamSize', 'Team size', data.teamSize, teamSizeOptions, handleTeamSizeChange, 'Select team size')}

                      {field('leadName', 'Team Leader Full Name', data.leadName, (val) => updateLeaderField('leadName', val), 'text', 'Team leader full name', 'name')}
                      {field('email', 'Email', data.email, (val) => updateLeaderField('email', val), 'email', 'name@example.com', 'email')}     

                      {field('phone', 'Phone number', data.phone, (val) => updateLeaderField('phone', val), 'tel', 'Enter phone number', 'tel')}
                      {field('rollNumber', 'Roll number', data.rollNumber, (val) => updateLeaderField('rollNumber', val), 'text', 'Enter Your Roll number')}

                      {selectField('gender', 'Gender', data.gender, genderOptions, (val) => updateLeaderField('gender', val), 'Select gender')}
                      {selectField('year', 'Year', data.year, yearOptions, (val) => updateLeaderField('year', val), 'Select year')}

                      {field('college', 'College name', data.college, (val) => updateLeaderField('college', val), 'text', 'Full college name', 'organization')}
                      {field('collegeCode', 'College code', data.collegeCode, (val) => updateLeaderField('collegeCode', val), 'text', 'Enter college code')}

                      {field('courseName', 'Course name', data.courseName, (val) => updateLeaderField('courseName', val), 'text', 'Enter Your College Course Name', 'off', 'e.g. BTECH - CSE')}
                      {selectField('foodPreference', 'Food preference', data.foodPreference, foodOptions, (val) => updateLeaderField('foodPreference', val), 'Select food preference')}
                    </div>
                  )}

                  {draft.step === 1 && (
                    <div className="registration-members">
                      <div className="registration-leader">
                        <strong>{data.leadName} &bull; Team leader</strong>
                        <span>{data.email} &bull; {data.phone} &bull; Roll: {data.rollNumber}</span>
                        <span>{data.college} ({data.collegeCode}) &bull; {data.courseName} &bull; {data.year} &bull; Food: {data.foodPreference}</span>
                      </div>

                      <p id="members-hint">
                        Team size: {data.teamSize} &bull; 1 Team leader + {data.members.length} {data.members.length === 1 ? 'member' : 'members'}
                      </p>

                      {errors.members && <p id="members-error" role="alert" className="registration-error">{errors.members}</p>}

                      {data.members.map((member, index) => (
                        <fieldset className="registration-member" key={index}>
                          <legend>Member {index + 2}</legend>
                          <div className="form-grid registration-grid">
                            {field(`member-${index}-name`, 'Full name', member.name, (val) => updateMember(index, 'name', val), 'text', 'Member full name', 'name')}
                            {field(`member-${index}-email`, 'Email', member.email, (val) => updateMember(index, 'email', val), 'email', 'name@example.com', 'email')}

                            {field(`member-${index}-phone`, 'Phone number', member.phone, (val) => updateMember(index, 'phone', val), 'tel', 'Enter phone number', 'tel')}
                            {field(`member-${index}-rollNumber`, 'Roll number', member.rollNumber, (val) => updateMember(index, 'rollNumber', val), 'text', 'e.g. 21K91A0502')}

                            {selectField(`member-${index}-gender`, 'Gender', member.gender, genderOptions, (val) => updateMember(index, 'gender', val), 'Select gender')}
                            {selectField(`member-${index}-year`, 'Year', member.year, yearOptions, (val) => updateMember(index, 'year', val), 'Select year')}

                            {field(`member-${index}-college`, 'College name', member.college, (val) => updateMember(index, 'college', val), 'text', 'Full college name', 'organization')}
                            {field(`member-${index}-collegeCode`, 'College code', member.collegeCode, (val) => updateMember(index, 'collegeCode', val), 'text', 'e.g. KGRH')}

                            {field(`member-${index}-courseName`, 'Course name', member.courseName, (val) => updateMember(index, 'courseName', val), 'text', 'BTECH - CSE', 'off', 'e.g. BTECH - CSE')}
                            {selectField(`member-${index}-foodPreference`, 'Food preference', member.foodPreference, foodOptions, (val) => updateMember(index, 'foodPreference', val), 'Select food preference')}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  )}

                  {draft.step === 2 && (
                    <div className="registration-review">
                      <div className="registration-review-heading">
                        <h3>Team &amp; Leader</h3>
                        <button type="button" className="registration-text-button" onClick={() => go(0)}>
                          Edit team details
                        </button>
                      </div>
                      <dl>
                        <div><dt>Team name</dt><dd>{data.teamName}{errors.teamName && <span className="registration-error">{errors.teamName}</span>}</dd></div>
                        <div><dt>Team size</dt><dd>{data.teamSize}{errors.teamSize && <span className="registration-error">{errors.teamSize}</span>}</dd></div>
                        <div><dt>Leader full name</dt><dd>{data.leadName}{errors.leadName && <span className="registration-error">{errors.leadName}</span>}</dd></div>
                        <div><dt>Email</dt><dd>{data.email}{errors.email && <span className="registration-error">{errors.email}</span>}</dd></div>
                        <div><dt>Phone number</dt><dd>{data.phone}{errors.phone && <span className="registration-error">{errors.phone}</span>}</dd></div>
                        <div><dt>Roll number</dt><dd>{data.rollNumber}{errors.rollNumber && <span className="registration-error">{errors.rollNumber}</span>}</dd></div>
                        <div><dt>Gender</dt><dd>{data.gender}{errors.gender && <span className="registration-error">{errors.gender}</span>}</dd></div>
                        <div><dt>Year</dt><dd>{data.year}{errors.year && <span className="registration-error">{errors.year}</span>}</dd></div>
                        <div><dt>College name</dt><dd>{data.college}{errors.college && <span className="registration-error">{errors.college}</span>}</dd></div>
                        <div><dt>College code</dt><dd>{data.collegeCode}{errors.collegeCode && <span className="registration-error">{errors.collegeCode}</span>}</dd></div>
                        <div><dt>Course name</dt><dd>{data.courseName}{errors.courseName && <span className="registration-error">{errors.courseName}</span>}</dd></div>
                        <div><dt>Food preference</dt><dd>{data.foodPreference}{errors.foodPreference && <span className="registration-error">{errors.foodPreference}</span>}</dd></div>
                      </dl>

                      <div className="registration-review-heading">
                        <h3>Additional Members ({data.members.length})</h3>
                        <button type="button" className="registration-text-button" onClick={() => go(1)}>
                          Edit members
                        </button>
                      </div>
                      {errors.members && <p className="registration-error">{errors.members}</p>}
                      {!data.members.length && <p>No additional members. The leader is the only participant.</p>}
                      {data.members.map((member, index) => (
                        <section key={index} className="registration-review-member">
                          <h4>Member {index + 2}</h4>
                          <dl>
                            <div><dt>Full name</dt><dd>{member.name}{errors[`member-${index}-name`] && <span className="registration-error">{errors[`member-${index}-name`]}</span>}</dd></div>
                            <div><dt>Email</dt><dd>{member.email}{errors[`member-${index}-email`] && <span className="registration-error">{errors[`member-${index}-email`]}</span>}</dd></div>
                            <div><dt>Phone number</dt><dd>{member.phone}{errors[`member-${index}-phone`] && <span className="registration-error">{errors[`member-${index}-phone`]}</span>}</dd></div>
                            <div><dt>Roll number</dt><dd>{member.rollNumber}{errors[`member-${index}-rollNumber`] && <span className="registration-error">{errors[`member-${index}-rollNumber`]}</span>}</dd></div>
                            <div><dt>Gender</dt><dd>{member.gender}{errors[`member-${index}-gender`] && <span className="registration-error">{errors[`member-${index}-gender`]}</span>}</dd></div>
                            <div><dt>Year</dt><dd>{member.year}{errors[`member-${index}-year`] && <span className="registration-error">{errors[`member-${index}-year`]}</span>}</dd></div>
                            <div><dt>College name</dt><dd>{member.college}{errors[`member-${index}-college`] && <span className="registration-error">{errors[`member-${index}-college`]}</span>}</dd></div>
                            <div><dt>College code</dt><dd>{member.collegeCode}{errors[`member-${index}-collegeCode`] && <span className="registration-error">{errors[`member-${index}-collegeCode`]}</span>}</dd></div>
                            <div><dt>Course name</dt><dd>{member.courseName}{errors[`member-${index}-courseName`] && <span className="registration-error">{errors[`member-${index}-courseName`]}</span>}</dd></div>
                            <div><dt>Food preference</dt><dd>{member.foodPreference}{errors[`member-${index}-foodPreference`] && <span className="registration-error">{errors[`member-${index}-foodPreference`]}</span>}</dd></div>
                          </dl>
                        </section>
                      ))}

                      <section className="registration-payment" aria-labelledby="payment-title">
                        <div className="registration-review-heading">
                          <h3 id="payment-title">Payment</h3>
                        </div>
                        <div className="registration-payment-grid">
                          <figure className="registration-qr">
                            {paymentQr
                              ? <img src={paymentQr} alt={`UPI QR code to pay ${rupees(amountDue)} to ${payment.payeeName}`} width={560} height={560} />
                              : <span className="registration-qr-loading" role="status">Preparing your QR…</span>}
                            <figcaption>
                              <strong>{rupees(amountDue)}</strong>
                              <span>{payment.payeeName}</span>
                              <span className="registration-upi-id">{payment.payeeAddress}</span>
                            </figcaption>
                          </figure>
                          <div className="registration-payment-details">
                            <p className="registration-due">
                              <span>Amount to pay</span>
                              <strong>{rupees(rules.feePerPerson * (data.members.length + 1))}</strong>
                              <small>{rupees(rules.feePerPerson)} per person × {data.members.length + 1} people</small>
                            </p>
                            <ol className="registration-pay-steps">
                              <li>Scan the QR with any UPI app (PhonePe, Google Pay, Paytm). On a phone, tap <b>Pay with UPI app</b> instead.</li>
                              <li>The amount <b>{rupees(amountDue)}</b> is filled in for you. Pay exactly that amount; a different amount cannot be verified.</li>
                              <li>After paying, copy the 12-digit UTR and save a screenshot of the payment.</li>
                            </ol>
                            {payLink && <a className="btn-primary-luxury registration-pay-link" href={payLink}>Pay with UPI app</a>}
                            <table className="registration-fee-table">
                              <caption>Fee by team size</caption>
                              <tbody>
                                {teamSizeOptions.map((size) => (
                                  <tr key={size} aria-current={size === String(data.members.length + 1) ? 'true' : undefined}>
                                    <th scope="row">Team of {size}</th>
                                    <td>{rupees(rules.feePerPerson * Number(size))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="form-grid registration-grid">
                          <div className="form-group">
                            <label htmlFor="utrNumber">UTR / transaction reference number</label>
                            <input
                              id="utrNumber"
                              className="form-input"
                              inputMode="numeric"
                              autoComplete="off"
                              required
                              maxLength={12}
                              placeholder="12 digits, e.g. 412345678901"
                              value={utrNumber}
                              aria-invalid={Boolean(errors.utrNumber)}
                              aria-describedby={['utrNumber-hint', errors.utrNumber ? 'utrNumber-error' : ''].filter(Boolean).join(' ')}
                              onChange={(e) => {
                                setUtrNumber(e.target.value.replace(/\D/g, '').slice(0, 12))
                                const { utrNumber: _, ...rest } = errors
                                setErrors(rest)
                              }}
                            />
                            <small id="utrNumber-hint">Find it in your UPI app under the payment's details. It may be called UTR, UPI reference or transaction ID.</small>
                            {errors.utrNumber && <span id="utrNumber-error" className="registration-error">{errors.utrNumber}</span>}
                          </div>
                          <div className="form-group">
                            <label htmlFor="screenshot">Payment screenshot</label>
                            <input
                              id="screenshot"
                              className="form-input registration-file"
                              type="file"
                              accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
                              required
                              disabled={busy || readingScreenshot}
                              aria-invalid={Boolean(errors.screenshot)}
                              aria-describedby={['screenshot-hint', errors.screenshot ? 'screenshot-error' : ''].filter(Boolean).join(' ')}
                              onChange={(e) => void chooseScreenshot(e.target.files?.[0])}
                            />
                            <small id="screenshot-hint">PNG, JPEG or WebP, up to 2 MB. It must show the amount and the UTR.</small>
                            {readingScreenshot && <small className="registration-notice">Preparing screenshot...</small>}
                            {errors.screenshot && <span id="screenshot-error" className="registration-error">{errors.screenshot}</span>}
                            {screenshotDataUrl && <img className="registration-proof-preview" src={screenshotDataUrl} alt="Selected payment screenshot" />}
                          </div>
                        </div>
                        {errors.payment && <p role="alert" className="registration-error">{errors.payment}</p>}
                      </section>

                      {!rules.submissionEnabled && (
                        <p id="submission-notice" className="registration-notice">
                          Submissions are not open. You can save and edit your draft, but your team is not registered yet.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="registration-actions">
                    {draft.step > 0 && (
                      <button type="button" className="btn-secondary-luxury" onClick={() => go(draft.step - 1)}>
                        Back
                      </button>
                    )}
                    <button
                      type="submit"
                      className="btn-primary-luxury"
                      disabled={busy || readingScreenshot || (draft.step === 2 && (!rules.submissionEnabled || Boolean(remoteError)))}
                      aria-describedby={draft.step === 2 && !rules.submissionEnabled ? 'submission-notice' : undefined}
                    >
                      {busy
                        ? 'Please wait...'
                        : draft.step === 2
                        ? 'Submit registration'
                        : draft.step === 1
                        ? 'Continue to Payment and Review'
                        : 'Save & continue'}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}

            <p className="registration-privacy">
              Drafts are saved on the server using this browser's session cookie. Personal details are not stored in browser storage. Unsaved fields remain only on this page.
            </p>
          </>
        )
      )}
    </main>
  )
}
