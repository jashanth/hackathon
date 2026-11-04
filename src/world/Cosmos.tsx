import { useEffect, useRef } from 'react'

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

// Scene 1: a black hole, traced by bending each view ray around a unit-radius horizon.
// Scene 2: the world on the far side of it: sky, ringed planet, spires, and a mirror sea.
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
uniform float uRetreat;

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

float ridge(float x) {
  return 0.55 * sin(x) + 0.3 * sin(x * 2.13 + 1.3) + 0.17 * sin(x * 4.37 + 0.7) + 0.09 * sin(x * 9.1 + 2.1) + 0.05 * sin(x * 17.3);
}

// Sharp-crested mountain profile between 0 and about 1.
float crags(float x, float seed) {
  float height = 0.0;
  float amplitude = 0.56;
  for (int i = 0; i < 4; i++) {
    height += amplitude * (1.0 - abs(2.0 * noise(vec2(x, seed)) - 1.0));
    x *= 2.07;
    amplitude *= 0.48;
  }
  return height;
}

// Everything above the waterline. v is the height above the horizon.
vec3 landscape(vec2 s, float v, float detail) {
  float aspect = uResolution.x / uResolution.y;
  float t = clamp(v / 1.15, 0.0, 1.0);
  vec3 horizon = tint(vec3(0.96, 0.69, 0.36), vec3(1.0, 0.87, 0.68));
  vec3 plum = tint(vec3(0.42, 0.16, 0.38), vec3(0.93, 0.79, 0.84));
  vec3 middle = tint(vec3(0.06, 0.075, 0.29), vec3(0.72, 0.76, 0.93));
  vec3 zenith = tint(vec3(0.007, 0.014, 0.075), vec3(0.52, 0.6, 0.86));
  // Gold passes through plum on its way to blue, so the sunset never turns a muddy grey.
  vec3 color = mix(horizon, plum, smoothstep(0.0, 0.13, t));
  color = mix(color, middle, smoothstep(0.08, 0.36, t));
  color = mix(color, zenith, smoothstep(0.26, 0.95, t));

  vec2 sun = vec2(aspect * 0.27, uHorizon + 0.052);
  float sunDistance = length(s - sun);
  color += tint(vec3(1.0, 0.68, 0.34), vec3(1.0, 0.8, 0.5)) * (exp(-sunDistance * 4.5) * 0.42 + exp(-sunDistance * 26.0) * 0.5);
  if (detail > 0.5) color = mix(color, vec3(1.0, 0.92, 0.72), smoothstep(0.036, 0.032, sunDistance));

  if (detail > 0.5) {
    color += starfield(normalize(vec3(s + vec2(uDrift * 0.03, 0.0), 1.0))) * (1.0 - uLight) * smoothstep(0.12, 0.55, t);
    float band = (v - 0.66 - 0.1 * sin(s.x * 1.7 + uTime * 0.07 + uDrift * 0.3)) / 0.21;
    float curtain = noise(vec2(s.x * 4.5 + uTime * 0.05, uTime * 0.03 + v * 1.2));
    float aurora = exp(-band * band) * curtain * curtain * (1.0 - uDim * 0.55);
    color = mix(color, tint(mix(vec3(0.46, 0.34, 0.95), vec3(0.88, 0.7, 0.38), smoothstep(0.55, 0.95, v)), vec3(0.56, 0.5, 0.9)), clamp(aurora * 0.6, 0.0, 1.0));

    // A vast ringed planet, mostly in shadow, lit along one edge. It retreats to the corner while content is on screen.
    vec2 planet = mix(vec2(-aspect * 0.27, uHorizon + 0.53), vec2(aspect * 0.42, 0.42), uRetreat) + vec2(uDrift * 0.01, 0.0);
    float presence = 1.0 - uRetreat * 0.72;
    vec2 rel = (s - planet) / 0.27;
    vec2 tilted = vec2(rel.x * 0.94 + rel.y * 0.34, rel.y * 0.94 - rel.x * 0.34);
    float ellipse = length(vec2(tilted.x, tilted.y * 4.0));
    float rings = smoothstep(1.32, 1.4, ellipse) * smoothstep(2.35, 2.18, ellipse) * (0.62 + 0.26 * sin(ellipse * 31.0) + 0.12 * sin(ellipse * 67.0));
    vec3 ringColor = tint(vec3(0.95, 0.8, 0.54), vec3(0.58, 0.46, 0.24));
    float distanceToPlanet = length(rel);
    vec3 toSun = normalize(vec3(sun - planet, 0.25));
    if (tilted.y > 0.0) color = mix(color, ringColor, rings * 0.55 * presence);
    if (distanceToPlanet < 1.0) {
      vec3 normal = vec3(rel, sqrt(max(1.0 - distanceToPlanet * distanceToPlanet, 0.0)));
      float lit = clamp(dot(normal, toSun), 0.0, 1.0);
      float bands = 0.5 + 0.5 * sin(tilted.y * 11.0 + noise(tilted * 2.5) * 2.5);
      vec3 surface = tint(mix(vec3(0.5, 0.36, 0.17), vec3(0.84, 0.68, 0.4), bands), mix(vec3(0.72, 0.64, 0.48), vec3(0.9, 0.84, 0.68), bands));
      vec3 shaded = surface * lit * lit * mix(1.15, 0.55, uLight) + tint(vec3(0.006, 0.008, 0.032), vec3(0.54, 0.55, 0.7));
      float limb = pow(1.0 - normal.z, 5.0) * smoothstep(-0.2, 0.7, dot(normalize(vec3(rel, 0.0)), toSun));
      shaded += tint(vec3(1.0, 0.82, 0.5), vec3(0.8, 0.62, 0.3)) * limb * 0.85;
      color = mix(color, shaded, smoothstep(1.0, 0.99, distanceToPlanet) * presence);
    } else {
      float limbGlow = exp(-(distanceToPlanet - 1.0) * 16.0) * smoothstep(-0.2, 0.7, dot(normalize(vec3(rel, 0.0)), toSun));
      color += tint(vec3(0.95, 0.72, 0.4), vec3(0.3, 0.22, 0.08)) * limbGlow * 0.38 * presence;
    }
    if (tilted.y <= 0.0) color = mix(color, ringColor, rings * 0.7 * presence);
  }

  // Three depths of land: misty mountains, a skyline of spires, the dark near shore.
  float far = 0.006 + 0.1 * pow(crags(s.x * 1.5 + uDrift * 0.02 + 3.0, 1.0), 2.2);
  if (v < far + 0.004) {
    vec3 rock = tint(vec3(0.04, 0.042, 0.14), vec3(0.62, 0.63, 0.82));
    vec3 misted = mix(rock, horizon, smoothstep(far * 0.8, -0.005, v) * 0.72);
    misted += tint(vec3(1.0, 0.7, 0.36), vec3(0.2, 0.14, 0.04)) * exp(-(far - v) * 130.0) * exp(-abs(s.x - sun.x) * 1.3) * 0.5;
    color = mix(color, misted, smoothstep(far + 0.002, far - 0.002, v));
  }

  float across = s.x * 62.0 + uDrift * 0.2;
  float id = floor(across);
  float offset = fract(across) - 0.5;
  float seed = hash(vec3(id, 3.0, 1.0));
  float cluster = smoothstep(-0.1, 0.9, sin(s.x * 2.3 - 1.4) + 0.45 * sin(s.x * 6.7));
  float spire = 0.012 + (0.022 * seed + pow(seed, 7.0) * 0.27) * (0.25 + 0.75 * cluster);
  if (v < spire + 0.003) {
    float width = (0.14 + 0.3 * seed) * (1.0 - clamp(v / spire, 0.0, 1.0) * 0.86);
    float inSpire = smoothstep(width + 0.05, width - 0.05, abs(offset)) * smoothstep(spire + 0.002, spire - 0.002, v);
    float mist = smoothstep(0.05, 0.0, v);
    color = mix(color, mix(tint(vec3(0.01, 0.013, 0.05), vec3(0.25, 0.27, 0.5)), horizon, mist * 0.3), inSpire);
    float row = floor(v * 420.0);
    float windowLit = step(0.8, hash(vec3(id, row, 2.0))) * step(0.5, fract(v * 420.0));
    color += tint(vec3(1.0, 0.78, 0.44), vec3(0.24, 0.16, 0.04)) * windowLit * inSpire * 0.5;
  }
  if (seed > 0.86) {
    vec2 tip = vec2((id + 0.5 - uDrift * 0.2) / 62.0, uHorizon + spire);
    color += tint(vec3(1.0, 0.84, 0.54), vec3(0.42, 0.3, 0.08)) * exp(-length(s - tip) * 480.0) * 0.9;
  }

  float near = 0.008 + 0.018 * pow(crags(s.x * 4.2 + uDrift * 0.2 + 9.0, 5.0), 1.5);
  color = mix(color, tint(vec3(0.004, 0.006, 0.026), vec3(0.2, 0.22, 0.45)), smoothstep(near + 0.002, near - 0.002, v));
  return color;
}

