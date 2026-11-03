import { useEffect, useRef } from 'react'

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

// Scene 1: a black hole, traced by bending each view ray around a unit-radius horizon.
// Scene 2: the nebula behind the horizon, where the page content lives.
// Both are rendered as light on black, then remapped to ink on paper for the light theme.
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uPointer;
uniform float uTime;
uniform float uDistance;
uniform float uTilt;
uniform float uHoleMix;
uniform float uDrift;
uniform float uLight;
uniform float uDim;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(vec3(i, 1.0)), hash(vec3(i + vec2(1.0, 0.0), 1.0)), f.x),
    mix(hash(vec3(i + vec2(0.0, 1.0), 1.0)), hash(vec3(i + vec2(1.0, 1.0), 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    amplitude *= 0.5;
  }
  return value;
}

vec3 starfield(vec3 direction) {
  vec3 color = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 110.0 : 240.0;
    vec3 q = direction * scale;
    vec3 id = floor(q);
    float seed = hash(id + float(layer) * 7.0);
    if (seed > 0.982) {
      float falloff = length(fract(q) - 0.5);
      float twinkle = 0.65 + 0.35 * sin(uTime * (0.6 + seed * 2.0) + seed * 80.0);
      float star = smoothstep(0.2, 0.0, falloff) * twinkle * (0.35 + fract(seed * 37.0) * 0.65);
      color += star * mix(vec3(1.0, 0.86, 0.62), vec3(0.82, 0.76, 1.0), fract(seed * 91.0));
    }
  }
  return color * 0.7;
}

vec3 nebula(vec2 p) {
  vec2 q = p * 1.35 + vec2(0.0, uDrift * 0.16);
  float t = uTime * 0.018;
  float warp = fbm(q + vec2(t, -t * 0.6));
  float cloud = fbm(q * 1.2 + warp * 1.9 + vec2(-t * 0.7, t));
  float veil = fbm(q * 0.6 - warp * 0.8 + 11.0);
  float hueShift = 0.5 + 0.5 * sin(uDrift * 0.42);
  vec3 aubergine = mix(vec3(0.20, 0.07, 0.30), vec3(0.11, 0.08, 0.27), hueShift);
  vec3 ember = mix(vec3(0.62, 0.40, 0.15), vec3(0.50, 0.24, 0.32), hueShift);
  vec3 color = aubergine * pow(cloud, 2.4) * 1.05;
  color += ember * pow(cloud * veil, 3.0) * 1.1;
  color += vec3(0.018, 0.012, 0.028) * veil;
  return color;
}

vec3 diskColor(float heat) {
  vec3 outer = vec3(0.34, 0.12, 0.42);
  vec3 middle = vec3(0.95, 0.58, 0.20);
  vec3 inner = vec3(1.0, 0.82, 0.52);
  return heat < 0.5 ? mix(outer, middle, heat * 2.0) : mix(middle, inner, (heat - 0.5) * 2.0);
}

