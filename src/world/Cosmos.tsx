import { useEffect, useRef } from 'react'
import { downgrade, lite, lowEnd } from './perf'

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

// Scene 1: a black hole, traced by bending each view ray around a unit-radius horizon.
// Scene 2: the world on the far side of it: a blizzard over a frozen plain, one lamp, one walker.
// A widening gate of light takes the view from the first scene to the second.
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
uniform float uIris;
uniform float uHorizon;
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

vec3 tint(vec3 dark, vec3 light) { return mix(dark, light, uLight); }

// A lamp burning on the horizon: the only light in the storm.
vec2 lampAt() { return vec2(0.0, uHorizon + 0.012); }

float lampGlow(vec2 s) {
  float d = length((s - lampAt()) * vec2(1.0, 1.7));
  return (exp(-d * 4.2) * 0.5 + exp(-d * 22.0) * 0.75) * (1.0 - uDim * 0.45);
}

// Storm sky above the ice. v is the height above the horizon.
vec3 sky(vec2 s, float v) {
  float t = clamp(v / 1.1, 0.0, 1.0);
  vec3 haze = tint(vec3(0.36, 0.5, 0.7), vec3(0.86, 0.92, 0.98));
  vec3 steel = tint(vec3(0.08, 0.17, 0.34), vec3(0.66, 0.76, 0.9));
  vec3 zenith = tint(vec3(0.01, 0.025, 0.075), vec3(0.47, 0.58, 0.78));
  vec3 color = mix(haze, steel, smoothstep(0.0, 0.2, t));
  color = mix(color, zenith, smoothstep(0.16, 0.9, t));
  float cloud = fbm(vec2(s.x * 1.4 + uTime * 0.03 + uDrift * 0.05, v * 2.6 - uTime * 0.008));
  color *= mix(0.72 + 0.5 * cloud, 0.9 + 0.18 * cloud, uLight);
  return color;
}

