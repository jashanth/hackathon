import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Calendar,
  Check,
  Clock,
  Coffee,
  Cpu,
  Gamepad2,
  Gift,
  Globe,
  Lock,
  Menu,
  Moon,
  Package,
  Shield,
  Sparkles,
  Sun,
  Terminal,
  Trophy,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import {
  event,
  eventInfoDetails,
  keyStats,
  navigation,
  organizerGroups,
  perksList,
  prizes,
  timelineMilestones,
  tracks,
} from './config/event'
import './styles.css'
import Registration from './Registration'
import collegeLogo from '../assets/kgrcet-logo.png'

interface CountdownState {
  days: number
  hours: number
  minutes: number
  seconds: number
  status: 'upcoming' | 'in-progress' | 'complete'
}

function calculateTimeLeft(startDateStr: string, endDateStr: string): CountdownState {
  const start = new Date(startDateStr).getTime()
  const end = new Date(endDateStr).getTime()
  const now = new Date().getTime()
  if (now >= end) return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'complete' }
  if (now >= start) return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'in-progress' }

  const difference = start - now

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
    status: 'upcoming',
  }
}

function App() {
  const isRegistration = window.location.pathname.replace(/\/+$/, '') === '/register'
  const [menuOpen, setMenuOpen] = useState(false)

  // Default theme is light on every device; preserve user manual choice
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      let saved: string | null = null
      try { saved = localStorage.getItem('kgrcet-theme') } catch { /* Theme preference is optional. */ }
      if (saved === 'light' || saved === 'dark') return saved
      const docTheme = document.documentElement.dataset.theme as 'light' | 'dark' | undefined
      if (docTheme === 'light' || docTheme === 'dark') return docTheme
    }
    return 'light'
  })

  // Live Countdown State
  const [timeLeft, setTimeLeft] = useState<CountdownState>(() => calculateTimeLeft(event.startDate, event.endDate))

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(event.startDate, event.endDate))
    }, 1000)
    return () => clearInterval(timer)
  }, [])


  // Apply theme to document
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (menuOpen) {
      document.body.classList.add('modal-open')
    } else {
      document.body.classList.remove('modal-open')
    }
    return () => document.body.classList.remove('modal-open')
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('kgrcet-theme', nextTheme) } catch { /* Theme preference is optional. */ }
    document.documentElement.dataset.theme = nextTheme
    setTheme(nextTheme)
  }

  return (
    <div className="site-shell">
      <div className="ambient-glow-top" aria-hidden="true" />
      <div className="ambient-glow-side" aria-hidden="true" />
      <div className="ambient-glow-bottom" aria-hidden="true" />
      <div className="grid-overlay" aria-hidden="true" />

      {/* =================================================================
          HEADER & SUBSTANTIAL COLLEGE IDENTITY
          ================================================================= */}
      <header className="site-header">
        <div className="container header-inner">
          <a href={isRegistration ? '/' : '#top'} className="brand-link" aria-label="KG Reddy College of Engineering and Technology - KGRCET Hackathon 2027">
            <img
              className="brand-college-logo"
              src={collegeLogo}
              alt="KG Reddy College of Engineering and Technology"
            />
            <div className="brand-titles">
              <span className="brand-name">
                KGRCET <span className="brand-year">HACKATHON 2027</span>
              </span>
              <span className="brand-sub">36-HOUR NATIONAL HACKATHON</span>
            </div>
          </a>

          {!isRegistration && <nav className="desktop-nav" aria-label="Primary Desktop Navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>}

          <div className="header-right">
            {isRegistration && <a href="/" className="back-to-overview">Back to Overview</a>}
            <button
              onClick={toggleTheme}
              className="theme-toggle-btn"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {!isRegistration && <>
            <a href="/register" className="btn-header-register">
              <span>Start Team Draft</span>
              <Sparkles size={14} />
            </a>

            <button
              className="mobile-menu-trigger"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            </>}
          </div>
        </div>
      </header>

      {/* Mobile Sliding Drawer */}
      <AnimatePresence>
        {!isRegistration && menuOpen && (
          <motion.div
            className="mobile-nav-drawer"
            id="mobile-navigation"
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mobile-nav-links">
              {navigation.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="mobile-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  <span>{item.label}</span>
                  <ArrowRight size={16} />
                </a>
              ))}
            </div>
            <div className="mobile-drawer-footer">
              <a
                href="/register"
                className="btn-primary-luxury"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <span>Start a Team Draft</span>
                <Sparkles size={15} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isRegistration ? <Registration /> : <main id="top">
        {/* =================================================================
            HERO SECTION
            ================================================================= */}
        <section className="hero-section">
          <div className="container hero-content">
            {/* Main Grand Landing Titles */}
            <h1 className="hero-title-main">
              <span>KGRCET'S</span>
              <span className="hero-title-gradient">HACKATHON</span>
              <span>2027</span>
            </h1>

            {/* Refined Hackathon Tagline with Balanced Stars */}
            <div className="hero-subtitle-tagline">
              <span className="hero-star" aria-hidden="true">✦</span>
              <span>A 36-HOUR NATIONAL LEVEL HACKATHON</span>
              <span className="hero-star" aria-hidden="true">✦</span>
            </div>

            {/* Action Buttons */}
            <div className="hero-cta-group">
              <a href="/register" className="btn-primary-luxury">
                <span>Start a Team Draft</span>
                <ArrowRight size={16} />
              </a>

              <a href="#tracks" className="btn-secondary-luxury">
                <span>Explore 10 Challenge Tracks</span>
                <ArrowUpRight size={16} />
              </a>
            </div>

            {/* Precision Countdown Interface */}
            <div className="countdown-box-wrapper">
              <div className="countdown-header">
                <span className="countdown-label">
                  <Clock size={13} style={{ color: 'var(--violet)', flexShrink: 0 }} />
                  EVENT COMMENCEMENT COUNTDOWN
                </span>
                <span className="countdown-date-badge">
                  <Calendar size={11} style={{ display: 'inline', marginRight: 4 }} />
                  {event.dateDisplay}
                </span>
              </div>

              {timeLeft.status === 'upcoming' ? <div className="countdown-digits-grid">
                <div className="countdown-unit">
                  <span className="countdown-number">{String(timeLeft.days).padStart(2, '0')}</span>
                  <span className="countdown-text">DAYS</span>
                </div>
                <div className="countdown-unit">
                  <span className="countdown-number">{String(timeLeft.hours).padStart(2, '0')}</span>
                  <span className="countdown-text">HOURS</span>
                </div>
                <div className="countdown-unit">
                  <span className="countdown-number">{String(timeLeft.minutes).padStart(2, '0')}</span>
                  <span className="countdown-text">MINUTES</span>
                </div>
                <div className="countdown-unit">
                  <span className="countdown-number">{String(timeLeft.seconds).padStart(2, '0')}</span>
                  <span className="countdown-text">SECONDS</span>
                </div>
              </div> : <p className="countdown-status" role="status">
                {timeLeft.status === 'in-progress' ? 'Event in progress' : 'Event completed'}
              </p>}
            </div>
          </div>
        </section>

        {/* Full-Bleed Marquee */}
        <div
          className="hero-marquee"
          aria-label="Organized by KG Reddy College of Engineering and Technology in collaboration with the Cybersecurity and Ethical Hacking Club. 36 hours of non-stop engineering to pioneer breakthroughs in Generative AI, Cyber Defense, and Autonomous Systems."
        >
          <div className="marquee-track">
            <div className="marquee-copy">
              <span>
                Organized by <strong>KG Reddy College of Engineering &amp; Technology</strong> in collaboration with the <strong>Cybersecurity &amp; Ethical Hacking Club</strong>. 36 hours of non-stop engineering to pioneer breakthroughs in Generative AI, Cyber Defense, and Autonomous Systems.
              </span>
              <span className="marquee-separator" aria-hidden="true">◆</span>
            </div>
            <div className="marquee-copy" aria-hidden="true">
              <span>
                Organized by <strong>KG Reddy College of Engineering &amp; Technology</strong> in collaboration with the <strong>Cybersecurity &amp; Ethical Hacking Club</strong>. 36 hours of non-stop engineering to pioneer breakthroughs in Generative AI, Cyber Defense, and Autonomous Systems.
              </span>
              <span className="marquee-separator">◆</span>
            </div>
          </div>
        </div>

        {/* =================================================================
            METRICS / STATS TICKER
            ================================================================= */}
        <section className="container">
          <div className="metrics-row">
            {keyStats.map((item, idx) => (
              <div className="metric-card" key={idx}>
                <div className="metric-val">
                  {item.unit === 'TRACKS' ? tracks.length : item.value}{' '}
                  <span className="metric-unit">{item.unit}</span>
                </div>
                <div className="metric-title">{item.label}</div>
                <div className="metric-sub">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* =================================================================
            ABOUT / VISION SECTION (Simple English)
            ================================================================= */}
        <section id="about" className="section-spacing">
          <div className="container">
            <div className="section-header">
              <div className="section-pill gold">
                <Sparkles size={12} />
                WHY KGRCET HACKATHON 2027
              </div>
              <h2 className="section-title">
                Build something real in <span>36 hours.</span>
              </h2>
              <p className="section-desc">
                Work with your team, solve a challenge, and turn your ideas into a working project. Explore Generative AI, cybersecurity, and other technology domains alongside students from across the country.
              </p>
            </div>

            <div className="about-grid">
              <div className="about-text-col">
                <h3>Designed for Builders Who Refuse to Ship Mediocrity.</h3>
                <p>
                  At <strong>KG Reddy College of Engineering &amp; Technology</strong>, we believe the best
                  software and hardware systems are forged when razor-sharp talent meets a focused 36-hour sprint,
                  high-speed connectivity, and hands-on domain mentorship.
                </p>
                <p>
                  In collaboration with the <strong>Cybersecurity &amp; Ethical Hacking Club (CSEH)</strong>,
                  KGRCET’s Hackathon 2027 opens its doors to student builders from across India. Bring
                  your vision, form your squad, and turn abstract code into working production-grade systems.
                </p>

                <div className="about-highlights-list">
                  <div className="about-highlight-item">
                    <Zap size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Zero Fluff, 100% Code</h4>
                      <p>Focus purely on working software and functional prototypes without pitch deck theater.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item">
                    <Shield size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Defensive Security Standards</h4>
                      <p>Security is not an afterthought; build hardened, robust architectures from hour zero.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item">
                    <Users size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Industry Mentorship</h4>
                      <p>Direct architectural reviews and guidance from experienced domain engineers.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item">
                    <Award size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Incubation Support</h4>
                      <p>Standout projects receive incubation exploration and institutional mentorship.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Crucible Graphic Card */}
              <div className="about-graphic-card">
                <div className="crucible-orbit">
                  <div className="crucible-ring-outer" />
                  <div className="crucible-ring-inner" />
                  <div className="crucible-center">
                    <b>36 HOURS</b>
                    <span>SPRINT</span>
                  </div>

                  <div className="crucible-badge b1">
                    <Cpu size={12} style={{ color: 'var(--gold)' }} />
                    GEN AI / LLMS
                  </div>
                  <div className="crucible-badge b2">
                    <Lock size={12} style={{ color: 'var(--cyan)' }} />
                    CYBER DEFENSE
                  </div>
                  <div className="crucible-badge b3">
                    <Globe size={12} style={{ color: 'var(--violet)' }} />
                    NATIONAL ARENA
                  </div>
                  <div className="crucible-badge b4">
                    <Terminal size={12} style={{ color: 'var(--emerald)' }} />
                    PROD-READY CODE
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================
            CHALLENGE TRACKS SECTION
            ================================================================= */}
        <section id="tracks" className="section-spacing" style={{ background: 'var(--bg-secondary)' }}>
          <div className="container">
            <div className="section-header">
              <div className="section-pill cyan">
                <Terminal size={12} />
                CHALLENGE FIELDS
              </div>
              <h2 className="section-title">
                10 <span>Hackathon Tracks</span>
              </h2>
              <p className="section-desc">
                Specific problem statements within these domains will be released on-spot. These provisional categories are subject to official confirmation; specific problem statements will be announced on the day of the event.
              </p>
            </div>

            <div className="tracks-grid">
              {tracks.map((track) => (
                <div className="track-card" key={track.id}>
                  <div className="track-card-header">
                    <span className="track-num-badge">{track.number}</span>
                    <span className="track-status">{track.status}</span>
                  </div>

                  <h3 className="track-title">{track.title}</h3>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            EVENT TIMELINE (Refined Central Spine & Alternating Panels)
            ================================================================= */}
        <section id="schedule" className="section-spacing">
          <div className="container">
            <div className="section-header" style={{ textAlign: 'center', margin: '0 auto 48px' }}>
              <div className="section-pill gold">
                <Clock size={12} />
                SCHEDULE OVERVIEW
              </div>
              <h2 className="section-title">
                Event <span>Timeline</span>
              </h2>
              <p className="section-desc" style={{ marginInline: 'auto' }}>
                The official schedule for KGRCET’s 36-hour national hackathon across Day 1 and Day 2.
              </p>
            </div>

            <div className="timeline-section-wrap">
              <div className="timeline-spine" aria-hidden="true" />

              {timelineMilestones.map((item, idx) => {
                const isLeft = idx % 2 === 0
                return (
                  <div
                    key={item.id}
                    className={`milestone-row ${isLeft ? 'is-left' : 'is-right'}`}
                  >
                    <div className="milestone-card-col">
                      <div className={`milestone-card ${item.accent}`}>
                        <span className="milestone-date">{item.date}</span>
                        <h3 className="milestone-title">{item.title}</h3>
                        {item.description && (
                          <p className="milestone-desc">{item.description}</p>
                        )}
                        {item.details && (
                          <ul className="milestone-details-list">
                            {item.details.map((detail, dIdx) => (
                              <li key={dIdx} className="milestone-detail-item">
                                <span className="milestone-detail-dot" aria-hidden="true" />
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="milestone-marker-col">
                      <div className={`milestone-dot ${item.accent}`} />
                    </div>

                    <div className="milestone-empty-col" aria-hidden="true" />
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* =================================================================
            PRIZES & PERKS SECTION
            ================================================================= */}
        <section id="prizes" className="section-spacing" style={{ background: 'var(--bg-secondary)' }}>
          <div className="container">
            <div className="section-header">
              <div className="section-pill gold">
                <Trophy size={12} />
                AWARDS &amp; RECOGNITION
              </div>
              <h2 className="section-title">
                Prestigious <span>Prize Pool</span>
              </h2>
              <p className="section-desc">
                A provisional prize pool of <strong>INR 1,00,000</strong>. Award categories and distribution are yet to be announced.
              </p>
            </div>

            <div className="prizes-grid">
              {prizes.map((prize, idx) => (
                <div className={`prize-card ${prize.highlight ? 'champion' : ''}`} key={idx}>
                  <span
                    className={`prize-badge ${
                      idx === 0 ? 'gold' : idx === 1 ? 'silver' : 'bronze'
                    }`}
                  >
                    {prize.badge}
                  </span>
                  <span className="prize-rank">{prize.rank}</span>
                  <div className="prize-amount">{prize.amount}</div>
                  <h3 className="prize-title">{prize.tier}</h3>

                  <ul className="prize-perks-list">
                    {prize.perks.map((perk, pIdx) => (
                      <li className="prize-perk-item" key={pIdx}>
                        <Check size={16} className="prize-check-icon" />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="section-header" style={{ marginBottom: 36, marginTop: 52 }}>
              <h3 className="section-title" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
                Hacker Experience &amp; <span>Amenities</span>
              </h3>
              <p className="section-desc">
                Everything you need to focus entirely on building without distraction.
              </p>
            </div>

            <div className="perks-grid">
              {perksList.map((perk, idx) => {
                const getPerkIcon = (name: string) => {
                  switch (name) {
                    case 'coffee':
                      return <Coffee size={22} />
                    case 'wifi':
                      return <Wifi size={22} />
                    case 'package':
                      return <Package size={22} />
                    case 'users':
                      return <Users size={22} />
                    case 'award':
                      return <Award size={22} />
                    case 'gamepad':
                      return <Gamepad2 size={22} />
                    default:
                      return <Gift size={22} />
                  }
                }

                return (
                  <div className="perk-card" key={idx}>
                    <div className="perk-icon-wrap">{getPerkIcon(perk.icon)}</div>
                    <h4>{perk.title}</h4>
                    <p>{perk.description}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* =================================================================
            ORGANIZERS & LEADERSHIP
            ================================================================= */}
        <section id="organizers" className="section-spacing">
          <div className="container">
            <div className="section-header">
              <div className="section-pill">
                <Users size={12} />
                STEERING COMMITTEE
              </div>
              <h2 className="section-title">
                The Leadership <span>Behind KGRCET 2027</span>
              </h2>
              <p className="section-desc">
                Organized under the patronage of KG Reddy College of Engineering &amp; Technology in
                collaboration with the student leaders of Cybersecurity &amp; Ethical Hacking Club.
              </p>
            </div>

            <div className="organizer-sections-grid">
              {organizerGroups.map((group, gIdx) => (
                <div className="organizer-pillar-card" key={gIdx}>
                  <div className="pillar-header">
                    <h3 className="pillar-title">{group.title}</h3>
                    <span className="pillar-subtitle">{group.role}</span>
                  </div>

                  <div className="members-list">
                    {group.entries.length === 0 ? <p className="organizer-pending">Committee details will be announced by KGRCET.</p> : group.entries.map((member, mIdx) => (
                      <div className="member-card" key={mIdx}>
                        <div className="member-avatar">
                          {member.name.split(' ').map((n) => n[0]).slice(0, 2).join('') || 'KG'}
                        </div>
                        <div className="member-info">
                          <h5>{member.name}</h5>
                          <span>{member.designation}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            EVENT INFO / ESSENTIAL PARAMETERS (Simplified & Structured)
            ================================================================= */}
        <section id="info" className="section-spacing" style={{ background: 'var(--bg-secondary)' }}>
          <div className="container">
            <div className="section-header">
              <div className="section-pill cyan">
                <Terminal size={12} />
                KEY PARAMETERS
              </div>
              <h2 className="section-title">
                Event <span>Information</span>
              </h2>
              <p className="section-desc">
                Key logistical parameters, venue location, and event structure for participating student teams.
              </p>
            </div>

            <div className="event-info-grid">
              {eventInfoDetails.map((item, idx) => (
                <div className="event-info-card" key={idx}>
                  <div className="event-info-header">
                    <span className="event-info-title">{item.title}</span>
                    <span className="event-info-value">{item.value}</span>
                  </div>
                  <p className="event-info-detail">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>}

      {/* =================================================================
          FOOTER
          ================================================================= */}
      <footer className="site-footer">
        <div className="container footer-centered" style={{ textAlign: 'center' }}>
          <p>© 2027 KGRCET Hackathon · All Rights Reserved.</p>
          <p className="footer-developer-credit">Developed by Jashanth Gonipati (24QM1A05A3)</p>
          <address style={{ fontStyle: 'normal' }}>
            <p>KG Reddy College of Engineering &amp; Technology</p>
            <p>Beside Moinabad Police Station, Chilkur Village, Moinabad Mandal, Ranga Reddy District, Hyderabad, Telangana – 501504.</p>
          </address>
        </div>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
