/* MiniMap — radar tactical overlay */
import { useEffect, useRef } from 'react'

const NEARBY_VEHICLES = [
  { id: 'D04', type: 'dumper',    angle: 5,   dist: 0.42, speed: 16 },
  { id: 'D08', type: 'dumper',    angle: 185, dist: 0.55, speed: 20 },
  { id: 'D11', type: 'dumper',    angle: 340, dist: 0.67, speed: 22 },
  { id: 'E02', type: 'excavator', angle: 90,  dist: 0.80, speed: 14 },
]

const TYPE_COLORS = {
  dumper:    '#38bdf8', // blue
  excavator: '#f59e0b', // amber
  crusher:   '#a855f7', // purple
}

export default function MiniMap() {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const tRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const SIZE = canvas.width

    const draw = () => {
      tRef.current += 0.015
      const t = tRef.current
      const cx = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 4

      ctx.clearRect(0, 0, SIZE, SIZE)

      // Circular clip
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()

      // Background
      ctx.fillStyle = 'rgba(6, 10, 18, 0.95)'
      ctx.fillRect(0, 0, SIZE, SIZE)

      // Grid lines
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.06)'
      ctx.lineWidth = 0.5
      for (let i = -SIZE; i < SIZE * 2; i += 20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SIZE); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(SIZE, i); ctx.stroke()
      }

      // Range rings
      for (let i = 1; i <= 3; i++) {
        const r = (R / 3) * i
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.08 + (3 - i) * 0.03})`
        ctx.lineWidth = 0.7
        ctx.stroke()
        // Ring label
        if (i < 3) {
          ctx.fillStyle = 'rgba(6, 182, 212, 0.35)'
          ctx.font = '7px JetBrains Mono, monospace'
          ctx.fillText(`${i * 50}m`, cx + r + 2, cy - 2)
        }
      }

      // Cardinal directions
      ctx.fillStyle = 'rgba(6, 182, 212, 0.6)'
      ctx.font = 'bold 8px JetBrains Mono, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('N', cx, cy - R + 12)
      ctx.fillText('S', cx, cy + R - 4)
      ctx.textAlign = 'left'
      ctx.fillText('E', cx + R - 12, cy + 3)
      ctx.fillText('W', cx - R + 4, cy + 3)
      ctx.textAlign = 'center'

      // Radar sweep
      const sweepAngle = (t % (Math.PI * 2)) - Math.PI / 2
      for (let s = 0; s < 30; s++) {
        const a1 = sweepAngle - (Math.PI / 3) * (s / 30)
        const a2 = sweepAngle - (Math.PI / 3) * ((s + 1) / 30)
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R, a1, a2)
        ctx.closePath()
        ctx.fillStyle = `rgba(6, 182, 212, ${(1 - s / 30) * 0.07})`
        ctx.fill()
      }
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(sweepAngle) * R, cy + Math.sin(sweepAngle) * R)
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Nearby vehicles
      NEARBY_VEHICLES.forEach(v => {
        const angleRad = (v.angle - 90) * (Math.PI / 180)
        const realDist = v.dist + Math.sin(t * 0.5 + v.angle) * 0.02
        const vx = cx + Math.cos(angleRad) * realDist * R
        const vy = cy + Math.sin(angleRad) * realDist * R
        const color = TYPE_COLORS[v.type] || '#fff'

        // Outer glow ring
        const glow = ctx.createRadialGradient(vx, vy, 0, vx, vy, 12)
        glow.addColorStop(0, color.replace(')', ', 0.2)').replace('rgb(', 'rgba('))
        glow.addColorStop(1, 'transparent')
        ctx.fillStyle = glow
        ctx.fillRect(vx - 12, vy - 12, 24, 24)

        // Vehicle dot
        ctx.beginPath()
        ctx.arc(vx, vy, 4, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.beginPath()
        ctx.arc(vx, vy, 4, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'
        ctx.lineWidth = 0.7
        ctx.stroke()
      })

      // Own vehicle — center (pulsing)
      const pulse = 0.7 + Math.sin(t * 3) * 0.3
      ctx.beginPath()
      ctx.arc(cx, cy, 10 * pulse, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(245, 158, 11, 0.1)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#f59e0b'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, 5, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
      // Direction indicator
      ctx.beginPath()
      ctx.moveTo(cx, cy - 5)
      ctx.lineTo(cx - 3, cy - 10)
      ctx.lineTo(cx + 3, cy - 10)
      ctx.closePath()
      ctx.fillStyle = '#f59e0b'
      ctx.fill()

      ctx.restore()

      // Border ring
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div className="minimap-wrapper">
      <div className="minimap-header">
        <span>◈ PROXIMITY</span>
        <span className="mono" style={{ color: 'var(--green)', fontSize: '9px' }}>LIVE</span>
      </div>
      <canvas ref={canvasRef} width={180} height={180} className="minimap-canvas" />
      <div className="minimap-footer">
        <span className="mono" style={{ color: 'var(--amber)' }}>D-07</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span>4 NEAR</span>
      </div>
    </div>
  )
}
