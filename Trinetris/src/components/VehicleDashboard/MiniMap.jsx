/* MiniMap — heading-up proximity radar.
   Reads the same live data as the camera views (sim ref), so every
   distance, colour and sector on this radar matches the cameras and alerts.
   A dashed SWIR-range ring marks the boundary the camera views use too:
   objects inside it are solid (SWIR + radar fused), objects between the
   ring and the outer edge are hollow/dashed (radar-only, same language
   as the dashed boxes on the camera tiles). */
import { useEffect, useRef, useState } from 'react'

const SIZE = 232

export default function MiniMap({ sim, road, range = 100, swirRange = 55, theme, mapAge = 4 }) {
  const canvasRef = useRef(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      const list = sim.current.targets
      setCount(list.filter(t => t.dist <= range).length)
    }, 300)
    return () => clearInterval(id)
  }, [sim, range])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sim) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const cs = getComputedStyle(canvas)
    const v = n => cs.getPropertyValue(n).trim()
    const C = {
      bg: v('--vd-surface-2'), road: v('--tw-road'), line: v('--vd-line'),
      text: v('--vd-text'), muted: v('--vd-text-2'), accent: v('--vd-accent'),
      berm: v('--tw-berm-crest'), wall: v('--tw-wall'), surface: v('--vd-surface'),
      ok: v('--vd-ok'), caution: v('--vd-caution'), danger: v('--vd-danger'),
    }
    const font = cs.fontFamily || 'sans-serif'
    const cx = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 3, k = R / range
    const P = (x, z) => [cx + x * k, cy - z * k]
    const bend = z => road.bend * z * z
    const crest = (road.crestA + road.crestB) / 2

    const halo = (text, x, y, align, size, color, weight = 600) => {
      ctx.font = `${weight} ${size}px ${font}`
      ctx.textAlign = align
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3.5
      ctx.strokeStyle = C.bg
      ctx.lineJoin = 'round'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = color
      ctx.fillText(text, x, y)
    }

    const line = (fn, color, w, dash) => {
      ctx.beginPath()
      for (let z = -range; z <= range; z += 4) {
        const [px, py] = P(fn(z), z)
        z === -range ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.setLineDash(dash || [])
      ctx.stroke()
      ctx.setLineDash([])
    }

    let raf
    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = C.bg
      ctx.fillRect(0, 0, SIZE, SIZE)

      // Road surface (from the drone SAR site map)
      ctx.beginPath()
      for (let z = -range; z <= range; z += 4) {
        const [px, py] = P(road.left + bend(z), z)
        z === -range ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      for (let z = range; z >= -range; z -= 4) {
        const [px, py] = P(road.right + bend(z), z)
        ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = C.road
      ctx.globalAlpha = 0.55
      ctx.fill()
      ctx.globalAlpha = 1
      line(z => road.center + bend(z), C.muted, 1, [4, 5])
      line(z => road.left + bend(z), C.wall, 3)
      line(z => crest + bend(z), C.berm, 3)

      // Range rings
      ;[25, 50, 75, 100].forEach(m => {
        if (m >= range) return
        ctx.beginPath()
        ctx.arc(cx, cy, m * k, 0, Math.PI * 2)
        ctx.strokeStyle = C.line
        ctx.lineWidth = 1
        ctx.stroke()
      })
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = C.line
      ctx.lineWidth = 1
      ctx.stroke()

      // SWIR-range ring — inside it objects are solid (fused), outside dashed (radar-only)
      ctx.beginPath()
      ctx.arc(cx, cy, swirRange * k, 0, Math.PI * 2)
      ctx.strokeStyle = C.muted
      ctx.lineWidth = 1.3
      ctx.setLineDash([3, 4])
      ctx.stroke()
      ctx.setLineDash([])

      ;[[50, 1], [100, 0.86]].forEach(([m, pull]) => {
        if (m > range) return
        const a = (38 * Math.PI) / 180
        halo(`${m} m`, cx + Math.sin(a) * m * k * pull, cy - Math.cos(a) * m * k * pull, 'center', 10.5, C.muted, 500)
      })

      // Camera sectors
      ctx.strokeStyle = C.line
      ctx.lineWidth = 1
      ;[45, 135, 225, 315].forEach(deg => {
        const a = (deg * Math.PI) / 180
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R)
        ctx.stroke()
      })
      halo('Front', cx, cy - R + 13, 'center', 11.5, C.text)
      halo('Rear', cx, cy + R - 13, 'center', 11.5, C.text)
      ;[['Left', -1], ['Right', 1]].forEach(([text, side]) => {
        ctx.save()
        ctx.translate(cx + side * (R - 9), cy)
        ctx.rotate((side * Math.PI) / 2)
        halo(text, 0, 0, 'center', 11.5, C.text)
        ctx.restore()
      })

      // Tracked objects — solid = SWIR+radar fused, dashed/hollow = radar-only
      sim.current.targets.forEach(t => {
        if (t.dist > range) return
        const [x, y] = P(t.x, t.z)
        const col = C[t.sev]
        ctx.lineWidth = 2
        ctx.strokeStyle = t.inSwir ? C.surface : col
        ctx.beginPath()
        if (t.kind === 'dumper') ctx.roundRect ? ctx.roundRect(x - 5, y - 7, 10, 14, 2) : ctx.rect(x - 5, y - 7, 10, 14)
        else if (t.kind === 'excavator') ctx.rect(x - 6, y - 6, 12, 12)
        else { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath() }
        if (t.inSwir) {
          ctx.fillStyle = col
          ctx.fill()
          ctx.stroke()
        } else {
          ctx.setLineDash([2.5, 2.5])
          ctx.stroke()
          ctx.setLineDash([])
        }
        const right = x < cx + R * 0.35
        halo(`${t.label} ${Math.round(t.dist)}`, right ? x + 11 : x - 11, y, right ? 'left' : 'right', 11, C.text, 700)
      })

      // Own vehicle
      ctx.fillStyle = C.accent
      ctx.strokeStyle = C.surface
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy - 11)
      ctx.lineTo(cx + 7, cy + 8)
      ctx.lineTo(cx - 7, cy + 8)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()

      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = C.line
      ctx.lineWidth = 2
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [sim, road, range, swirRange, theme])

  return (
    <section className="vd-card vd-radar" aria-label="Nearby vehicles and road edges">
      <div className="vd-card-head">
        <strong>Around you</strong>
        <span>{count} within {range} m</span>
      </div>
      <canvas ref={canvasRef} className="vd-radar-canvas" />
      <div className="vd-radar-key">
        <span><i className="key-line berm" />Berm</span>
        <span><i className="key-dash" />SWIR {swirRange}m</span>
        <span className="vd-radar-age">Map {mapAge} min old</span>
      </div>
    </section>
  )
}
