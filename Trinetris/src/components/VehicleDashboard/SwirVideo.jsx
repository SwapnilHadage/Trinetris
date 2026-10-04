/* SwirVideo.jsx — SWIR camera + 4D-radar fusion view.
   (Name kept so `import TwinCanvas from './SwirVideo'` in VehicleDashboard.jsx
   doesn't change.)

   How the picture is made — a software imaging pipeline, not vector art:
     1. Terrain is ray-marched per pixel column from a height-field of the haul
        road, rock berm, terraced highwall and pit. Surface texture lives in
        WORLD space (gravel, ruts, rocks, water-filled potholes), so it streams
        past at the truck's real speed and foreshortens like a real lens.
     2. It is rendered at a SWIR-sensor-like resolution, then smoothly upscaled
        (real InGaAs sensors are low-res) and passed through a dehaze + contrast
        curve — the "processed" look: stable, denoised, enhanced, monochrome.
     3. Vehicles are shaded, textured sprites (headlight bloom, hot engine),
        fogged by distance, drawn only while inside SWIR's reach (t.inSwir).
     4. 4D-radar output is overlaid on top as bounding boxes: corner brackets
        when SWIR also resolves the object; a dashed hollow box when the box is
        the only evidence (out of SWIR reach).
     5. The whole image rides the truck's suspension (sim.current.chassis):
        pitch / roll / heave from corrugation and potholes shake the camera.
*/
import { useEffect, useRef } from 'react'

const CAM_H = 3.4
const EGO = { halfW: 4, halfL: 6 }
const FACING = { FRONT: 0, RIGHT: 90, REAR: 180, LEFT: 270 }
const ORIGIN = { FRONT: [0, EGO.halfL], REAR: [0, -EGO.halfL], RIGHT: [EGO.halfW, 0], LEFT: [-EGO.halfW, 0] }
const DMAX = 260
const HAZE = 0.33
const LW_CAP = 340
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/* Potholes are shared with the suspension model in VehicleDashboard so that a
   dark puddle you watch approach is the same one that jolts the cab. */
export function pothole(i) {
  const a = Math.sin(i * 12.9898) * 43758.5453, fr = a - Math.floor(a)
  const b = Math.sin(i * 78.233) * 12345.678, fr2 = b - Math.floor(b)
  return { z: 30 + i * 34 + (fr - 0.5) * 12, u: (i % 2 ? 2.75 : -2.75) + (fr2 - 0.5) * 0.8, r: 0.8 + fr2 * 0.7 }
}

/* ── Deterministic tileable noise tables (world-space surface texture) ───── */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function makeTable(seed, lattices) {
  const T = new Float32Array(65536), R = rng(seed)
  let amp = 1
  for (const L of lattices) {
    const lat = new Float32Array(L * L)
    for (let i = 0; i < lat.length; i++) lat[i] = R()
    const cell = 256 / L
    for (let y = 0; y < 256; y++) {
      const fy = y / cell, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty)
      const ya = (y0 % L) * L, yb = ((y0 + 1) % L) * L
      for (let x = 0; x < 256; x++) {
        const fx = x / cell, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx)
        const xa = x0 % L, xb = (x0 + 1) % L
        const a = lat[ya + xa], b = lat[ya + xb], c = lat[yb + xa], d = lat[yb + xb]
        T[(y << 8) | x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
      }
    }
    amp *= 0.55
  }
  let mn = 1e9, mx = -1e9
  for (let i = 0; i < 65536; i++) { mn = Math.min(mn, T[i]); mx = Math.max(mx, T[i]) }
  for (let i = 0; i < 65536; i++) T[i] = (T[i] - mn) / (mx - mn)
  return T
}
let TF, TM, TC, FOG, LUT
function initTables() {
  if (TF) return
  TF = makeTable(11, [64, 32, 16])
  TM = makeTable(23, [16, 8, 4])
  TC = makeTable(37, [6, 3])
  FOG = new Float32Array(1100)
  for (let i = 0; i < FOG.length; i++) FOG[i] = 1 - Math.exp(-(i / 4) * 0.0042)
  // Processing curve: gentle S-curve + dehaze-style contrast stretch
  LUT = new Uint8ClampedArray(1024)
  for (let i = 0; i < 1024; i++) {
    const x = i / 1023, sm = x * x * (3 - 2 * x)
    LUT[i] = Math.round(255 * clamp((x + 0.42 * (sm - x)) * 1.08 - 0.03, 0, 1))
  }
}
function lookup(T, x, z) {
  const fx = Math.floor(x), fz = Math.floor(z), tx = x - fx, tz = z - fz
  const x0 = fx & 255, x1 = (fx + 1) & 255, z0 = (fz & 255) << 8, z1 = ((fz + 1) & 255) << 8
  const a = T[z0 + x0], b = T[z0 + x1], c = T[z1 + x0], d = T[z1 + x1]
  const top = a + (b - a) * tx
  return top + (c + (d - c) * tx - top) * tz
}

