import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, MotionConfig, motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
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
  MapPin,
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
import Admin from './Admin'
import Cosmos from './world/Cosmos'
import { Decode, Reveal, useSurfaceEffects } from './world/fx'
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

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState<CountdownState>(() => calculateTimeLeft(event.startDate, event.endDate))

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(event.startDate, event.endDate))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return timeLeft
}

const pad = (value: number) => String(value).padStart(2, '0')

const DIAL_RADIUS = 43
const DIAL_LENGTH = 2 * Math.PI * DIAL_RADIUS

function Dial({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div className="countdown-unit">
      <svg className="dial" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="dial-ticks" cx="50" cy="50" r="48" pathLength="120" />
        <circle className="dial-track" cx="50" cy="50" r={DIAL_RADIUS} />
        <circle
          className="dial-arc"
          cx="50"
          cy="50"
          r={DIAL_RADIUS}
          strokeDasharray={DIAL_LENGTH}
          strokeDashoffset={DIAL_LENGTH * (1 - Math.min(value / max, 1))}
        />
      </svg>
      <span className="countdown-number">{pad(value)}</span>
      <span className="countdown-text">{label}</span>
    </div>
  )
}

function Countdown() {
  const timeLeft = useCountdown()

  return (
    <div className="countdown-box-wrapper">
      <div className="countdown-header">
        <span className="countdown-label">
          <Clock size={13} />
          EVENT COMMENCEMENT COUNTDOWN
        </span>
        <span className="countdown-date-badge">
          <Calendar size={12} />
          {event.dateDisplay}
        </span>
      </div>

      {timeLeft.status === 'upcoming' ? <div className="countdown-digits-grid">
        <Dial value={timeLeft.days} max={365} label="DAYS" />
        <Dial value={timeLeft.hours} max={24} label="HOURS" />
        <Dial value={timeLeft.minutes} max={60} label="MINUTES" />
        <Dial value={timeLeft.seconds} max={60} label="SECONDS" />
      </div> : <p className="countdown-status" role="status">
        {timeLeft.status === 'in-progress' ? 'Event in progress' : 'Event completed'}
      </p>}
    </div>
  )
}

function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState('')

  useEffect(() => {
    if (!enabled) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(`#${entry.target.id}`)
      }
    }, { rootMargin: '-45% 0px -50% 0px' })
    for (const item of navigation) {
      const section = document.querySelector(item.href)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [enabled])

  return active
}

/** Instrument readouts around the viewport edge. Every value shown here is live and real. */
function Hud({ active }: { active: string }) {
  const timeLeft = useCountdown()
  const { scrollYProgress } = useScroll()
  const fill = useRef<HTMLSpanElement>(null)
  const percent = useRef<HTMLSpanElement>(null)
  const current = navigation.find((item) => item.href === active)

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    if (fill.current) fill.current.style.transform = `scaleY(${progress})`
    if (percent.current) percent.current.textContent = String(Math.round(progress * 100)).padStart(3, '0')
  })

  return (
    <div className="hud" aria-hidden="true">
      <div className="hud-rail"><span ref={fill} /></div>
      <div className="hud-readout hud-right" data-visible={Boolean(current)}>
        {timeLeft.status === 'upcoming' && <span>T− {timeLeft.days}D {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}</span>}
        <span><span ref={percent}>000</span>%</span>
      </div>
    </div>
  )
}

function SectionHeader({ icon, pill, title, children, tone = '', centered = false }: {
  icon: ReactNode
  pill: string
  title: ReactNode
  children: ReactNode
  tone?: string
  centered?: boolean
}) {
  return (
    <Reveal className={`section-header ${centered ? 'is-centered' : ''}`}>
      <div className={`section-pill ${tone}`}>
        {icon}
        <Decode text={pill} />
      </div>
      <h2 className="section-title">{title}</h2>
      <p className="section-desc">{children}</p>
    </Reveal>
  )
}

function Timeline() {
  const wrap = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(0)
  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start 85%', 'end 55%'] })

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    wrap.current?.style.setProperty('--beam', String(progress))
    setLit(Math.floor(progress * timelineMilestones.length + 0.25))
  })

  return (
    <div className="timeline-section-wrap" ref={wrap}>
      <div className="timeline-spine" aria-hidden="true"><span /></div>

      {timelineMilestones.map((item, idx) => (
        <Reveal key={item.id} className="milestone-row" delay={idx * 0.08}>
          <div className="milestone-marker-col">
            <div className={`milestone-dot ${item.accent} ${idx < lit ? 'is-lit' : ''}`} />
          </div>
          <div className={`milestone-card ${item.accent}`} data-glow>
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
        </Reveal>
      ))}
    </div>
  )
}

