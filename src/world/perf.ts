/**
 * How much visual work this device can afford, decided once before the first render.
 * `lite` (phones and weak machines) drops glass blur, full-screen overlays and repaint-heavy animation;
 * `lowEnd` additionally renders the backdrop at a lower resolution.
 */
const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820

export const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (device.deviceMemory ?? 8) <= 4 || Boolean(device.connection?.saveData)
export const lite = phone || lowEnd

/** Switches the interface to its lighter rendering, e.g. when the backdrop cannot hold its frame rate. */
export const downgrade = () => { document.documentElement.dataset.perf = 'lite' }

if (lite) downgrade()
