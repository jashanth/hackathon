/**
 * How much visual work this device can afford, decided once before the first render.
 * `lite` (phones and weak machines) drops glass blur, full-screen overlays and repaint-heavy animation;
 * `lowEnd` additionally renders the backdrop at a lower resolution.
 */
type ExtraNavigator = { deviceMemory?: number; connection?: { saveData?: boolean } }
const device = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & ExtraNavigator

const isPhone = () => {
  if (typeof window === 'undefined') return false
  const hasCoarse = window.matchMedia('(pointer: coarse)').matches
  const narrowViewport = window.innerWidth <= 900
  const narrowScreen = Math.min(window.screen?.width || 1920, window.screen?.height || 1080) <= 900
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  return hasCoarse || narrowViewport || narrowScreen || mobileUa
}

export const lowEnd = (navigator?.hardwareConcurrency || 4) <= 4 || (device.deviceMemory ?? 8) <= 4 || Boolean(device.connection?.saveData)
export const lite = isPhone() || lowEnd

/** Switches the interface to its lighter rendering, e.g. when the backdrop cannot hold its frame rate. */
export const downgrade = () => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.perf = 'lite'
  }
}

if (lite) downgrade()