function ThresholdCaption({ progress, input, opacity, className = '', children }: {
  progress: MotionValue<number>
  input: number[]
  opacity: number[]
  className?: string
  children: ReactNode
}) {
  const fade = useTransform(progress, input, opacity)
  const y = useTransform(progress, [input[0], input[input.length - 1]], [28, -28])
  return <motion.p className={`threshold-caption ${className}`} style={{ opacity: fade, y }}>{children}</motion.p>
}

/** Empty scroll distance for the dive through the horizon. Cosmos draws the journey behind these captions. */
function Threshold() {
  const runway = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: runway, offset: ['start start', 'end end'] })

  return (
    <div id="threshold" className="threshold" ref={runway}>
      <div className="threshold-stage">
        <ThresholdCaption progress={scrollYProgress} input={[0.01, 0.07, 0.2, 0.26]} opacity={[0, 1, 1, 0]}>
          <span>Leave the <em>ordinary</em> behind.</span>
        </ThresholdCaption>
        <ThresholdCaption progress={scrollYProgress} input={[0.27, 0.33, 0.44, 0.5]} opacity={[0, 1, 1, 0]}>
          <span>Past this point, only what you <em>build</em> remains.</span>
        </ThresholdCaption>
        <ThresholdCaption progress={scrollYProgress} input={[0.82, 0.9, 1]} opacity={[0, 1, 1]} className="threshold-arrival">
          <small>KGRCET's Hackathon 2027</small>
          <span>Welcome to the <em>other side.</em></span>
        </ThresholdCaption>
      </div>
    </div>
  )
}

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

const getInfoIcon = (name: string) => {
  switch (name) {
    case 'clock':
      return <Clock size={18} />
    case 'calendar':
      return <Calendar size={18} />
    case 'map-pin':
      return <MapPin size={18} />
    case 'users':
      return <Users size={18} />
    case 'terminal':
      return <Terminal size={18} />
    default:
      return <Award size={18} />
  }
}

const marqueeText = <>
  Organized by <strong>KG Reddy College of Engineering &amp; Technology</strong> in collaboration with the <strong>Cybersecurity &amp; Ethical Hacking Club</strong>. 36 hours of non-stop engineering to pioneer breakthroughs in Generative AI, Cyber Defense, and Autonomous Systems.
