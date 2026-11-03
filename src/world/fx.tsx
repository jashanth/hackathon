import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import collegeLogo from '../../assets/kgrcet-logo.png'

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const glyphs = '01<>/\\[]{}#$%&*+=?ABCDEFGHKLMNPRSTXZ'
const digits = '0123456789'

/** Resolves a label out of random characters the first time it scrolls into view. The final text never changes. */
export function Decode({ text, className, numeric = false }: { text: string; className?: string; numeric?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || prefersReducedMotion()) return
    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const pool = numeric ? digits : glyphs
      const duration = Math.min(1100, 320 + text.length * 26)
      const started = performance.now()
      const draw = (now: number) => {
        const progress = Math.min(1, (now - started) / duration)
        const settled = Math.floor(progress * text.length)
        let output = text.slice(0, settled)
        for (let i = settled; i < text.length; i++) {
          const original = text[i]
          const isSymbol = numeric ? !/\d/.test(original) : original === ' '
          output += isSymbol ? original : pool[Math.floor(Math.random() * pool.length)]
        }
        node.textContent = output
        if (progress < 1) frame = requestAnimationFrame(draw)
        else node.textContent = text
      }
      frame = requestAnimationFrame(draw)
    }, { threshold: 0.2 })
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      node.textContent = text
    }
  }, [text, numeric])

  return <span ref={ref} className={className}>{text}</span>
}

/** Fades content up as it enters the viewport. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Feeds pointer position to `[data-glow]` surfaces and tilts `[data-tilt]` ones, using one shared listener. */
export function useSurfaceEffects() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let tilted: HTMLElement | null = null
    const onMove = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target instanceof Element ? pointerEvent.target : null
      const glow = target?.closest<HTMLElement>('[data-glow]')
      if (glow) {
        const box = glow.getBoundingClientRect()
        glow.style.setProperty('--glow-x', `${pointerEvent.clientX - box.left}px`)
        glow.style.setProperty('--glow-y', `${pointerEvent.clientY - box.top}px`)
      }
      const tilt = target?.closest<HTMLElement>('[data-tilt]') ?? null
      if (tilted && tilted !== tilt) {
        tilted.style.removeProperty('--tilt-x')
        tilted.style.removeProperty('--tilt-y')
      }
      tilted = tilt
      if (tilt && !prefersReducedMotion()) {
        const box = tilt.getBoundingClientRect()
        tilt.style.setProperty('--tilt-x', `${((pointerEvent.clientY - box.top) / box.height - 0.5) * -5}deg`)
        tilt.style.setProperty('--tilt-y', `${((pointerEvent.clientX - box.left) / box.width - 0.5) * 5}deg`)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
}

/** Trailing reticle for mouse users. It sits on top of the native cursor rather than replacing it. */
export function Reticle() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !window.matchMedia('(hover: hover) and (pointer: fine)').matches || prefersReducedMotion()) return
    let frame = 0
    let x = -100
    let y = -100
    let targetX = -100
    let targetY = -100
    const onMove = (pointerEvent: PointerEvent) => {
      targetX = pointerEvent.clientX
      targetY = pointerEvent.clientY
      node.dataset.visible = 'true'
      const target = pointerEvent.target instanceof Element ? pointerEvent.target : null
      node.dataset.active = target?.closest('a, button, input, label') ? 'true' : 'false'
    }
    const onLeave = () => { node.dataset.visible = 'false' }
    const draw = () => {
      x += (targetX - x) * 0.2
      y += (targetY - y) * 0.2
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <div ref={ref} className="reticle" aria-hidden="true"><span /></div>
}

/** Plays once per browser session: the phoenix wakes while a counter climbs to 36, then the view opens. */
export function Ignition({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const finished = useRef(false)

  useEffect(() => {
    const finish = () => {
      if (finished.current) return
      finished.current = true
      setLeaving(true)
      onDone()
    }
    const started = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const progress = Math.min(1, (now - started) / 1700)
      setCount(Math.round((1 - Math.pow(1 - progress, 3)) * 36))
      if (progress < 1) frame = requestAnimationFrame(draw)
      else finish()
    }
    frame = requestAnimationFrame(draw)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [onDone])

  return (
    <motion.div
      className="ignition"
      aria-hidden="true"
      initial={{ opacity: 1 }}
      animate={leaving ? { opacity: 0, scale: 1.08 } : { opacity: 1 }}
      transition={{ duration: 0.9, ease: [0.7, 0, 0.2, 1] }}
      style={{ pointerEvents: leaving ? 'none' : 'auto' }}
    >
      <div className="ignition-phoenix" style={{ backgroundImage: `url(${collegeLogo})` }} />
      <div className="ignition-count">{String(count).padStart(2, '0')}</div>
      <div className="ignition-line"><span style={{ transform: `scaleX(${count / 36})` }} /></div>
    </motion.div>
  )
}