// Frozen plain: long drifts of snow over dark, glassy ice, seen in perspective.
vec3 ice(vec2 s, float depth) {
  vec2 lamp = lampAt();
  float z = 1.0 / (depth + 0.008);
  vec2 g = vec2(s.x * z, z + uDrift * 1.5);
  float n = fbm(vec2(g.x * 0.11, g.y * 0.5)) + 0.22 * noise(vec2(g.x * 0.45, g.y * 2.0));
  float snow = smoothstep(0.52, 0.66, n);
  float lit = exp(-length((s - lamp) * vec2(0.85, 2.4)) * 2.0);
  vec3 dark = tint(vec3(0.015, 0.045, 0.12), vec3(0.5, 0.6, 0.76));
  vec3 drift = tint(vec3(0.46, 0.6, 0.82), vec3(0.94, 0.97, 1.0));
  vec3 color = mix(dark, drift, snow) * mix(0.32 + 1.25 * lit, 0.82 + 0.22 * lit, uLight);
  // The lamp lays a bright path across the bare ice.
  float path = exp(-abs(s.x - lamp.x) / (0.012 + depth * 0.55)) * exp(-depth * 2.5);
  color += tint(vec3(0.62, 0.8, 1.0), vec3(0.3, 0.36, 0.46)) * path * (1.0 - snow) * 0.4;
  color = mix(color, tint(vec3(0.5, 0.64, 0.82), vec3(0.88, 0.93, 0.98)), smoothstep(0.07, 0.0, depth) * 0.85);
  return color * mix(1.0, mix(0.38, 0.84, uLight), smoothstep(0.08, 0.6, depth));
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// A lone walker in front of the lamp, leaning into the wind. Signed distance in figure heights.
float walker(vec2 p) {
  float d = length(p - vec2(0.07, 0.9)) - 0.1;
  d = min(d, segment(p, vec2(0.0, 0.46), vec2(0.06, 0.76)) - 0.12);
  d = min(d, segment(p, vec2(-0.06, 0.62), vec2(-0.08, 0.78)) - 0.1);
  d = min(d, segment(p, vec2(0.0, 0.46), vec2(-0.14, 0.02)) - 0.055);
  d = min(d, segment(p, vec2(0.02, 0.46), vec2(0.15, 0.03)) - 0.055);
  d = min(d, segment(p, vec2(0.06, 0.7), vec2(0.2, 0.5)) - 0.04);
  return d;
}

// Wind-driven snow as thin streaks. Each cell holds at most one, drifting right and slightly down.
float streaks(vec2 s, float scale, float speed, float seed) {
  vec2 q = vec2(s.x * 0.16 + s.y * 0.05, s.y) * scale + vec2(-uTime * speed, uTime * speed * 0.9);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float r = hash(vec3(id, seed));
  if (r < 0.5) return 0.0;
  float reach = 0.16 + fract(r * 3.1) * 0.2;
  float across = abs(f.y - (0.15 + fract(r * 13.7) * 0.7));
  float along = abs(f.x - (0.25 + fract(r * 7.3) * 0.5));
  return smoothstep(0.07, 0.0, across) * smoothstep(reach, reach * 0.25, along) * (0.35 + fract(r * 29.0) * 0.65);
}

// Large out-of-focus flakes close to the eye, smeared sideways by the wind.
float flakes(vec2 s, float scale, float speed, float seed) {
  vec2 q = s * scale + vec2(-uTime * speed, uTime * speed * 0.3);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float r = hash(vec3(id, seed));
  if (r < 0.72) return 0.0;
  vec2 center = 0.25 + vec2(fract(r * 11.0), fract(r * 17.0)) * 0.5;
  return smoothstep(0.22, 0.04, length((f - center) * vec2(0.55, 1.0))) * (0.4 + fract(r * 5.0) * 0.6);
}

// The world beyond the horizon: a blizzard over a frozen plain, lit by a single lamp.
vec3 world(vec2 s) {
  float v = s.y - uHorizon;
  vec3 color = v >= 0.0 ? sky(s, v) : ice(s, -v);
  color += tint(vec3(0.72, 0.87, 1.0), vec3(0.95, 0.98, 1.0)) * lampGlow(s) * mix(1.0, 0.45, uLight);

  float height = 0.032;
  vec2 lamp = lampAt();
  float figure = walker((s - vec2(lamp.x - 0.004, uHorizon - 0.002)) / height);
  float edge = 1.4 / (uResolution.y * height);
  color = mix(color, tint(vec3(0.1, 0.14, 0.22), vec3(0.16, 0.2, 0.3)), smoothstep(edge, -edge, figure) * 0.9);

  float drift = s.y * 0.3;
  float fall = streaks(s, 26.0, 0.55, 1.0) + streaks(s + 3.7, 16.0, 0.4, 2.0) * 0.8 + streaks(s - 1.3, 40.0, 0.7, 3.0) * 0.5;
  float near = flakes(s + drift, 5.0, 0.6, 4.0) + flakes(s - 2.1, 8.0, 0.8, 5.0) * 0.7;
  float amount = clamp(fall * 0.42 + near * 0.22, 0.0, 1.0) * (1.0 - uDim * 0.5);
  return mix(color, tint(vec3(0.74, 0.84, 1.0), vec3(1.0, 1.0, 1.0)), amount * mix(1.0, 0.7, uLight));
}

void main() {
  float unit = min(uResolution.y, uResolution.x * 1.05);
  vec2 p = (gl_FragCoord.xy - uCenter * uResolution) / unit;
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float aspect = uResolution.x / uResolution.y;

  vec3 outside = vec3(0.0);
  if (uIris < 0.999) {
    vec4 hole = blackHole(p);
    vec3 color = hole.rgb;
    float vignette = smoothstep(1.25, 0.25, length(screen));
    vec3 dark = 1.0 - exp(-color * mix(0.55, 1.0, vignette) * 1.5);
    float luminance = dot(color, vec3(0.3, 0.55, 0.15));
    float warmth = clamp(color.r / (color.r + color.b + 0.001), 0.0, 1.0);
    vec3 ink = mix(vec3(0.33, 0.14, 0.50), vec3(0.73, 0.49, 0.12), smoothstep(0.55, 0.8, warmth));
    vec3 light = mix(vec3(0.965, 0.945, 0.905), ink, 1.0 - exp(-luminance * 1.25));
    light = mix(light, vec3(0.085, 0.05, 0.12), hole.a);
    outside = mix(dark, light, uLight);
  }

  vec3 beyond = vec3(0.0);
  if (uIris > 0.0) {
    beyond = world(screen);
    beyond *= mix(1.0, smoothstep(1.2, 0.3, length(screen)) * 0.3 + 0.7, 1.0 - uLight);
    beyond = mix(beyond, tint(beyond * 0.62, mix(beyond, vec3(0.97, 0.98, 0.94), 0.42)), uDim);
  }

  // The gate: a widening circle of gold light with the new world inside it.
  float gate = uIris * (length(vec2(aspect, 1.0)) * 0.5 + 0.3);
  float fromGate = length(screen) - gate;
  float inside = uIris >= 0.999 ? 1.0 : smoothstep(0.0, -0.12, fromGate) * step(0.0001, uIris);
  vec3 color = mix(outside, beyond, inside);
  if (uIris > 0.0 && uIris < 0.999) {
    color += vec3(1.0, 0.84, 0.54) * (exp(-abs(fromGate) * 16.0) * 1.15 + exp(-abs(fromGate) * 3.0) * 0.2);
  }
  gl_FragColor = vec4(color, 1.0);
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
 * Fixed WebGL backdrop. Scrolling along the #threshold runway flies the camera through the horizon.
 * With `fixed` set (registration and admin) it stays in the far world regardless of scroll.
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
    if (!gl) { document.documentElement.dataset.cosmos = 'off'; canvas.style.display = 'none'; return }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let program: WebGLProgram | null = null
    let uniforms: Record<string, Uniform> = {}
    let frame = 0
    let lastFrame = 0
    let slowFrames = 0
    let fastFrames = 0
    let measured = 0
    let settled = false
    let lightMix = themeRef.current === 'light' ? 1 : 0
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
    // Canvas pixels per CSS pixel. The scene is soft, so phones and weak GPUs lose little by rendering below screen resolution.
    const maxScale = lowEnd ? 0.5 : lite ? 0.65 : Math.min(window.devicePixelRatio || 1, 1.5) * 0.85
    const minScale = lite ? 0.32 : 0.42
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
      for (const name of ['uResolution', 'uCenter', 'uPointer', 'uTime', 'uDistance', 'uTilt', 'uIris', 'uHorizon', 'uDrift', 'uLight', 'uDim']) {
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
      const height = Math.max(window.innerHeight, 1)
      const runway = fixed ? null : document.getElementById('threshold')
      const box = runway?.getBoundingClientRect()
      // Before the runway the hole only drifts closer; along it the camera dives, passes the gate, and arrives.
      const travel = box ? Math.max(box.height - height, 1) : 1
      const before = box ? (box.top > 0 ? clamp01(window.scrollY / (window.scrollY + box.top)) : 1) : 1
      const dive = box ? clamp01(-box.top / travel) : 1
      const beyond = box ? Math.max(-box.top - travel, 0) / height : 2
      const untilEnd = fixed ? 9 : (document.documentElement.scrollHeight - height - window.scrollY) / height
      const landing = 1 - smooth(0, 1.1, untilEnd)

      const portrait = window.innerWidth < height * 0.95
      const restX = portrait ? 0.5 : 0.71
      const restY = portrait ? 0.74 : 0.69
      const centerBlend = smooth(0, 0.7, before)
      const fall = clamp01(dive / 0.5)
      const iris = smooth(0.54, 0.88, dive)
      settled = iris >= 1

      resize()
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height)
      gl.uniform2f(uniforms.uCenter, restX + (0.5 - restX) * centerBlend, restY + (0.5 - restY) * centerBlend)
      gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y)
      gl.uniform1f(uniforms.uTime, reducedMotion.matches ? 12 : time / 1000)
      gl.uniform1f(uniforms.uDistance, dive > 0 ? 19 - 18.2 * fall * fall : 29 - 10 * before * before)
      gl.uniform1f(uniforms.uTilt, 0.17 + 0.13 * before + 0.32 * fall)
      gl.uniform1f(uniforms.uIris, iris)
      gl.uniform1f(uniforms.uDrift, beyond)
      // The camera rises out of the gate, lifts over the page content, and comes back down at the end.
      const lifted = -0.29 + 0.17 * smooth(0.6, 1, dive) - 0.6 * smooth(0, 1, beyond)
      // At the end of the page the horizon settles on the footer's divider, so the walker stands beneath the credits.
      const divider = landing > 0 ? document.querySelector('.footer-divider')?.getBoundingClientRect() : undefined
      const ground = divider ? Math.min(Math.max(0.5 - divider.top / height, -0.6), 0.2) : -0.41
      gl.uniform1f(uniforms.uHorizon, lifted + (ground - lifted) * landing)
      gl.uniform1f(uniforms.uDim, smooth(0, 0.7, beyond) * (1 - landing * 0.55))
      gl.uniform1f(uniforms.uLight, lightMix)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // Trades resolution for frame rate, so slower machines keep moving instead of stuttering.
    // A device still too slow at the lowest resolution sheds the interface's costlier effects as well.
    const adapt = (delta: number, interval: number) => {
      const budget = Math.max(interval, 1000 / 60)
      measured += 1
      if (delta > budget * 1.8) slowFrames += 1
      else if (delta < budget * 1.15) fastFrames += 1
      if (measured < 40) return
      if (slowFrames > 20) {
        if (scale > minScale) scale = Math.max(minScale, scale * 0.78)
        else downgrade()
      } else if (fastFrames > 38 && scale < maxScale) scale = Math.min(maxScale, scale * 1.08)
      measured = slowFrames = fastFrames = 0
    }

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop)
      const targetLight = themeRef.current === 'light' ? 1 : 0
      lightMix += (targetLight - lightMix) * 0.07
      if (Math.abs(targetLight - lightMix) < 0.002) lightMix = targetLight
      pointer.x += (pointer.targetX - pointer.x) * 0.04
      pointer.y += (pointer.targetY - pointer.y) * 0.04
      // Phones and weak machines, and anyone who has arrived in the slow-moving world, get 30 frames a second.
      const interval = lite || settled ? 1000 / 30 : 0
      if (lastFrame && time - lastFrame < interval - 4) return
      if (lastFrame) adapt(time - lastFrame, interval)
      lastFrame = time
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

    if (!setup()) { document.documentElement.dataset.cosmos = 'off'; canvas.style.display = 'none'; return }
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