/* ── Terrain height-field (road frame: u = lateral offset from road curve) ── */
let RD = { left: -21, center: -7, right: 7, crestA: 9, crestB: 9.9, bermOut: 12.4, bermH: 1.8, bend: 0.0006 }
const crestH = zw => RD.bermH * (0.8 + 0.5 * lookup(TC, zw * 0.11 + 60, 80))
const SHELF = -6, FLOOR = -16
export function groundH(u) {
  const bo = RD.bermOut
  if (u <= bo) return 0
  if (u <= bo + 3.3) { const f = (u - bo) / 3.3; return SHELF * f * f * (3 - 2 * f) }
  if (u <= 75) return SHELF
  if (u <= 95) return SHELF + (FLOOR - SHELF) * ((u - 75) / 20)
  return FLOOR
}
const RUTS = [-16.6, -11.4, -2.75, 2.75]
let gH = 0, gI = 0, phI = 1e9, phP = null
function hash2(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function terrain(u, zw, d) {
  const nm = lookup(TM, u * 3.3 + 17, zw * 3.3 + 5)
  const nc = lookup(TC, u * 0.5 + 3, zw * 0.5 + 9)
  const fine = d < 30 ? 1 - d / 30 : 0
  const nf = fine > 0 ? TF[((((u * 20) | 0) + 91) & 255) | (((((zw * 20) | 0) + 13) & 255) << 8)] : 0.5
  const R = RD
  let h, I
  if (u < R.left) {
    // Rolling spoil hills, not a cut rock face — a smooth, continuously
    // rising slope with slow along-road undulation. No repeating steps,
    // so no "stacked block" look.
    const w = R.left - u
    const ridge = lookup(TC, zw * 0.045 + 19, 23)
    const roll = lookup(TM, zw * 0.1 + 61, w * 0.05 + 7)
    const far = clamp(w / 95, 0, 1)
    const amp = 20 + 18 * ridge
    h = Math.pow(far, 0.6) * amp + (roll - 0.5) * 5 + 0.6 * (nm - 0.5)
    I = 0.30 + 0.20 * nm + 0.08 * (ridge - 0.5) + 0.06 * (nf - 0.5) * fine
  } else if (u <= R.right) {
    h = 0.05 * (nm - 0.5) + 0.03 * (nf - 0.5) * fine
    I = 0.40 + 0.18 * (nm - 0.5) + 0.14 * (nc - 0.5) + 0.18 * (nf - 0.5) * fine
    // Worn wheel ruts
    for (let i = 0; i < 4; i++) {
      const q = u - RUTS[i]
      if (q > -0.65 && q < 0.65) { const a = Math.abs(q) / 0.65; I *= 0.72 + 0.28 * a; h -= 0.05 * (1 - a) }
    }
    // Water-filled potholes read almost black in SWIR (water absorbs it)
    if (u > -4.6 && u < 4.6) {
      const i0 = Math.round((zw - 30) / 34)
      if (i0 !== phI) { phP = pothole(i0); phI = i0 }
      const dz = (zw - phP.z) * 0.75, du = u - phP.u
      const dd = (du * du + dz * dz) / (phP.r * phP.r)
      if (dd < 1.5) {
        if (dd < 1) { const q = 1 - dd; h -= 0.11 * q; I = I * (1 - Math.min(1, q * 2.4)) + 0.07 * Math.min(1, q * 2.4) }
        else I += 0.09 * (1.5 - dd) * 2   // bright churned rim
      }
    }
    // Loose rock scatter
    if (d < 75) {
      const ci = Math.floor(zw / 5), cj = Math.floor((u + 24) / 4), hh = hash2(ci, cj)
      if (hh < 0.07) {
        const rx = (cj + 0.2 + 0.6 * hash2(cj, ci)) * 4 - 24, rz = (ci + 0.2 + 0.6 * hh * 14) * 5
        const dx = u - rx, dz = zw - rz, rr = 0.3 + 0.5 * hash2(ci + 7, cj + 3), q = (dx * dx + dz * dz) / (rr * rr)
        if (q < 1) { h += rr * 0.55 * (1 - q); I = 0.58 + 0.28 * (1 - q) - 0.16 * (dz > 0 ? 0 : 1) }
      }
    }
  } else if (u <= R.crestA) {
    const f = (u - R.right) / (R.crestA - R.right)
    h = crestH(zw) * f + 0.22 * (nm - 0.5)
    I = 0.42 + 0.30 * nm + 0.14 * (nf - 0.5) * fine
  } else if (u <= R.crestB) {
    h = crestH(zw) + 0.26 * (nm - 0.5)
    I = 0.62 + 0.26 * nm + 0.12 * (nf - 0.5) * fine
  } else if (u <= R.bermOut) {
    const f = (u - R.crestB) / (R.bermOut - R.crestB)
    h = crestH(zw) * (1 - f) + 0.22 * (nm - 0.5)
    I = 0.30 + 0.22 * nm
  } else if (u <= R.bermOut + 3.3) {
    const f = (u - R.bermOut) / 3.3
    h = SHELF * f * f * (3 - 2 * f) + 0.5 * (nm - 0.5)
    I = 0.24 + 0.22 * nm
  } else if (u <= 75) {
    h = SHELF + 0.7 * (nm - 0.5) + 0.9 * (nc - 0.5)
    I = 0.27 + 0.20 * nm + 0.10 * (nc - 0.5) + 0.08 * (nf - 0.5) * fine
  } else if (u <= 95) {
    h = groundH(u) + 0.8 * (nm - 0.5)
    I = 0.24 + 0.18 * nm
  } else if (u <= 140) {
    h = FLOOR + 1.2 * (nc - 0.5) + 0.6 * (nm - 0.5)
    I = 0.22 + 0.20 * nm
  } else {
    h = Math.min(60, FLOOR + (u - 140) * 0.8) + 2 * (nc - 0.5) + 0.8 * (nm - 0.5)
    I = 0.32 + 0.24 * nm
  }
  gH = h
  gI = I
}

/* ── Camera ───────────────────────────────────────────────────────────────── */
function makeCam(view, W, H) {
  const p = (FACING[view] * Math.PI) / 180
  const c = Math.round(Math.cos(p)), s = Math.round(Math.sin(p))
  const [ox, oz] = ORIGIN[view]
  const side = view === 'LEFT' || view === 'RIGHT'
  const f = W * (side ? 0.4 : 0.52)
  const hor = H * 0.42
  const cx = W / 2
  return {
    f, hor, cx, ox, oz, c, s,
    toCam: (x, y, z) => {
      const X = x - ox, Z = z - oz
      return { a: X * c - Z * s, d: Z * c + X * s, h: y }
    },
    proj: q => ({ x: cx + (f * q.a) / q.d, y: hor + (f * (CAM_H - q.h)) / q.d }),
  }
}

/* ── Scene buffers: low-res sensor image with an overscan margin for shake ─ */
function createScene(view, W, H, road) {
  initTables()
  RD = road
  const cam = makeCam(view, W, H)
  const lw = clamp(Math.round(W * 0.5), 120, LW_CAP)
  const k = lw / W, lh = Math.round(H * k)
  const mx = Math.ceil(lw * 0.05) + 2, my = Math.ceil(lh * 0.07) + 2
  const LWm = lw + 2 * mx, LHm = lh + 2 * my
  const canvas = document.createElement('canvas')
  canvas.width = LWm; canvas.height = LHm
  const ctx = canvas.getContext('2d')
  const acc = document.createElement('canvas')
  acc.width = LWm; acc.height = LHm
  const accCtx = acc.getContext('2d')
  const img = ctx.createImageData(LWm, LHm)
  const buf = new Uint32Array(img.data.buffer)
  const hb = my + cam.hor * k
  const skyRow = new Uint8ClampedArray(LHm)
  for (let y = 0; y < LHm; y++) {
    const t = clamp(y / hb, 0, 1)
    skyRow[y] = LUT[Math.round(clamp(0.05 + (HAZE - 0.05) * Math.pow(t, 2.4), 0, 1) * 1023)]
  }
  return { view, W, H, cam, k, lw, lh, mx, my, LWm, LHm, canvas, ctx, acc, accCtx, accReady: false, img, buf, hb, pcx: mx + (W / 2) * k, fl: cam.f * k, skyRow }
}

function renderTerrain(S, odo, gain) {
  const { buf, LWm, LHm, hb, pcx, fl, cam, skyRow } = S
  const { c, s, ox, oz } = cam
  const bend = RD.bend
  for (let y = 0; y < LHm; y++) {
    const v = skyRow[y]
    const px = 0xff000000 | (v << 16) | (v << 8) | v
    buf.fill(px, y * LWm, (y + 1) * LWm)
  }
  const dStart = Math.max(1.4, ((fl * CAM_H) / Math.max(1, LHm - hb)) * 0.92)
  const flH = fl * CAM_H
  for (let xs = 0; xs < LWm; xs++) {
    const t = (xs + 0.5 - pcx) / fl
    const dx = t * c + s, dz = -t * s + c
    let ymin = LHm, d = dStart
    while (d < DMAX && ymin > 0) {
      const X = ox + dx * d, Z = oz + dz * d
      let bx = bend * Z * Z
      if (bx > 55) bx = 55
      const u = X - bx
      const zw = Z + odo
      terrain(u, zw, d)
      const ys = hb + (flH - fl * gH) / d
      if (ys < ymin) {
        let ya = Math.ceil(ys - 0.5)
        if (ya < 0) ya = 0
        if (ya < ymin) {
          const ff = FOG[(d * 4) | 0] * 0.8
          const span = ymin - ya
          // Steep faces (wall benches) show a little banding along their
          // height — real strata, kept subtle so it reads as rock, not TV static.
          const bandAmp = span > 6 ? 0.1 : 0
          for (let y = ya; y < ymin; y++) {
            let I = gI
            if (bandAmp) {
              const hy = CAM_H - (y + 0.5 - hb) * d / fl
              I *= 1 - bandAmp + bandAmp * 2 * lookup(TC, u * 0.4 + 3, hy * 0.5 + 9)
            }
            I = (I * (1 - ff) + HAZE * ff) * gain
            const v = LUT[(clamp(I, 0, 1) * 1023) | 0]
            buf[y * LWm + xs] = 0xff000000 | (v << 16) | (v << 8) | v
          }
          ymin = ya
        }
      }
      const st = (d * d) / flH * 0.9, cap = d * 0.03
      d += st < 0.05 ? 0.05 : st > cap ? cap : st
    }
  }
  boxBlur(S.buf, S.LWm, S.LHm)
  boxBlur(S.buf, S.LWm, S.LHm)
  S.ctx.putImageData(S.img, 0, 0)
  // Blend into a short trail rather than replacing outright: real footage
  // of fast ground never fully "jumps" between samples, and it folds in a
  // touch of temporal noise reduction for free.
  if (!S.accReady) { S.accCtx.drawImage(S.canvas, 0, 0); S.accReady = true }
  else { S.accCtx.globalAlpha = 0.6; S.accCtx.drawImage(S.canvas, 0, 0); S.accCtx.globalAlpha = 1 }
}

// One 3-tap separable pass smooths per-column sampling into continuous
// tone (a real sensor's optics + upscaling do this for free).
function boxBlur(buf, w, h) {
  for (let y = 0; y < h; y++) {
    const row = y * w
    let prev = buf[row] & 0xff
    for (let x = 0; x < w; x++) {
      const c = buf[row + x] & 0xff, next = buf[row + Math.min(w - 1, x + 1)] & 0xff
      const v = (prev + c * 2 + next) >> 2
      buf[row + x] = 0xff000000 | (v << 16) | (v << 8) | v
      prev = c
    }
  }
  for (let x = 0; x < w; x++) {
    let prev = buf[x] & 0xff
    for (let y = 0; y < h; y++) {
      const idx = y * w + x, c = buf[idx] & 0xff, next = buf[Math.min(h - 1, y + 1) * w + x] & 0xff
      const v = (prev + c * 2 + next) >> 2
      buf[idx] = 0xff000000 | (v << 16) | (v << 8) | v
      prev = c
    }
  }
}

/* ── Vehicle sprites: shaded, textured, drawn once, mip-mapped ───────────── */
const g8 = (v, a = 1) => { const n = Math.round(clamp(v, 0, 1) * 255); return `rgba(${n},${n},${n},${a})` }
const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
const lg = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g }
const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h) }
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath() }
function glow(ctx, x, y, r, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.3, `rgba(255,255,255,${a * 0.5})`); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
}
let NOISE_C = null
function noiseCanvas() {
  if (NOISE_C) return NOISE_C
  const c = mkc(128, 128), x = c.getContext('2d'), img = x.createImageData(128, 128), b = new Uint32Array(img.data.buffer), R = rng(5)
  for (let i = 0; i < b.length; i++) { const v = 96 + ((R() * 90) | 0); b[i] = 0xff000000 | (v << 16) | (v << 8) | v }
  x.putImageData(img, 0, 0)
  return (NOISE_C = c)
}
function finish(c, grit = 0.13, dustFrom = 0.62) {
  // Pixel-level grit + dust: reliable everywhere (pattern+composite blending
  // is inconsistent across canvas implementations), and it's a one-time
  // bake per sprite, so the extra cost here never touches the frame loop.
  const x = c.getContext('2d'), w = c.width, h = c.height
  const img = x.getImageData(0, 0, w, h), d = img.data
  const amt = grit * 90, thresh = h * dustFrom, span = Math.max(1, h * (1 - dustFrom))
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const n = (Math.random() * 2 - 1) * amt
    let r = d[i] + n, gC = d[i + 1] + n, b = d[i + 2] + n
    const y = ((i / 4) / w) | 0
    if (y > thresh) { const k = 1 - 0.4 * clamp((y - thresh) / span, 0, 1); r *= k; gC *= k; b *= k }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r
    d[i + 1] = gC < 0 ? 0 : gC > 255 ? 255 : gC
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
  }
  x.putImageData(img, 0, 0)
  const mips = [c]
  while (mips[mips.length - 1].width > 24) {
    const p = mips[mips.length - 1], m = mkc(Math.max(1, p.width >> 1), Math.max(1, p.height >> 1))
    m.getContext('2d').drawImage(p, 0, 0, m.width, m.height)
    mips.push(m)
  }
  return mips
}

