import { useEffect, useRef } from 'react'

// Haul road path waypoints (normalized 0-1 coordinates)
const HAUL_ROAD = [
  [0.08, 0.55], [0.15, 0.48], [0.25, 0.42], [0.38, 0.40],
  [0.50, 0.45], [0.62, 0.48], [0.72, 0.44], [0.82, 0.38], [0.92, 0.35]
]

const SECONDARY_ROAD = [
  [0.38, 0.40], [0.40, 0.28], [0.45, 0.20], [0.52, 0.18], [0.60, 0.22]
]

const DUMP_ROAD = [
  [0.25, 0.42], [0.22, 0.62], [0.20, 0.72]
]

// Mine pit terraces
const PIT_RINGS = [
  { cx: 0.62, cy: 0.65, rx: 0.22, ry: 0.15 },
  { cx: 0.62, cy: 0.65, rx: 0.16, ry: 0.10 },
  { cx: 0.62, cy: 0.65, rx: 0.10, ry: 0.06 },
]

// Loading zone, dump zone, parking
const ZONES = [
  { x: 0.45, y: 0.14, w: 0.18, h: 0.10, label: 'LOADING', color: 'rgba(16,185,129,0.12)' },
  { x: 0.08, y: 0.68, w: 0.18, h: 0.12, label: 'DUMP ZONE', color: 'rgba(245,158,11,0.08)' },
  { x: 0.75, y: 0.70, w: 0.16, h: 0.12, label: 'PARKING', color: 'rgba(6,182,212,0.06)' },
]

const INITIAL_VEHICLE_POSITIONS = [
  { id: 'D-01', t: 0.12, road: 'main', direction: 1, status: 'warning' },
  { id: 'D-02', t: 0.22, road: 'main', direction: 1, status: 'active' },
  { id: 'D-04', t: 0.60, road: 'main', direction: -1, status: 'active' },
  { id: 'D-07', t: 0.44, road: 'main', direction: -1, status: 'active' },
  { id: 'D-08', t: 0.38, road: 'main', direction: 1, status: 'active' },
  { id: 'D-11', t: 0.08, road: 'main', direction: 1, status: 'active' },
  { id: 'D-15', t: 0.85, road: 'main', direction: 1, status: 'alert' },
  { id: 'D-03', t: 0.55, road: 'dump', direction: -1, status: 'stopped' },
  { id: 'E-02', t: 0.65, road: 'main', direction: -1, status: 'active' },
  { id: 'E-07', t: 0.75, road: 'main', direction: 1, status: 'warning' },
]

const STATUS_COLORS = {
  active:  '#10b981',
  warning: '#f97316',
  alert:   '#ef4444',
  stopped: '#475569',
}

function interpolatePath(path, t) {
  const clamped = Math.max(0, Math.min(1, t))
  const segCount = path.length - 1
  const rawIdx = clamped * segCount
  const idx = Math.floor(rawIdx)
  const frac = rawIdx - idx
  if (idx >= segCount) return path[segCount]
  const [x1, y1] = path[idx]
  const [x2, y2] = path[Math.min(idx + 1, segCount)]
  return [x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac]
}

function getRoad(roadId) {
  if (roadId === 'dump') return DUMP_ROAD
  if (roadId === 'secondary') return SECONDARY_ROAD
  return HAUL_ROAD
}

