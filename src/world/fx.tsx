import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

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