function dumperEnd(tail) {
  const c = mkc(360, 340), x = c.getContext('2d')
  const tyre = tx => {
    rrect(x, tx, 146, 94, 194, 30); x.fillStyle = lg(x, tx, 0, tx + 94, 0, [[0, g8(0.04)], [0.5, g8(0.17)], [1, g8(0.05)]]); x.fill()
    x.lineWidth = 3.2; x.strokeStyle = g8(0.32, 0.6)
    for (let i = 0; i < 9; i++) { const yy = 160 + i * 20; x.beginPath(); x.moveTo(tx + 10, yy); x.lineTo(tx + 84, yy + 5); x.stroke() }
    x.strokeStyle = g8(0.3, 0.7); x.lineWidth = 2; rrect(x, tx + 3, 149, 88, 188, 27); x.stroke()
  }
  tyre(6); tyre(260)
  if (tail) { for (const tx of [98, 202]) { rrect(x, tx, 176, 60, 160, 24); x.fillStyle = g8(0.07); x.fill() } }
  rrect(x, 92, 168, 176, 150, 10); x.fillStyle = lg(x, 0, 168, 0, 318, [[0, g8(0.48)], [1, g8(0.2)]]); x.fill()
  if (!tail) {
    rrect(x, 122, 196, 116, 72, 6); x.fillStyle = g8(0.08); x.fill()
    x.strokeStyle = g8(0.38); x.lineWidth = 3
    for (let i = 0; i < 9; i++) { const xx = 132 + i * 12; x.beginPath(); x.moveTo(xx, 200); x.lineTo(xx, 264); x.stroke() }
  } else {
    rrect(x, 120, 200, 120, 60, 6); x.fillStyle = g8(0.15); x.fill()
    x.fillStyle = g8(0.05); x.fillRect(150, 228, 60, 32)
  }
  rrect(x, 84, 292, 192, 36, 8); x.fillStyle = lg(x, 0, 292, 0, 328, [[0, g8(0.42)], [1, g8(0.16)]]); x.fill()
  rrect(x, 40, 96, 104, 84, 8); x.fillStyle = lg(x, 0, 96, 0, 180, [[0, g8(0.54)], [1, g8(0.34)]]); x.fill()
  rrect(x, 52, 108, 80, 42, 5); x.fillStyle = g8(0.09); x.fill()
  x.fillStyle = g8(0.3, 0.5); poly(x, [[52, 108], [98, 108], [72, 150], [52, 150]]); x.fill()
  poly(x, [[22, 26], [338, 26], [354, 118], [354, 148], [6, 148], [6, 118]])
  x.fillStyle = lg(x, 0, 26, 0, 148, [[0, g8(0.72)], [0.55, g8(0.5)], [1, g8(0.28)]]); x.fill()
  x.strokeStyle = g8(0.92, 0.85); x.lineWidth = 3; x.beginPath(); x.moveTo(24, 28); x.lineTo(336, 28); x.stroke()
  x.strokeStyle = g8(0.16, 0.55); x.lineWidth = 2
  for (let i = 1; i < 7; i++) { const xx = 6 + i * 49; x.beginPath(); x.moveTo(xx, 32); x.lineTo(xx, 146); x.stroke() }
  if (!tail) {
    for (const lx of [110, 250]) { glow(x, lx, 240, 54, 0.75); x.fillStyle = 'rgba(255,255,255,0.97)'; x.beginPath(); x.arc(lx, 240, 11, 0, 7); x.fill() }
  } else {
    for (const lx of [104, 256]) { x.fillStyle = g8(0.62); x.fillRect(lx - 12, 270, 24, 14); glow(x, lx, 277, 26, 0.3) }
  }
  glow(x, 300, 20, 30, 0.55)   // hot exhaust stack
  return finish(c)
}
function dumperSide() {
  const c = mkc(520, 300), x = c.getContext('2d')
  const wheel = (cx, cy, r) => {
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fillStyle = g8(0.06); x.fill()
    x.lineWidth = 5; x.strokeStyle = g8(0.2); x.beginPath(); x.arc(cx, cy, r - 6, 0, 7); x.stroke()
    x.beginPath(); x.arc(cx, cy, r * 0.42, 0, 7); x.fillStyle = lg(x, cx - 30, cy - 30, cx + 30, cy + 30, [[0, g8(0.5)], [1, g8(0.22)]]); x.fill()
    x.strokeStyle = g8(0.3, 0.6); x.lineWidth = 2
    for (let a = 0; a < 12; a++) { const t = (a / 12) * 6.283; x.beginPath(); x.moveTo(cx + Math.cos(t) * (r - 9), cy + Math.sin(t) * (r - 9)); x.lineTo(cx + Math.cos(t) * (r - 1), cy + Math.sin(t) * (r - 1)); x.stroke() }
  }
  rrect(x, 30, 170, 470, 44, 8); x.fillStyle = lg(x, 0, 170, 0, 214, [[0, g8(0.42)], [1, g8(0.18)]]); x.fill()
  poly(x, [[16, 148], [156, 130], [166, 182], [16, 188]]); x.fillStyle = lg(x, 0, 130, 0, 188, [[0, g8(0.52)], [1, g8(0.3)]]); x.fill()
  rrect(x, 48, 58, 104, 76, 8); x.fillStyle = lg(x, 0, 58, 0, 134, [[0, g8(0.55)], [1, g8(0.36)]]); x.fill()
  rrect(x, 58, 68, 66, 40, 5); x.fillStyle = g8(0.09); x.fill()
  poly(x, [[36, 44], [304, 34], [304, 60], [36, 70]]); x.fillStyle = g8(0.5); x.fill()
  poly(x, [[150, 68], [500, 26], [510, 150], [162, 170]]); x.fillStyle = lg(x, 0, 26, 0, 170, [[0, g8(0.72)], [0.6, g8(0.46)], [1, g8(0.28)]]); x.fill()
  x.strokeStyle = g8(0.92, 0.8); x.lineWidth = 3; x.beginPath(); x.moveTo(152, 68); x.lineTo(500, 27); x.stroke()
  x.strokeStyle = g8(0.16, 0.5); x.lineWidth = 2
  for (let i = 1; i < 7; i++) { const xx = 150 + i * 50; x.beginPath(); x.moveTo(xx, 70 - i * 6); x.lineTo(xx + 6, 168); x.stroke() }
  wheel(112, 214, 80); wheel(396, 214, 80)
  rrect(x, 372, 168, 40, 92, 10); x.fillStyle = g8(0.09); x.fill()
  glow(x, 128, 34, 34, 0.6)
  return finish(c, 0.13, 0.66)
}
function excavatorEnd() {
  const c = mkc(320, 340), x = c.getContext('2d')
  for (const tx of [16, 206]) {
    rrect(x, tx, 236, 98, 104, 14); x.fillStyle = g8(0.07); x.fill()
    x.strokeStyle = g8(0.28, 0.7); x.lineWidth = 2.5
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(tx + 6, 246 + i * 16); x.lineTo(tx + 92, 246 + i * 16); x.stroke() }
  }
  rrect(x, 40, 120, 240, 128, 12); x.fillStyle = lg(x, 0, 120, 0, 248, [[0, g8(0.54)], [1, g8(0.28)]]); x.fill()
  rrect(x, 52, 78, 100, 70, 8); x.fillStyle = g8(0.46); x.fill(); rrect(x, 62, 88, 78, 40, 5); x.fillStyle = g8(0.09); x.fill()
  poly(x, [[132, 30], [192, 30], [206, 136], [122, 136]]); x.fillStyle = lg(x, 0, 30, 0, 136, [[0, g8(0.6)], [1, g8(0.32)]]); x.fill()
  x.strokeStyle = g8(0.2, 0.7); x.lineWidth = 3; x.beginPath(); x.moveTo(146, 40); x.lineTo(140, 134); x.moveTo(178, 40); x.lineTo(184, 134); x.stroke()
  poly(x, [[112, 168], [208, 168], [222, 252], [98, 252]]); x.fillStyle = g8(0.1); x.fill()
  x.strokeStyle = g8(0.5, 0.8); x.lineWidth = 3; x.beginPath(); x.moveTo(112, 168); x.lineTo(208, 168); x.stroke()
  glow(x, 240, 150, 36, 0.5)
  return finish(c)
}
function excavatorSide() {
  const c = mkc(520, 360), x = c.getContext('2d')
  rrect(x, 40, 252, 380, 92, 44); x.fillStyle = g8(0.07); x.fill()
  x.strokeStyle = g8(0.27, 0.7); x.lineWidth = 3
  for (let i = 0; i < 24; i++) { const xx = 58 + i * 15.5; x.beginPath(); x.moveTo(xx, 258); x.lineTo(xx - 5, 338); x.stroke() }
  for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(84 + i * 60, 300, 18, 0, 7); x.fillStyle = g8(0.24); x.fill() }
  rrect(x, 56, 128, 270, 132, 12); x.fillStyle = lg(x, 0, 128, 0, 260, [[0, g8(0.54)], [1, g8(0.28)]]); x.fill()
  rrect(x, 26, 150, 66, 104, 10); x.fillStyle = g8(0.32); x.fill()
  x.strokeStyle = g8(0.16, 0.6); x.lineWidth = 2.5
  for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(110, 146 + i * 14); x.lineTo(230, 146 + i * 14); x.stroke() }
  rrect(x, 250, 84, 92, 84, 8); x.fillStyle = g8(0.48); x.fill(); rrect(x, 266, 96, 60, 46, 5); x.fillStyle = g8(0.09); x.fill()
  poly(x, [[300, 160], [318, 130], [462, 44], [480, 72], [332, 178]]); x.fillStyle = lg(x, 0, 44, 0, 178, [[0, g8(0.62)], [1, g8(0.34)]]); x.fill()
  poly(x, [[452, 40], [488, 58], [516, 170], [488, 176]]); x.fillStyle = g8(0.42); x.fill()
  poly(x, [[470, 150], [516, 160], [508, 246], [452, 236]]); x.fillStyle = g8(0.12); x.fill()
  x.strokeStyle = g8(0.55, 0.8); x.lineWidth = 3; x.beginPath(); x.moveTo(304, 158); x.lineTo(462, 44); x.stroke()
  glow(x, 150, 140, 34, 0.5)
  return finish(c, 0.13, 0.7)
}
function rockSprite() {
  const c = mkc(200, 140), x = c.getContext('2d')
  const stone = (pts, b) => { poly(x, pts); x.fillStyle = lg(x, 0, 0, 90, 140, [[0, g8(b + 0.28)], [1, g8(b - 0.1)]]); x.fill(); x.strokeStyle = g8(b + 0.32, 0.7); x.lineWidth = 2.5; x.stroke() }
  stone([[6, 132], [16, 74], [58, 42], [104, 62], [112, 132]], 0.36)
  stone([[70, 134], [92, 40], [132, 12], [176, 48], [194, 134]], 0.42)
  stone([[120, 136], [140, 96], [176, 88], [198, 136]], 0.3)
  return finish(c, 0.16, 0.7)
}
let SPR = null
function sprites() {
  if (SPR) return SPR
  SPR = {
    dumperNose: { m: dumperEnd(false), dims: [7, 6.6] }, dumperTail: { m: dumperEnd(true), dims: [7, 6.6] },
    dumperSide: { m: dumperSide(), dims: [11.4, 6.6] },
    excNose: { m: excavatorEnd(), dims: [5, 5.3] }, excSide: { m: excavatorSide(), dims: [7.5, 5.2] },
    rock: { m: rockSprite(), dims: [2.8, 1.95] },
  }
  return SPR
}
function spriteFor(t, view) {
  const camZ = view === 'FRONT' ? 1 : view === 'REAR' ? -1 : 0
  if (t.kind === 'debris') return { key: 'rock', flip: false }
  if (camZ !== 0) {
    if (t.kind === 'dumper') return { key: t.dir * camZ < 0 ? 'dumperNose' : 'dumperTail', flip: false }
    return { key: 'excNose', flip: false }
  }
  const frontRight = view === 'RIGHT' ? t.dir === -1 : t.dir === 1
  return { key: t.kind === 'dumper' ? 'dumperSide' : 'excSide', flip: frontRight }
}
// The object's on-screen rect. The radar box uses exactly this rect too.
function targetRect(cam, t, dims) {
  const gh = groundH(t.u)
  const qb = cam.toCam(t.x, gh, t.z)
  if (qb.d < 2) return null
  const sb = cam.proj(qb), st = cam.proj({ ...qb, h: gh + dims[1] })
  const halfW = (cam.f * (dims[0] / 2)) / qb.d
  return { x: sb.x - halfW, y: st.y, w: halfW * 2, h: sb.y - st.y }
}