export default function FleetMap({ vehicles, onSelectVehicle, selectedId }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const tRef = useRef(0)
  const positionsRef = useRef(INITIAL_VEHICLE_POSITIONS.map(v => ({ ...v })))
  const clickHandlerRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const draw = () => {
      tRef.current += 0.0008
      const t = tRef.current
      const W = canvas.width
      const H = canvas.height

      // Background — mine terrain
      ctx.fillStyle = '#080e18'
      ctx.fillRect(0, 0, W, H)

      // Terrain gradient
      const terrGrad = ctx.createLinearGradient(0, 0, W, H)
      terrGrad.addColorStop(0, 'rgba(20, 35, 25, 0.4)')
      terrGrad.addColorStop(0.5, 'rgba(15, 28, 20, 0.3)')
      terrGrad.addColorStop(1, 'rgba(10, 20, 15, 0.2)')
      ctx.fillStyle = terrGrad
      ctx.fillRect(0, 0, W, H)

      // Grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.04)'
      ctx.lineWidth = 0.5
      for (let x = 0; x < W; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      for (let y = 0; y < H; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }

      // Topographic Contour Lines (replaces simple ellipses)
      const drawContour = (cx, cy, radiusX, radiusY, noise, color) => {
        ctx.beginPath()
        for (let a = 0; a <= Math.PI * 2; a += 0.1) {
          const r = 1 + Math.sin(a * 4 + t) * noise + Math.cos(a * 7) * (noise * 0.5)
          const px = cx * W + Math.cos(a) * radiusX * W * r
          const py = cy * H + Math.sin(a) * radiusY * H * r
          if (a === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = color.replace(/[^,]+(?=\))/, '0.02') // very faint fill
        ctx.fill()
      }

      for (let i = 8; i > 0; i--) {
        drawContour(0.62, 0.65, 0.05 + i * 0.03, 0.04 + i * 0.02, 0.05, `rgba(148, 163, 184, ${0.1 + i * 0.02})`)
      }



      // Pit label
      ctx.fillStyle = 'rgba(245, 158, 11, 0.4)'
      ctx.font = `bold 9px "JetBrains Mono", monospace`
      ctx.textAlign = 'center'
      ctx.fillText('OPEN PIT', PIT_RINGS[0].cx * W, (PIT_RINGS[0].cy + PIT_RINGS[0].ry + 0.03) * H)

      // Zones
      ZONES.forEach(z => {
        ctx.fillStyle = z.color
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H)
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font = '8px "JetBrains Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(z.label, (z.x + z.w / 2) * W, (z.y + z.h / 2) * H + 3)
      })

      // Helper: draw haul road
      const drawRoad = (path, color, width, dash) => {
        ctx.beginPath()
        path.forEach(([px, py], i) => {
          const x = px * W, y = py * H
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        if (dash) ctx.setLineDash(dash)
        else ctx.setLineDash([])
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Road shadows
      drawRoad(HAUL_ROAD, 'rgba(0,0,0,0.4)', 10)
      drawRoad(SECONDARY_ROAD, 'rgba(0,0,0,0.3)', 7)
      drawRoad(DUMP_ROAD, 'rgba(0,0,0,0.3)', 7)

      // Road surface
      drawRoad(HAUL_ROAD, 'rgba(50, 70, 55, 0.8)', 8)
      drawRoad(SECONDARY_ROAD, 'rgba(45, 65, 50, 0.7)', 5)
      drawRoad(DUMP_ROAD, 'rgba(45, 65, 50, 0.7)', 5)

      // Road center line
      drawRoad(HAUL_ROAD, 'rgba(245, 158, 11, 0.25)', 1, [8, 8])
      drawRoad(SECONDARY_ROAD, 'rgba(245, 158, 11, 0.15)', 0.8, [6, 6])

      // Road edges
      drawRoad(HAUL_ROAD, 'rgba(16, 185, 129, 0.2)', 0.8)

      // KM markers on main road
      HAUL_ROAD.forEach(([px, py], i) => {
        if (i === 0 || i % 2 === 0) {
          const x = px * W, y = py * H
          ctx.beginPath()
          ctx.arc(x, y, 3, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(245, 158, 11, 0.4)'
          ctx.fill()
          ctx.fillStyle = 'rgba(245,158,11,0.5)'
          ctx.font = '7px "JetBrains Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(`KM ${i * 0.7 | 0}.${((i * 0.7 % 1) * 10) | 0}`, x, y - 8)
        }
      })



      // Move & draw vehicles
      positionsRef.current = positionsRef.current.map(vp => {
        const matchedVeh = vehicles.find(v => v.id === vp.id)
        const speed = matchedVeh?.speed ?? 0
        const moving = speed > 2
        let newT = vp.t
        if (moving) {
           newT = vp.t + (speed * 0.000015 * vp.direction)
           // Reverse direction if reaching end of path
           if (newT >= 1 || newT <= 0) {
             vp.direction *= -1
             newT = Math.max(0, Math.min(1, newT))
           }
        }
        return { ...vp, t: newT, status: matchedVeh?.status ?? vp.status }
      })

      positionsRef.current.forEach(vp => {
        const road = getRoad(vp.road)
        const [nx, ny] = interpolatePath(road, vp.t)
        const px = nx * W, py = ny * H
        const color = STATUS_COLORS[vp.status] || '#888'
        const isSelected = vp.id === selectedId

        // Glow
        ctx.save()
        ctx.globalAlpha = 0.25
        ctx.beginPath()
        ctx.arc(px, py, isSelected ? 20 : 12, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.restore()

        // Alert pulse
        if (vp.status === 'alert' || vp.status === 'warning') {
          const pulseR = 10 + Math.sin(t * 8 + vp.t * 10) * 5
          ctx.beginPath()
          ctx.arc(px, py, pulseR, 0, Math.PI * 2)
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.globalAlpha = 0.4 + Math.sin(t * 8) * 0.3
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        // Selection ring
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(px, py, 14, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        // Vehicle dot
        ctx.beginPath()
        ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.beginPath()
        ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.lineWidth = 0.8
        ctx.stroke()

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.font = `${isSelected ? 'bold ' : ''}8px "JetBrains Mono", monospace`
        ctx.textAlign = 'center'
        ctx.fillText(vp.id, px, py - 10)
      })



      rafRef.current = requestAnimationFrame(draw)
    }

    // Click handler to select vehicles
    const handleClick = (e) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const W = canvas.width
      const H = canvas.height

      for (const vp of positionsRef.current) {
        const road = getRoad(vp.road)
        const [nx, ny] = interpolatePath(road, vp.t)
        const px = nx * W, py = ny * H
        if (Math.hypot(mx - px, my - py) < 14) {
          onSelectVehicle?.(vp.id)
          return
        }
      }
    }

    canvas.addEventListener('click', handleClick)
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener('click', handleClick)
      ro.disconnect()
    }
  }, [selectedId, onSelectVehicle, vehicles])

  return (
    <canvas
      ref={canvasRef}
      className="fleet-map-canvas"
      style={{ cursor: 'crosshair' }}
    />
  )
}