// Returns radiance in rgb and how much of the pixel the horizon swallows in a.
vec4 blackHole(vec2 p) {
  float yaw = uPointer.x * 0.09;
  float tilt = uTilt + uPointer.y * 0.035;
  vec3 eye = uDistance * vec3(sin(yaw) * cos(tilt), sin(tilt), -cos(yaw) * cos(tilt));
  vec3 forward = -normalize(eye);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);

  // A slow roll keeps the disk from sitting perfectly level.
  float roll = -0.2;
  vec2 rolled = vec2(p.x * cos(roll) - p.y * sin(roll), p.x * sin(roll) + p.y * cos(roll));

  vec3 position = eye;
  vec3 velocity = normalize(forward * 1.05 + right * rolled.x + up * rolled.y);
  vec3 orbit = cross(position, velocity);
  float angularMomentum = dot(orbit, orbit);

  vec3 glow = vec3(0.0);
  vec3 disk = vec3(0.0);
  float opacity = 0.0;
  float swallowed = 0.0;
  float closest = 100.0;

  for (int i = 0; i < 52; i++) {
    float radiusSquared = dot(position, position);
    float radius = sqrt(radiusSquared);
    closest = min(closest, radius);
    if (radius < 1.0) { swallowed = 1.0; break; }
    if (radius > 44.0 && dot(position, velocity) > 0.0) break;

    float dt = max(0.05, radius * 0.13);
    vec3 previous = position;
    velocity += -1.5 * angularMomentum * position / (radiusSquared * radiusSquared * radius) * dt;
    position += velocity * dt;

    if (previous.y * position.y < 0.0 && opacity < 0.98) {
      vec3 hit = mix(previous, position, previous.y / (previous.y - position.y));
      float planar = length(hit.xz);
      if (planar > 1.9 && planar < 9.5) {
        float angle = atan(hit.z, hit.x) + 2.3 * log(planar) + uTime * 0.16;
        vec2 swirl = vec2(cos(angle), sin(angle));
        float grain = fbm(swirl * 2.4 + planar * 0.42) * 0.8 + fbm(swirl * 6.0 - planar * 0.9) * 0.45;
        float edge = smoothstep(1.9, 2.5, planar) * smoothstep(9.5, 4.2, planar);
        vec3 flow = normalize(vec3(-hit.z, 0.0, hit.x));
        float doppler = 1.0 + 0.5 * dot(flow, normalize(velocity));
        float density = edge * (0.18 + grain * grain * 1.5);
        float heat = smoothstep(9.0, 2.1, planar);
        vec3 light = diskColor(heat) * density * doppler * doppler * (0.42 + heat * 0.62);
        disk += (1.0 - opacity) * light;
        opacity = min(1.0, opacity + density * 0.85);
      }
    }
  }

  glow = vec3(1.0, 0.72, 0.38) * exp(-max(closest - 1.55, 0.0) * 2.4) * 0.26;
  vec3 background = swallowed > 0.5 ? vec3(0.0) : starfield(normalize(velocity)) + nebula(velocity.xy * 0.9) * 0.4;
  vec3 color = background * (1.0 - opacity) + disk;
  if (swallowed < 0.5) color += glow;
  return vec4(color, swallowed * (1.0 - opacity));
}