// Drawn every rAF (not throttled with the terrain regen) directly in
// full-resolution screen space, in the same shaken transform as the radar
// boxes — a separate low-res pass would get wiped by the next terrain
// repaint before ever reaching the screen.
function drawSprites(ctx, S, sim, range) {
  const { cam, view, W } = S
  const SP = sprites()
  const list = sim.targets
    .filter(t => t.dist <= range && t.inSwir)
    .map(t => ({ t, d: cam.toCam(t.x, 0, t.z).d }))
    .filter(o => o.d >= 2 && Math.abs(cam.toCam(o.t.x, 0, o.t.z).a) < o.d * 2.2)
    .sort((a, b) => b.d - a.d)
  for (const { t } of list) {
    const sp = spriteFor(t, view), def = SP[sp.key]
    const r = targetRect(cam, t, def.dims)
    if (!r) continue
    const bx = r.x, by = r.y, bw = r.w, bh = r.h
    if (bw < 1.2 || bx > W || bx + bw < 0) continue
    const fade = t.swirLim ? clamp((t.swirLim - t.dist) / 12, 0, 1) : 1
    const fog = 1 - 0.7 * FOG[Math.min(1099, (t.dist * 4) | 0)]
    // soft contact shadow
    ctx.save()
    ctx.globalAlpha = 0.5 * fade
    const sg = ctx.createRadialGradient(bx + bw / 2, by + bh, 0, bx + bw / 2, by + bh, bw * 0.62)
    sg.addColorStop(0, 'rgba(0,0,0,0.75)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.translate(0, by + bh); ctx.scale(1, 0.16); ctx.translate(0, -(by + bh))
    ctx.fillStyle = sg; ctx.fillRect(bx - bw * 0.2, by + bh - bw * 0.62, bw * 1.4, bw * 1.24)
    ctx.restore()
    const lvl = clamp(Math.floor(Math.log2(def.m[0].width / Math.max(1, bw))), 0, def.m.length - 1)
    ctx.save()
    // Vehicles run hot against cool terrain — SWIR renders them as the
    // brightest things in frame, so push a soft bloom plus extra gain.
    ctx.globalAlpha = 0.3 * fade * fog
    const bloom = ctx.createRadialGradient(bx + bw / 2, by + bh * 0.4, 0, bx + bw / 2, by + bh * 0.4, bw * 0.85)
    bloom.addColorStop(0, 'rgba(255,255,255,0.9)'); bloom.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = bloom
    ctx.fillRect(bx - bw * 0.3, by - bh * 0.3, bw * 1.6, bh * 1.6)
    ctx.globalAlpha = fade * fog
    ctx.imageSmoothingEnabled = true
    ctx.filter = 'brightness(1.3) contrast(1.12)'
    if (sp.flip) { ctx.translate(bx + bw, by); ctx.scale(-1, 1); ctx.drawImage(def.m[lvl], 0, 0, bw, bh) }
    else ctx.drawImage(def.m[lvl], bx, by, bw, bh)
    ctx.filter = 'none'
    ctx.restore()
  }
}

/* ── Overlays drawn in image space (they ride the shake with the picture) ── */
function drawPill(ctx, P, W, text, x, y, color, px = 12) {
  ctx.font = `700 ${px}px ${P.font}`
  const w = ctx.measureText(text).width + 22, h = px + 11
  const lx = clamp(x - w / 2, 4, W - w - 4), ly = y - h
  ctx.save()
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(lx, ly, w, h, 6) : ctx.rect(lx, ly, w, h)
  ctx.clip()
  ctx.fillStyle = P.glass
  ctx.fillRect(lx, ly, w, h)
  ctx.fillStyle = color
  ctx.fillRect(lx, ly, 4, h)
  ctx.restore()
  ctx.fillStyle = P.text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, lx + 11, ly + h / 2 + 0.5)
}
function placePill(ctx, P, W, placed, text, cx, top, color) {
  ctx.font = `700 12px ${P.font}`
  const pw = ctx.measureText(text).width + 22, ph = 23
  const px = clamp(cx - pw / 2, 4, W - pw - 4)
  let py = top - ph, moved = true
  while (moved) {
    moved = false
    for (const r of placed) if (px < r.x + r.w && px + pw > r.x && py < r.y + r.h && py + ph > r.y) { py = r.y + r.h + 3; moved = true }
  }
  placed.push({ x: px, y: py, w: pw, h: ph })
  drawPill(ctx, P, W, text, px + pw / 2, py + ph, color, 12)
}