// The world beyond the horizon: land and sky above, the same scene mirrored in moving water below.
vec3 world(vec2 s) {
  float v = s.y - uHorizon;
  if (v >= 0.0) return landscape(s, v, 1.0);
  float depth = -v;
  float aspect = uResolution.x / uResolution.y;
  float wave = noise(vec2(s.x * 16.0, depth * 180.0 / (1.0 + depth * 6.0) - uTime * 0.3)) - 0.5;
  vec2 mirrored = vec2(s.x + wave * (0.004 + depth * 0.07), uHorizon + depth * 1.05 + abs(wave) * depth * 0.1);
  vec3 color = landscape(mirrored, mirrored.y - uHorizon, 0.0);
  color = mix(color, tint(vec3(0.004, 0.009, 0.05), vec3(0.62, 0.66, 0.86)), clamp(0.3 + depth * 2.1, 0.0, 0.9));
  float path = exp(-abs(s.x - aspect * 0.27) / (0.035 + depth * 0.42));
  // Stretched noise makes the sparkle read as flat streaks lying on the water.
  float rows = depth * 300.0 / (1.0 + depth * 5.0) - uTime * 0.7;
  float glint = pow(noise(vec2(s.x * 11.0 + wave, rows)) * noise(vec2(s.x * 27.0, rows * 1.7 + 4.0)), 2.0) * 16.0;
  color += tint(vec3(1.0, 0.76, 0.42), vec3(1.0, 0.92, 0.72)) * path * glint * 0.42;
  return color;
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
    let tick = 0
    let lastFrame = 0
    let slowFrames = 0
    let fastFrames = 0
    let measured = 0
    let settled = false
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
      for (const name of ['uResolution', 'uCenter', 'uPointer', 'uTime', 'uDistance', 'uTilt', 'uIris', 'uHorizon', 'uDrift', 'uLight', 'uDim', 'uRetreat']) {
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
      gl.uniform1f(uniforms.uHorizon, lifted + (-0.41 - lifted) * landing)
      gl.uniform1f(uniforms.uDim, smooth(0, 0.7, beyond) * (1 - landing * 0.55))
      gl.uniform1f(uniforms.uRetreat, smooth(0, 0.7, beyond))
      gl.uniform1f(uniforms.uLight, lightMix)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // Trades resolution for frame rate, so slower machines keep moving instead of stuttering.
    const adapt = (delta: number) => {
      measured += 1
      if (delta > 30) slowFrames += 1
      else if (delta < 18) fastFrames += 1
      if (measured < 40) return
      if (slowFrames > 20 && scale > 0.42) scale = Math.max(0.42, scale * 0.78)
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
      // Once arrived the world moves slowly, so half the frames are enough.
      if (settled && tick % 2) return
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