void main() {
  float unit = min(uResolution.y, uResolution.x * 1.05);
  vec2 p = (gl_FragCoord.xy - uCenter * uResolution) / unit;
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  vec3 color = vec3(0.0);
  float shadow = 0.0;
  if (uHoleMix < 0.999) {
    vec3 deep = nebula(screen) * 0.9 + starfield(normalize(vec3(screen + vec2(0.0, uDrift * 0.05), 1.0)));
    color = deep * (1.0 - uHoleMix);
  }
  if (uHoleMix > 0.001) {
    vec4 hole = blackHole(p);
    color += hole.rgb * uHoleMix * uDim;
    shadow = hole.a * uHoleMix;
  }

  float vignette = smoothstep(1.25, 0.25, length(screen));
  vec3 dark = color * mix(0.55, 1.0, vignette);
  dark = 1.0 - exp(-dark * 1.5);

  float luminance = dot(color, vec3(0.3, 0.55, 0.15));
  float warmth = clamp(color.r / (color.r + color.b + 0.001), 0.0, 1.0);
  vec3 ink = mix(vec3(0.33, 0.14, 0.50), vec3(0.73, 0.49, 0.12), smoothstep(0.55, 0.8, warmth));
  vec3 paper = vec3(0.965, 0.945, 0.905);
  vec3 light = mix(paper, ink, 1.0 - exp(-luminance * 1.25));
  light = mix(light, vec3(0.085, 0.05, 0.12), shadow);

  gl_FragColor = vec4(mix(dark, light, uLight), 1.0);
}
`

type Uniform = WebGLUniformLocation | null

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

/**
 * Fixed WebGL backdrop. Scrolling the first two viewports flies the camera into the horizon.
 * With `fixed` set (the registration page) it stays in the nebula regardless of scroll.
 */
export default function Cosmos({ theme, fixed = false }: { theme: 'light' | 'dark'; fixed?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const themeRef = useRef(theme)
  const requestRender = useRef<() => void>(() => undefined)

  useEffect(() => {
    themeRef.current = theme
    requestRender.current()
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (!gl) { canvas.style.display = 'none'; return }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let program: WebGLProgram | null = null
    let uniforms: Record<string, Uniform> = {}
    let frame = 0
    let tick = 0
    let lastFrame = 0
    let slowFrames = 0
    let fastFrames = 0
    let measured = 0
    let lightMix = themeRef.current === 'light' ? 1 : 0
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const maxScale = Math.min(window.devicePixelRatio || 1, 1.5) * (window.innerWidth < 820 ? 0.7 : 0.85)
    let scale = maxScale

    const setup = () => {
      const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
      const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
      program = gl.createProgram()
      if (!vertex || !fragment || !program) return false
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      for (const name of ['uResolution', 'uCenter', 'uPointer', 'uTime', 'uDistance', 'uTilt', 'uHoleMix', 'uDrift', 'uLight', 'uDim']) {
        uniforms[name] = gl.getUniformLocation(program, name)
      }
      return true
    }

    const resize = () => {
      const width = Math.max(1, Math.round(window.innerWidth * scale))
      const height = Math.max(1, Math.round(window.innerHeight * scale))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }
    }

    const render = (time: number) => {
      if (!program) return
      const viewports = fixed ? 4 : window.scrollY / Math.max(window.innerHeight, 1)
      const portrait = window.innerWidth < window.innerHeight * 0.95
      const dive = smooth(0, 1.5, viewports)
      const isLight = lightMix > 0.5
      // The light theme has no dark interior to fall through, so it dissolves earlier.
      const holeMix = isLight ? 1 - smooth(0.55, 1.15, viewports) : 1 - smooth(1.05, 1.8, viewports)
      const restX = portrait ? 0.5 : 0.71
      const restY = portrait ? 0.74 : 0.69
      const centerBlend = smooth(0, 0.85, viewports)

      resize()
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height)
      gl.uniform2f(uniforms.uCenter, restX + (0.5 - restX) * centerBlend, restY + (0.5 - restY) * centerBlend)
      gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y)
      gl.uniform1f(uniforms.uTime, reducedMotion.matches ? 12 : time / 1000)
      gl.uniform1f(uniforms.uDistance, 29 - 27 * dive * dive)
      gl.uniform1f(uniforms.uTilt, 0.17 + 0.3 * dive)
      gl.uniform1f(uniforms.uHoleMix, holeMix)
      gl.uniform1f(uniforms.uDrift, viewports)
      gl.uniform1f(uniforms.uLight, lightMix)
      gl.uniform1f(uniforms.uDim, 1 - 0.8 * smooth(0.3, 1, viewports))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // Trades resolution for frame rate, so slower machines keep moving instead of stuttering.
    const adapt = (delta: number) => {
      measured += 1
      if (delta > 30) slowFrames += 1
      else if (delta < 18) fastFrames += 1
      if (measured < 40) return
      if (slowFrames > 20 && scale > 0.32) scale = Math.max(0.32, scale * 0.78)
      else if (fastFrames > 38 && scale < maxScale) scale = Math.min(maxScale, scale * 1.08)
      measured = slowFrames = fastFrames = 0
    }

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop)
      if (lastFrame) adapt(time - lastFrame)
      lastFrame = time
      const targetLight = themeRef.current === 'light' ? 1 : 0
      lightMix += (targetLight - lightMix) * 0.07
      if (Math.abs(targetLight - lightMix) < 0.002) lightMix = targetLight
      pointer.x += (pointer.targetX - pointer.x) * 0.04
      pointer.y += (pointer.targetY - pointer.y) * 0.04
      tick += 1
      // Past the hole the scene is only slow cloud, so half the frames are enough.
      if (window.scrollY > window.innerHeight * 2 && tick % 2) return
      render(time)
    }

    const start = () => {
      cancelAnimationFrame(frame)
      if (reducedMotion.matches) {
        lightMix = themeRef.current === 'light' ? 1 : 0
        render(0)
      } else {
        frame = requestAnimationFrame(loop)
      }
    }

    const stillRender = () => {
      if (!reducedMotion.matches) return
      lightMix = themeRef.current === 'light' ? 1 : 0
      render(0)
    }
    requestRender.current = stillRender

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerType !== 'mouse') return
      pointer.targetX = pointerEvent.clientX / window.innerWidth - 0.5
      pointer.targetY = pointerEvent.clientY / window.innerHeight - 0.5
    }
    const onContextLost = (contextEvent: Event) => {
      contextEvent.preventDefault()
      cancelAnimationFrame(frame)
    }
    const onContextRestored = () => {
      uniforms = {}
      if (setup()) start()
    }

    if (!setup()) { canvas.style.display = 'none'; return }
    canvas.dataset.ready = 'true'
    start()

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', stillRender, { passive: true })
    window.addEventListener('resize', stillRender)
    reducedMotion.addEventListener('change', start)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    return () => {
      cancelAnimationFrame(frame)
      requestRender.current = () => undefined
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', stillRender)
      window.removeEventListener('resize', stillRender)
      reducedMotion.removeEventListener('change', start)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    }
  }, [fixed])

  return <canvas ref={canvasRef} className="cosmos-canvas" aria-hidden="true" />
}