// SAR-map overlay: the berm crest (the drop-off edge) as a thin guide line.
function drawBermLine(ctx, S, road, odo, W, P) {
  const cam = S.cam
  const crestX = (road.crestA + road.crestB) / 2
  ctx.beginPath()
  let pen = false
  for (let z = -150; z <= 150; z += 3) {
    const bx = clamp(road.bend * z * z, -55, 55)
    const q = cam.toCam(crestX + bx, crestH(z + odo) + 0.05, z)
    if (q.d < 2.5) { pen = false; continue }
    const p = cam.proj(q)
    if (p.x < -60 || p.x > W + 60) { pen = false; continue }
    pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)
    pen = true
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = 4.5; ctx.stroke()
  ctx.strokeStyle = P.caution; ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1
}

function drawFusionBox(ctx, P, W, t, box, placed) {
  const col = P[t.sev], pad = 5
  const x = box.x - pad, y = box.y - pad, w = box.w + pad * 2, h = box.h + pad * 2
  ctx.save()
  ctx.lineJoin = 'round'
  if (t.inSwir) {
    const L = clamp(Math.min(w, h) * 0.26, 8, 28)
    const corners = () => {
      ctx.beginPath()
      for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
        ctx.moveTo(px + sx * L, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * L)
      }
    }
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.25; ctx.strokeRect(x, y, w, h); ctx.globalAlpha = 1
    corners(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5.5; ctx.stroke()
    corners(); ctx.strokeStyle = col; ctx.lineWidth = t.sev === 'danger' ? 3.5 : 2.75; ctx.stroke()
  } else {
    ctx.globalAlpha = 0.07; ctx.fillStyle = col; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1
    ctx.setLineDash([7, 5])
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4.5; ctx.strokeRect(x, y, w, h)
    ctx.strokeStyle = col; ctx.lineWidth = t.sev === 'danger' ? 3 : 2.25; ctx.strokeRect(x, y, w, h)
  }
  ctx.restore()
  if (W < 460) return
  placePill(ctx, P, W, placed, `${t.label} · ${Math.round(t.dist)} m · ${t.inSwir ? 'SWIR+RADAR' : 'RADAR ONLY'}`, x + w / 2, y, col)
}

