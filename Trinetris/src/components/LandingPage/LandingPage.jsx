import { useState, useEffect, useRef } from 'react'
import './LandingPage.css'

function RadarBackground() {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const angleRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      const cx = width / 2
      const cy = height / 2
      const maxR = Math.max(width, height) * 0.6

      // Grid dots
      ctx.fillStyle = 'rgba(6, 182, 212, 0.04)'
      for (let x = 0; x < width; x += 40) {
        for (let y = 0; y < height; y += 40) {
          ctx.beginPath()
          ctx.arc(x, y, 1, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Radar rings
      for (let i = 1; i <= 4; i++) {
        const r = (maxR / 4) * i
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.04 + (4 - i) * 0.015})`
        ctx.lineWidth = 0.5
        ctx.stroke()
      }

      // Sweep
      angleRef.current = (angleRef.current + 0.008) % (Math.PI * 2)
      const sweepAngle = angleRef.current
      
      // Draw sweep as filled arc with fade
      ctx.save()
      ctx.translate(cx, cy)
      const arcSteps = 30
      for (let s = 0; s < arcSteps; s++) {
        const a1 = sweepAngle - (Math.PI / 4) * (s / arcSteps)
        const a2 = sweepAngle - (Math.PI / 4) * ((s + 1) / arcSteps)
        const alpha = (1 - s / arcSteps) * 0.12
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, maxR, a1, a2)
        ctx.closePath()
        ctx.fillStyle = `rgba(6, 182, 212, ${alpha})`
        ctx.fill()
      }
      // Sweep line
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(sweepAngle) * maxR, Math.sin(sweepAngle) * maxR)
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()

      // Random blips
      if (Math.random() < 0.02) {
        const bx = cx + (Math.random() - 0.5) * maxR * 1.2
        const by = cy + (Math.random() - 0.5) * maxR * 1.2
        ctx.beginPath()
        ctx.arc(bx, by, 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245, 158, 11, 0.6)'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(bx, by, 5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245, 158, 11, 0.1)'
        ctx.fill()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} className="radar-bg-canvas" />
}

function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = n => String(n).padStart(2, '0')
  return (
    <span className="mono">
      {pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}
    </span>
  )
}

export default function LandingPage({ onSelect }) {
  const [hoveredCard, setHoveredCard] = useState(null)

  return (
    <div className="landing-root">
      <RadarBackground />

      {/* Top status bar */}
      <header className="landing-header">
        <div className="lh-left">
          <div className="trinetris-logo">
            <div className="logo-icon">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <polygon points="14,2 26,22 2,22" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round"/>
                <polygon points="14,8 21,20 7,20" fill="rgba(245,158,11,0.15)" stroke="#06b6d4" strokeWidth="1" strokeLinejoin="round"/>
                <circle cx="14" cy="14" r="2" fill="#f59e0b"/>
              </svg>
            </div>
            <span className="logo-text">TRINETRIS</span>
          </div>
          <div className="logo-divider"/>
          <span className="nmdc-tag">BAILADILA SECTOR</span>
        </div>
        <div className="lh-center">
          <div className="status-item">
            <span className="status-dot active"/>
            <span>FLEET STATUS</span>
            <span className="mono text-green">23 / 27 ONLINE</span>
          </div>
        </div>
        <div className="lh-right">
          <div className="clock-block">
            <span className="clock-label">IST</span>
            <LiveClock />
          </div>
          <div className="sys-ver">v2.4.1</div>
        </div>
      </header>

      {/* Main content */}
      <main className="landing-main">
        <div className="landing-title-block">
          <div className="landing-eyebrow">SMART MINE SAFETY SYSTEM · SELECT INTERFACE</div>
          <h1 className="landing-title">
            <span className="lt-swir">SWIR</span>
            <span className="lt-plus">+</span>
            <span className="lt-radar">4D RADAR</span>
            <span className="lt-fusion">FUSION</span>
          </h1>
          <p className="landing-subtitle">
            Fog-piercing sensor fusion for safe heavy vehicle operation in adverse visibility conditions
          </p>
        </div>

        <div className="role-cards">
          {/* Vehicle Dashboard Card */}
          <button
            id="btn-vehicle-dashboard"
            className={`role-card vehicle-card ${hoveredCard === 'vehicle' ? 'hovered' : ''}`}
            onMouseEnter={() => setHoveredCard('vehicle')}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={() => onSelect('vehicle')}
          >
            <div className="card-glow vehicle-glow" />
            <div className="card-corner tl" /><div className="card-corner tr" />
            <div className="card-corner bl" /><div className="card-corner br" />

            <div className="card-icon vehicle-icon">
              <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Dumper truck silhouette */}
                <rect x="5" y="20" width="65" height="22" rx="2" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1.5"/>
                <rect x="48" y="10" width="22" height="12" rx="2" fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth="1.5"/>
                <circle cx="18" cy="44" r="6" fill="none" stroke="#f59e0b" strokeWidth="2"/>
                <circle cx="18" cy="44" r="2" fill="#f59e0b"/>
                <circle cx="57" cy="44" r="6" fill="none" stroke="#f59e0b" strokeWidth="2"/>
                <circle cx="57" cy="44" r="2" fill="#f59e0b"/>
                {/* Camera indicators */}
                <rect x="38" y="16" width="8" height="5" rx="1" fill="#06b6d4" opacity="0.8"/>
                <line x1="3" y1="30" x2="10" y2="30" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="2,2"/>
                <line x1="72" y1="30" x2="78" y2="30" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="2,2"/>
                {/* Radar arcs */}
                <path d="M 35,8 A 15,15 0 0 1 45,8" stroke="#06b6d4" strokeWidth="1" opacity="0.5" fill="none"/>
                <path d="M 30,4 A 22,22 0 0 1 50,4" stroke="#06b6d4" strokeWidth="0.8" opacity="0.3" fill="none"/>
              </svg>
            </div>

            <div className="card-badge vehicle-badge">OPERATOR VIEW</div>
            <h2 className="card-title">Vehicle<br/>Dashboard</h2>
            <p className="card-desc">
              Real-time SWIR+4D Radar fused camera feeds · 4-directional views · Obstacle detection HUD · V2V proximity minimap
            </p>

            <div className="card-features">
              <div className="cf-item"><span className="cf-dot amber"/><span>4-Camera SWIR Feeds</span></div>
              <div className="cf-item"><span className="cf-dot cyan"/><span>Radar Overlay HUD</span></div>
              <div className="cf-item"><span className="cf-dot green"/><span>V2V Proximity Minimap</span></div>
              <div className="cf-item"><span className="cf-dot amber"/><span>Split-Screen Modes</span></div>
            </div>

            <div className="card-cta">
              <span>ENTER VEHICLE VIEW</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>

          {/* Server Dashboard Card */}
          <button
            id="btn-server-dashboard"
            className={`role-card server-card ${hoveredCard === 'server' ? 'hovered' : ''}`}
            onMouseEnter={() => setHoveredCard('server')}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={() => onSelect('server')}
          >
            <div className="card-glow server-glow" />
            <div className="card-corner tl" /><div className="card-corner tr" />
            <div className="card-corner bl" /><div className="card-corner br" />

            <div className="card-icon server-icon">
              <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Mine map top view */}
                <ellipse cx="40" cy="30" rx="32" ry="18" fill="rgba(6,182,212,0.06)" stroke="#06b6d4" strokeWidth="1" strokeDasharray="3,3"/>
                <ellipse cx="40" cy="30" rx="22" ry="11" fill="rgba(6,182,212,0.08)" stroke="#06b6d4" strokeWidth="1"/>
                <ellipse cx="40" cy="30" rx="12" ry="6" fill="rgba(6,182,212,0.12)" stroke="#06b6d4" strokeWidth="1"/>
                {/* Haul roads */}
                <path d="M 8,30 Q 20,22 40,25 Q 60,28 72,30" stroke="#f59e0b" strokeWidth="1.5" fill="none" opacity="0.6"/>
                {/* Vehicles */}
                <rect x="22" y="23" width="5" height="3" rx="0.5" fill="#10b981"/>
                <rect x="45" y="27" width="5" height="3" rx="0.5" fill="#10b981"/>
                <rect x="60" y="26" width="5" height="3" rx="0.5" fill="#f59e0b"/>
                <rect x="15" y="30" width="5" height="3" rx="0.5" fill="#ef4444"/>
                {/* Signal rings */}
                <circle cx="62" cy="27" r="4" fill="none" stroke="#f59e0b" strokeWidth="0.7" opacity="0.5"/>
                <circle cx="62" cy="27" r="7" fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity="0.3"/>
                {/* Alert indicator */}
                <circle cx="17" cy="31" r="4" fill="none" stroke="#ef4444" strokeWidth="0.7" opacity="0.7"/>
                {/* Control lines */}
                <line x1="40" y1="2" x2="40" y2="12" stroke="#06b6d4" strokeWidth="0.8" opacity="0.4"/>
                <line x1="20" y1="8" x2="40" y2="12" stroke="#06b6d4" strokeWidth="0.8" opacity="0.3"/>
                <line x1="60" y1="8" x2="40" y2="12" stroke="#06b6d4" strokeWidth="0.8" opacity="0.3"/>
                <circle cx="40" cy="12" r="2.5" fill="#06b6d4" opacity="0.6"/>
              </svg>
            </div>

            <div className="card-badge server-badge">COMMAND CENTER</div>
            <h2 className="card-title">Server<br/>Dashboard</h2>
            <p className="card-desc">
              Fleet-wide monitoring · Real-time mine map · Alert management · Vehicle telemetry · Weather & sensor health
            </p>

            <div className="card-features">
              <div className="cf-item"><span className="cf-dot cyan"/><span>Live Fleet Map</span></div>
              <div className="cf-item"><span className="cf-dot amber"/><span>Alert Management</span></div>
              <div className="cf-item"><span className="cf-dot green"/><span>Vehicle Telemetry</span></div>
              <div className="cf-item"><span className="cf-dot cyan"/><span>Sensor Health Monitor</span></div>
            </div>

            <div className="card-cta server-cta">
              <span>ENTER COMMAND CENTER</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
        </div>

        {/* Bottom system info */}
        <div className="landing-footer-bar">
          <div className="lfb-item">
            <span className="lfb-label">SYSTEM</span>
            <span className="lfb-val mono">TRINETRIS EDGE-AI v2.4.1</span>
          </div>
          <div className="lfb-sep"/>
          <div className="lfb-item">
            <span className="lfb-label">SENSORS</span>
            <span className="lfb-val mono text-green">ALL NOMINAL</span>
          </div>
          <div className="lfb-sep"/>
          <div className="lfb-item">
            <span className="lfb-label">V2V MESH</span>
            <span className="lfb-val mono text-green">23 NODES CONNECTED</span>
          </div>
          <div className="lfb-sep"/>
          <div className="lfb-item">
            <span className="lfb-label">RTK-GNSS</span>
            <span className="lfb-val mono text-green">±2cm ACCURACY</span>
          </div>
          <div className="lfb-sep"/>
          <div className="lfb-item">
            <span className="lfb-label">EDGE AI</span>
            <span className="lfb-val mono text-green">27/27 UNITS ONLINE</span>
          </div>
        </div>
      </main>
    </div>
  )
}