</>

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '')
  const isRegistration = pathname === '/register'
  const isAdmin = pathname === '/admin' || pathname === '/admin/login'
  const isSubpage = isRegistration || isAdmin
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [realm, setRealm] = useState<'void' | 'world'>(isSubpage ? 'world' : 'void')
  const activeSection = useActiveSection(!isSubpage)

  useSurfaceEffects()

  // Default theme is dark on every device; preserve user manual choice
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      let saved: string | null = null
      try { saved = localStorage.getItem('kgrcet-theme') } catch { /* Theme preference is optional. */ }
      if (saved === 'light' || saved === 'dark') return saved
      const docTheme = document.documentElement.dataset.theme as 'light' | 'dark' | undefined
      if (docTheme === 'light' || docTheme === 'dark') return docTheme
    }
    return 'dark'
  })

  useLayoutEffect(() => {
    document.documentElement.dataset.realm = realm
  }, [realm])

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

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24)
      // The whole interface crosses over once the gate has opened around the viewer.
      const runway = document.getElementById('threshold')?.getBoundingClientRect()
      if (runway) setRealm(runway.top < -(runway.height - window.innerHeight) * 0.72 ? 'world' : 'void')
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('kgrcet-theme', nextTheme) } catch { /* Theme preference is optional. */ }
    document.documentElement.dataset.theme = nextTheme
    setTheme(nextTheme)
  }

  const heroLine = (delay: number) => ({
    initial: { opacity: 0, y: 34, filter: 'blur(14px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: 1.3, delay, ease: [0.16, 1, 0.3, 1] as const },
  })

  return (
    <MotionConfig reducedMotion="user">
    <div className="site-shell">
      <Cosmos theme={theme} fixed={isSubpage} />
      <div className="grid-overlay" aria-hidden="true" />
      <div className="grain-overlay" aria-hidden="true" />
      {!isSubpage && <Hud active={activeSection} />}

      {/* =================================================================
          HEADER & SUBSTANTIAL COLLEGE IDENTITY
          ================================================================= */}
      <header className="site-header" data-scrolled={scrolled}>
        <div className="container header-inner">
          <a href={isSubpage ? '/' : '#top'} className="brand-link" aria-label="KG Reddy College of Engineering and Technology - KGRCET Hackathon 2027">
            <span className="brand-plaque">
              <img
                className="brand-college-logo"
                src={collegeLogo}
                alt="KG Reddy College of Engineering and Technology"
              />
            </span>
            <div className="brand-titles">
              <span className="brand-name">
                KGRCET <span className="brand-year">HACKATHON 2027</span>
              </span>
              <span className="brand-sub">36-HOUR NATIONAL HACKATHON</span>
            </div>
          </a>

          {!isSubpage && <nav className="desktop-nav" aria-label="Primary Desktop Navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} aria-current={activeSection === item.href ? 'true' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>}

          <div className="header-right">
            {isSubpage && <a href="/" className="back-to-overview">Back to Overview</a>}
            <button
              onClick={toggleTheme}
              className="theme-toggle-btn"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {!isSubpage && <>
            <a href="/register" className="btn-header-register">
              <span>Register</span>
              <Sparkles size={14} />
            </a>

            <button
              className="mobile-menu-trigger"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            </>}
          </div>
        </div>
      </header>

      {/* Mobile Sliding Drawer */}
      <AnimatePresence>
        {!isSubpage && menuOpen && (
          <motion.div
            className="mobile-nav-drawer"
            id="mobile-navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mobile-nav-links">
              {navigation.map((item, idx) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  className="mobile-nav-link"
                  onClick={() => setMenuOpen(false)}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.05 + idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span>{item.label}</span>
                  <ArrowRight size={18} />
                </motion.a>
              ))}
            </div>
            <div className="mobile-drawer-footer">
              <a href="/register" className="btn-primary-luxury is-wide">
                <span>Register</span>
                <Sparkles size={15} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isAdmin ? <Admin /> : isRegistration ? <Registration /> : <main id="top">
        {/* =================================================================
            HERO SECTION
            ================================================================= */}
        <section className="hero-section">
          <div className="container hero-content">
            {/* Main Grand Landing Titles */}
            <h1 className="hero-title-main">
              <motion.span className="hero-title-line" {...heroLine(0.1)}>KGRCET'S</motion.span>
              <motion.span className="hero-title-gradient" {...heroLine(0.22)}>HACKATHON</motion.span>
              <motion.span className="hero-title-year" {...heroLine(0.34)}>2027</motion.span>
            </h1>

            <motion.div className="hero-lower" {...heroLine(0.5)}>
              <div className="hero-lower-copy">
                {/* Refined Hackathon Tagline with Balanced Stars */}
                <div className="hero-subtitle-tagline">
                  <span className="hero-star" aria-hidden="true">✦</span>
                  <span>A 36-HOUR NATIONAL LEVEL HACKATHON</span>
                  <span className="hero-star" aria-hidden="true">✦</span>
                </div>

                {/* Action Buttons */}
                <div className="hero-cta-group">
                  <a href="/register" className="btn-primary-luxury">
                    <span>Register</span>
                    <ArrowRight size={16} />
                  </a>

                  <a href="#tracks" className="btn-secondary-luxury">
                    <span>Explore 10 Challenge Tracks</span>
                    <ArrowUpRight size={16} />
                  </a>
                </div>
              </div>

              {/* Precision Countdown Interface */}
              <Countdown />
            </motion.div>
          </div>
        </section>

        {/* Full-Bleed Marquee */}
        <div
          className="hero-marquee"
          aria-label="Organized by KG Reddy College of Engineering and Technology in collaboration with the Cybersecurity and Ethical Hacking Club. 36 hours of non-stop engineering to pioneer breakthroughs in Generative AI, Cyber Defense, and Autonomous Systems."
        >
          <div className="marquee-track">
            <div className="marquee-copy">
              <span>{marqueeText}</span>
              <span className="marquee-separator" aria-hidden="true">◆</span>
            </div>
            <div className="marquee-copy" aria-hidden="true">
              <span>{marqueeText}</span>
              <span className="marquee-separator">◆</span>
            </div>
          </div>
        </div>

        {/* =================================================================
            METRICS / STATS TICKER
            ================================================================= */}
        <section className="container">
          <Reveal className="metrics-row">
            {keyStats.map((item, idx) => (
              <div className="metric-card" key={idx} data-glow>
                <div className="metric-val">
                  <Decode numeric text={String(item.unit === 'TRACKS' ? tracks.length : item.value)} />{' '}
                  <span className="metric-unit">{item.unit}</span>
                </div>
                <div className="metric-title">{item.label}</div>
                <div className="metric-sub">{item.desc}</div>
              </div>
            ))}
          </Reveal>
        </section>

        <Threshold />

        {/* =================================================================
            ABOUT / VISION SECTION (Simple English)
            ================================================================= */}
        <section id="about" className="section-spacing">
          <div className="container">
            <SectionHeader
              icon={<Sparkles size={12} />}
              tone="gold"
              pill="WHY KGRCET HACKATHON 2027"
              title={<>Build something real in <span>36 hours.</span></>}
            >
              Work with your team, solve a challenge, and turn your ideas into a working project. Explore Generative AI, cybersecurity, and other technology domains alongside students from across the country.
            </SectionHeader>

            <div className="about-grid">
              <Reveal className="about-text-col">
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
                  <div className="about-highlight-item" data-glow>
                    <Zap size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Zero Fluff, 100% Code</h4>
                      <p>Focus purely on working software and functional prototypes without pitch deck theater.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item" data-glow>
                    <Shield size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Defensive Security Standards</h4>
                      <p>Security is not an afterthought; build hardened, robust architectures from hour zero.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item" data-glow>
                    <Users size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Industry Mentorship</h4>
                      <p>Direct architectural reviews and guidance from experienced domain engineers.</p>
                    </div>
                  </div>

                  <div className="about-highlight-item" data-glow>
                    <Award size={20} className="about-item-icon" />
                    <div className="about-item-text">
                      <h4>Incubation Support</h4>
                      <p>Standout projects receive incubation exploration and institutional mentorship.</p>
                    </div>
                  </div>
                </div>
              </Reveal>

              {/* Crucible Graphic Card */}
              <Reveal className="about-graphic-card" delay={0.1}>
                <span className="corner-marks" aria-hidden="true" />
                <div className="crucible-orbit">
                  <div className="crucible-ring-outer" />
                  <div className="crucible-ring-middle" />
                  <div className="crucible-ring-inner" />
                  <div className="crucible-center">
                    <b>36 HOURS</b>
                    <span>SPRINT</span>
                  </div>
                </div>

                <div className="crucible-badge b1">
                  <Cpu size={13} />
                  GEN AI / LLMS
                </div>
                <div className="crucible-badge b2">
                  <Lock size={13} />
                  CYBER DEFENSE
                </div>
                <div className="crucible-badge b3">
                  <Globe size={13} />
                  NATIONAL ARENA
                </div>
                <div className="crucible-badge b4">
                  <Terminal size={13} />
                  PROD-READY CODE
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* =================================================================
            CHALLENGE TRACKS SECTION
            ================================================================= */}
        <section id="tracks" className="section-spacing">
          <div className="container tracks-layout">
            <div className="tracks-aside">
              <SectionHeader
                icon={<Terminal size={12} />}
                tone="cyan"
                pill="CHALLENGE FIELDS"
                title={<>10 <span>Hackathon Tracks</span></>}
              >
                Specific problem statements within these domains will be released on-spot. These provisional categories are subject to official confirmation; specific problem statements will be announced on the day of the event.
              </SectionHeader>
            </div>

            <div className="tracks-grid">
              {tracks.map((track) => (
                <Reveal className="track-card" key={track.id}>
                  <div className="track-card-header">
                    <span className="track-num-badge">{track.number}</span>
                    <span className="track-status">{track.status}</span>
                  </div>

                  <h3 className="track-title">{track.title}</h3>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            EVENT TIMELINE (Scroll-driven beam across three milestones)
            ================================================================= */}
        <section id="schedule" className="section-spacing">
          <div className="container">
            <SectionHeader
              icon={<Clock size={12} />}
              tone="gold"
              pill="SCHEDULE OVERVIEW"
              title={<>Event <span>Timeline</span></>}
              centered
            >
              The official schedule for KGRCET’s 36-hour national hackathon across Day 1 and Day 2.
            </SectionHeader>

            <Timeline />
          </div>
        </section>

        {/* =================================================================
            PRIZES & PERKS SECTION
            ================================================================= */}
        <section id="prizes" className="section-spacing">
          <div className="container">
            <SectionHeader
              icon={<Trophy size={12} />}
              tone="gold"
              pill="AWARDS & RECOGNITION"
              title={<>Prestigious <span>Prize Pool</span></>}
            >
              A provisional prize pool of <strong>INR 1,00,000</strong>. Award categories and distribution are yet to be announced.
            </SectionHeader>

            <div className="prizes-grid">
              {prizes.map((prize, idx) => (
                <Reveal key={idx} delay={idx * 0.08} className="prize-cell">
                  <div className={`prize-card ${prize.highlight ? 'champion' : ''}`} data-glow data-tilt={prize.highlight ? true : undefined}>
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
                          <Check size={15} className="prize-check-icon" />
                          <span>{perk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="section-header amenities-header">
              <h3 className="section-title">
                Hacker Experience &amp; <span>Amenities</span>
              </h3>
              <p className="section-desc">
                Everything you need to focus entirely on building without distraction.
              </p>
            </Reveal>

            <div className="perks-grid">
              {perksList.map((perk, idx) => (
                <Reveal className="perk-card" key={idx} delay={(idx % 3) * 0.06}>
                  <div className="perk-icon-wrap">{getPerkIcon(perk.icon)}</div>
                  <h4>{perk.title}</h4>
                  <p>{perk.description}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            ORGANIZERS & LEADERSHIP
            ================================================================= */}
        <section id="organizers" className="section-spacing">
          <div className="container">
            <SectionHeader
              icon={<Users size={12} />}
              pill="STEERING COMMITTEE"
              title={<>The Leadership <span>Behind KGRCET 2027</span></>}
            >
              Organized under the patronage of KG Reddy College of Engineering &amp; Technology in
              collaboration with the student leaders of Cybersecurity &amp; Ethical Hacking Club.
            </SectionHeader>

            <div className="organizer-sections-grid">
              {organizerGroups.map((group, gIdx) => (
                <Reveal className="organizer-pillar-card" key={gIdx} delay={gIdx * 0.08}>
                  <div className="pillar-header">
                    <h3 className="pillar-title">{group.title}</h3>
                    <span className="pillar-subtitle">{group.role}</span>
                  </div>

                  <div className="members-list">
                    {group.entries.length === 0 ? <>
                      <div className="organizer-sealed" aria-hidden="true"><span /><span /><span /></div>
                      <p className="organizer-pending">Committee details will be announced by KGRCET.</p>
                    </> : group.entries.map((member, mIdx) => (
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
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================================
            EVENT INFO / ESSENTIAL PARAMETERS (Simplified & Structured)
            ================================================================= */}
        <section id="info" className="section-spacing">
          <div className="container">
            <SectionHeader
              icon={<Terminal size={12} />}
              tone="cyan"
              pill="KEY PARAMETERS"
              title={<>Event <span>Information</span></>}
            >
              Key logistical parameters, venue location, and event structure for participating student teams.
            </SectionHeader>

            <div className="event-info-grid">
              {eventInfoDetails.map((item, idx) => (
                <Reveal className="event-info-cell" key={idx} delay={(idx % 2) * 0.06}>
                  <div className="event-info-card" data-glow>
                    <div className="event-info-header">
                      <span className="event-info-title">{getInfoIcon(item.icon)}{item.title}</span>
                      <span className="event-info-value">{item.value}</span>
                    </div>
                    <p className="event-info-detail">{item.detail}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>}

      {/* =================================================================
          FOOTER
          ================================================================= */}
      <footer className="site-footer">
        <div className="container footer-container">
          <div className="footer-grid">
            <div className="footer-col footer-col-brand">
              <div className="footer-brand-title">
                KGRCET <span className="footer-brand-year">2027</span>
              </div>
              <p className="footer-tagline">
                A 36-hour national level hackathon at KG Reddy College of Engineering &amp; Technology, Hyderabad.
              </p>
            </div>

            <div className="footer-col footer-col-developers">
              <h4 className="footer-col-header">DEVELOPED BY</h4>
              <div className="footer-col-body">
                <p className="footer-developer-credit">
                  Jashanth Gonipati (24QM1A05A3) <br /> Aluguri SaiVaibhav (24QM1A0514)
                </p>
              </div>
            </div>

            <div className="footer-col footer-col-venue">
              <h4 className="footer-col-header">CAMPUS VENUE</h4>
              <div className="footer-col-body">
                <p className="footer-venue-name">{event.institution}</p>
                <p className="footer-venue-address">
                  Chilkur Village, Moinabad, Hyderabad — 501504
                </p>
              </div>
            </div>
          </div>

          <div className="footer-divider" />

          <div className="footer-bottom">
            <p className="footer-copyright">
              © 2027 KGRCET · ALL RIGHTS RESERVED.
            </p>
            {!isAdmin && (
              <a href="/admin/login" className="footer-admin-link">
                ADMIN LOGIN ✦
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