function drawRadarLayer(ctx, S, road, sim, P, range) {
  const { cam, view, W } = S
  const roadX = z => clamp(road.bend * z * z, -55, 55)
  const front = view === 'FRONT', rear = view === 'REAR'
  const placed = []

  drawBermLine(ctx, S, road, sim.odo, W, P)
  if (W >= 460) {
    const sgn = front ? 1 : rear ? -1 : 0
    const q = cam.toCam((road.crestA + road.crestB) / 2 + roadX(sgn * 24), 2.4, sgn * 24)
    if (q.d > 3) {
      const p = cam.proj(q)
      if (p.x > 0 && p.x < W && (view !== 'LEFT')) placePill(ctx, P, W, placed, view === 'RIGHT' ? `Berm · ${(road.right - EGO.halfW).toFixed(1)} m` : 'Berm', p.x, p.y, P.caution)
    }
    if (view === 'LEFT') {
      const q2 = cam.toCam(road.left, 3, 0)
      if (q2.d > 3) { const p2 = cam.proj(q2); placePill(ctx, P, W, placed, `Wall · ${(-road.left - EGO.halfW).toFixed(1)} m`, p2.x, p2.y, P.text) }
    }
  }

  if (front || rear) {
    const dir = front ? 1 : -1
    let sev = 'ok'
    for (const t of sim.targets) if (t.inPath && Math.sign(t.z) === dir && t.dist <= range)
      sev = t.sev === 'danger' || sev === 'danger' ? 'danger' : t.sev === 'caution' || sev === 'caution' ? 'caution' : 'ok'
    if (sev !== 'ok') {   // quiet unless something in the lane needs flagging
      const pts = (x0, x1) => {
        const out = []
        for (let z = EGO.halfL; z <= range; z += Math.max(1.5, z * 0.06)) {
          const zz = dir * z
          const a = cam.toCam(x0 + roadX(zz), 0.03, zz), b = cam.toCam(x1 + roadX(zz), 0.03, zz)
          if (a.d > 1.4) out.push([cam.proj(a), cam.proj(b)])
        }
        return out
      }
      const rows = pts(-4.6, 4.6)
      ctx.beginPath()
      rows.forEach(([a], i) => (i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y)))
      for (let i = rows.length - 1; i >= 0; i--) ctx.lineTo(rows[i][1].x, rows[i][1].y)
      ctx.closePath()
      ctx.globalAlpha = 0.16; ctx.fillStyle = P[sev]; ctx.fill(); ctx.globalAlpha = 1
      ctx.strokeStyle = P[sev]; ctx.lineWidth = 2.25; ctx.globalAlpha = 0.85
      for (const side of [0, 1]) {
        ctx.beginPath()
        rows.forEach((r, i) => (i ? ctx.lineTo(r[side].x, r[side].y) : ctx.moveTo(r[side].x, r[side].y)))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }

  const list = sim.targets
    .filter(t => t.dist <= range)
    .map(t => ({ t, c: cam.toCam(t.x, 0, t.z) }))
    .filter(o => o.c.d >= 2 && Math.abs(o.c.a) < o.c.d * 2.3)
    .sort((a, b) => b.c.d - a.c.d)
  const SP = sprites()
  for (const { t } of list) {
    const box = targetRect(cam, t, SP[spriteFor(t, view).key].dims)
    if (box) drawFusionBox(ctx, P, W, t, box, placed)
  }
}

/* ── Suspension → camera shake ───────────────────────────────────────────── */
// A slow, smooth envelope (a function of distance, not time) so some
// stretches of haul road ride calmer and others buzz harder — genuine
// randomness in intensity rather than one constant vibration level.
function roughness(odo) {
  const a = Math.sin(odo * 0.017) * 0.5 + Math.sin(odo * 0.041 + 1.3) * 0.3 + Math.sin(odo * 0.097 + 2.6) * 0.2
  return clamp(0.45 + a * 0.6, 0.25, 1.3)
}

function shakeFor(view, sim, S, now, reduce) {
  const ch = sim.chassis
  if (!ch || reduce) return { dx: 0, dy: 0, rot: 0 }
  const f = S.cam.f, K = 1.5, rg = roughness(sim.odo)
  const flutter = (Math.sin(now * 0.047 + view.length) * 0.35 + Math.sin(now * 0.113 + 1.7) * 0.2) * (0.5 + 0.5 * rg)
  let dy, rot
  if (view === 'FRONT') { dy = f * ch.pitch * K; rot = -ch.roll * 1.7 }
  else if (view === 'REAR') { dy = -f * ch.pitch * K; rot = ch.roll * 1.7 }
  else if (view === 'RIGHT') { dy = -f * ch.roll * K; rot = ch.pitch * 1.7 }
  else { dy = f * ch.roll * K; rot = -ch.pitch * 1.7 }
  dy = dy * rg + f * ch.heave * 0.09 * rg + flutter
  rot *= rg
  const dx = f * ch.yaw * rg + flutter * 0.6
  const lim = Math.min(S.mx, S.my) / S.k * 0.55
  return { dx: clamp(dx, -lim, lim), dy: clamp(dy, -lim, lim), rot: clamp(rot, -0.032, 0.032) }
}

// A hint of the cab itself at the bottom of the forward view — grounds the
// driver in the vehicle, the way the reference footage shows the bonnet.
function drawHood(ctx, W, H) {
  const top = H * 0.87
  ctx.save()
  const g = ctx.createLinearGradient(0, top, 0, H)
  g.addColorStop(0, 'rgba(6,6,6,0)')
  g.addColorStop(0.3, 'rgba(6,6,6,0.8)')
  g.addColorStop(1, 'rgba(3,3,3,0.96)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-W * 0.04, H + 2)
  ctx.lineTo(W * 0.18, top)
  ctx.lineTo(W * 0.82, top)
  ctx.lineTo(W * 1.04, H + 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(190,190,190,0.3)'
  ctx.lineWidth = Math.max(1, H * 0.0035)
  ctx.beginPath()
  ctx.moveTo(W * 0.18, top); ctx.lineTo(W * 0.82, top)
  ctx.stroke()
  ctx.restore()
}

/* One complete frame: scene → shake → radar layer → sensor optics. */
export function paintFrame(ctx, S, sim, road, P, range, now, dpr, reduce) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const { W, H } = S
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)
  const sh = shakeFor(S.view, sim, S, now, reduce)
  ctx.save()
  ctx.translate(W / 2 + sh.dx, H / 2 + sh.dy)
  ctx.rotate(sh.rot)
  ctx.translate(-W / 2, -H / 2)
  ctx.imageSmoothingEnabled = true
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(S.accReady ? S.acc : S.canvas, -S.mx / S.k, -S.my / S.k, S.LWm / S.k, S.LHm / S.k)
  if (P.gain < 0.999) { ctx.fillStyle = `rgba(0,0,0,${(1 - P.gain).toFixed(3)})`; ctx.fillRect(-40, -40, W + 80, H + 80) }
  drawSprites(ctx, S, sim, range)
  drawRadarLayer(ctx, S, road, sim, P, range)
  if (S.view === 'FRONT') drawHood(ctx, W, H)
  ctx.restore()

  // Sensor optics are fixed to the camera housing, so they don't shake.
  if (!S.vig || S.vigW !== W || S.vigH !== H) {
    const v = document.createElement('canvas'); v.width = W; v.height = H
    const vx = v.getContext('2d')
    const g = vx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.74)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)')
    vx.fillStyle = g; vx.fillRect(0, 0, W, H)
    S.vig = v; S.vigW = W; S.vigH = H
  }
  ctx.drawImage(S.vig, 0, 0, W, H)
  const nz = noiseCanvas(), step = Math.floor(now / 90)
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.05
  ctx.drawImage(nz, (step * 37) % 64, (step * 53) % 64, 64, 64, 0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.font = `700 10px ${P.font}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('SWIR 1550nm · 4D RADAR FUSION', 10, H - 10)
}

export function readPalette(el) {
  const cs = getComputedStyle(el)
  const g = n => cs.getPropertyValue(n).trim()
  return {
    font: cs.fontFamily || 'sans-serif',
    glass: g('--vd-glass'), text: g('--vd-text'),
    ok: g('--vd-ok'), caution: g('--vd-caution'), danger: g('--vd-danger'),
    gain: parseFloat(g('--tw-gain')) || 1,
  }
}
export { createScene, renderTerrain, drawSprites }

function TwinCanvas({ view, sim, road, theme, range = 100 }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let raf, dpr = 1, S = null, P = null, last = 0
    const setup = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = canvas.clientWidth, H = canvas.clientHeight
      if (!W || !H) return
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      P = readPalette(canvas)
      S = createScene(view, W, H, road)
      last = 0
    }
    setup()
    const ro = new ResizeObserver(setup)
    ro.observe(canvas)
    const frame = now => {
      if (S) {
        if (now - last >= 55) {      // sensor refresh ≈ 18 fps for the heavy terrain pass; vehicles, shake and radar boxes redraw every rAF regardless, so motion still reads smooth
          renderTerrain(S, sim.current.odo, 1)
          last = now
        }
        paintFrame(ctx, S, sim.current, road, P, range, now, dpr, mq && mq.matches)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [view, sim, road, theme, range])

  return <canvas ref={ref} className="vd-canvas" />
}

export default TwinCanvas
