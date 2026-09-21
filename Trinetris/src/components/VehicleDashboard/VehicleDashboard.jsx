import { useState, useEffect, useRef } from 'react'
import MiniMap from './MiniMap'
import './VehicleDashboard.css'

const VIEWS = ['FRONT', 'LEFT', 'RIGHT', 'BACK']

const SPLIT_MODES = [
  { id: 'single', label: 'SINGLE', icon: '▣' },
  { id: 'hsplit', label: 'H-SPLIT', icon: '⬒' },
  { id: 'vsplit', label: 'V-SPLIT', icon: '⬓' },
  { id: 'quad',   label: 'QUAD',   icon: '⊞' },
  { id: 'focus3', label: '1+3',    icon: '⊟' },
]

const VIEW_META = {
  FRONT: { label: 'FRONT CAM', dir: '↑', heading: '228°', dist: '42 m', veh: 'D-04' },
  LEFT:  { label: 'LEFT CAM',  dir: '←', heading: '138°', dist: '—',    veh: null },
  RIGHT: { label: 'RIGHT CAM', dir: '→', heading: '318°', dist: '81 m', veh: 'E-02' },
  BACK:  { label: 'REAR CAM',  dir: '↓', heading: '048°', dist: '55 m', veh: 'D-08' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Realistic SWIR 1550 nm + 4D 77 GHz Radar Sensor Fusion Canvas
//
// 1. MINE SCENE: Open-pit haul road with highwalls (rock cliffs), berms, 
//    and a wide ore-compacted road. 
// 2. SWIR VISUALS: True monochromatic representation. High-contrast grayscale, 
//    pitch-black sky, sharp textures bypassing fog, glowing heat signatures,
//    heavy sensor grain.
// 3. MULTIPLE OBJECTS: Vehicles moving at realistic speeds, staying at safe 
//    distances, plus static obstacles.
// 4. RADAR FUSION: 4D point cloud clusters mapped onto physical surfaces, 
//    colored by Doppler (relative velocity).
// ─────────────────────────────────────────────────────────────────────────────
function SensorFusionCanvas({ view }) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const tRef      = useRef(0)
  const noiseRef  = useRef(null)

  // Pre-generate SWIR sensor grain (InGaAs read noise)
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = 512; c.height = 512
    const ctx = c.getContext('2d')
    const imgData = ctx.createImageData(c.width, c.height)
    const buf = new Uint32Array(imgData.data.buffer)
    for (let i = 0; i < buf.length; i++) {
      // High-frequency monochrome noise
      const v = Math.random() * 255
      buf[i] = (255 << 24) | (v << 16) | (v << 8) | v
    }
    ctx.putImageData(imgData, 0, 0)
    noiseRef.current = c
  }, [])

  // Scene state: multiple tracked objects
  const sceneObjects = useRef([
    // Primary vehicle (tracked by HUD)
    { id: 'D-07', type: 'HVY-DUMP', lane: 0.5, z: 60, speed: 0, isPrimary: true },
    // Oncoming vehicle
    { id: 'D-02', type: 'HVY-DUMP', lane: -0.6, z: 120, speed: -8, isPrimary: false },
    // Static obstacle (rock)
    { id: 'ROCK', type: 'DEBRIS', lane: 0.8, z: 80, speed: -4, isPrimary: false }
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })

    // Helper: Draw HUD tracking bracket
    function drawTrackerBox(x, y, w, h, color, bracketLen = 12) {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + bracketLen, y); ctx.lineTo(x, y); ctx.lineTo(x, y + bracketLen)
      ctx.moveTo(x + w - bracketLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bracketLen)
      ctx.moveTo(x + bracketLen, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - bracketLen)
      ctx.moveTo(x + w - bracketLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - bracketLen)
      ctx.stroke()
      
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x + w/2 - 4, y + h/2); ctx.lineTo(x + w/2 + 4, y + h/2)
      ctx.moveTo(x + w/2, y + h/2 - 4); ctx.lineTo(x + w/2, y + h/2 + 4)
      ctx.stroke()
    }

    const draw = () => {
      const { width: W, height: H } = canvas
      tRef.current += 0.016
      const t = tRef.current
      const dir = view === 'BACK' ? -1 : 1
      const isSide = view === 'LEFT' || view === 'RIGHT'
      
      const horizon = H * 0.45
      const cx = W / 2

      // ──────────────────────────────────────────────────────────
      // 1. SWIR OPTICAL BASE (High-contrast Monochromatic)
      // ──────────────────────────────────────────────────────────
      
      // Sky: Pitch black (SWIR completely absorbed by atmospheric water vapor)
      ctx.fillStyle = '#020202'
      ctx.fillRect(0, 0, W, horizon)
      
      // Horizon scattering (very slight grayish band where fog meets ground)
      const hazeG = ctx.createLinearGradient(0, horizon - 20, 0, horizon + 5)
      hazeG.addColorStop(0, '#020202')
      hazeG.addColorStop(0.8, '#1e2124')
      hazeG.addColorStop(1, '#111214')
      ctx.fillStyle = hazeG
      ctx.fillRect(0, horizon - 20, W, 25)

      if (!isSide) {
        // --- MINE SCENE GENERATION ---
        
        // Road surface (compacted ore, medium SWIR reflectance)
        const roadWTop = W * 0.15
        const roadWBot = W * 0.9
        const curve = Math.sin(t * 0.1) * W * 0.05
        const vanX = cx + curve

        ctx.fillStyle = '#2a2d32' // Grayscale road base
        ctx.beginPath()
        ctx.moveTo(vanX - roadWTop, horizon)
        ctx.lineTo(vanX + roadWTop, horizon)
        ctx.lineTo(cx + roadWBot, H)
        ctx.lineTo(cx - roadWBot, H)
        ctx.fill()

        // Tire tracks (darker gray, smoothed out)
        ctx.strokeStyle = '#1d1f22'
        ctx.lineWidth = W * 0.1
        ctx.beginPath()
        ctx.moveTo(vanX - roadWTop*0.5, horizon); ctx.lineTo(cx - roadWBot*0.5 + curve*0.3, H)
        ctx.moveTo(vanX + roadWTop*0.5, horizon); ctx.lineTo(cx + roadWBot*0.5 + curve*0.3, H)
        ctx.stroke()

        // Highwalls (steep rocky cliffs on sides of the open pit)
        // Highly reflective in SWIR due to exposed minerals, stark shadows
        ctx.fillStyle = '#3a3e45'
        ctx.beginPath()
        ctx.moveTo(0, H)
        ctx.lineTo(cx - roadWBot, H)
        ctx.lineTo(vanX - roadWTop, horizon)
        ctx.lineTo(vanX - roadWTop - W*0.1, horizon - H*0.1)
        ctx.lineTo(0, horizon - H*0.2)
        ctx.fill()

        ctx.fillStyle = '#32353b'
        ctx.beginPath()
        ctx.moveTo(W, H)
        ctx.lineTo(cx + roadWBot, H)
        ctx.lineTo(vanX + roadWTop, horizon)
        ctx.lineTo(vanX + roadWTop + W*0.1, horizon - H*0.15)
        ctx.lineTo(W, horizon - H*0.25)
        ctx.fill()

        // Draw striations/terraces on the highwalls
        ctx.strokeStyle = '#111215'
        ctx.lineWidth = 2
        for (let i = 1; i <= 4; i++) {
          const y = horizon + (H-horizon) * (i/5)
          const lw = cx - roadWBot*(i/5)
          const rw = cx + roadWBot*(i/5)
          ctx.beginPath(); ctx.moveTo(0, y - H*0.1); ctx.lineTo(lw, y); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(W, y - H*0.15); ctx.lineTo(rw, y); ctx.stroke()
        }

        // Safety berms (crushed bright rock lining the road edge)
        ctx.strokeStyle = '#4f555e'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(vanX - roadWTop, horizon); ctx.lineTo(cx - roadWBot, H)
        ctx.moveTo(vanX + roadWTop, horizon); ctx.lineTo(cx + roadWBot, H)
        ctx.stroke()

        // Update and sort objects by depth (painters algorithm)
        const egoSpeed = 4 // Ego vehicle speed simulation
        const objects = sceneObjects.current
        
        objects.forEach(obj => {
          // Relative motion
          if (dir === 1) { // FRONT view
            obj.z += (obj.speed - egoSpeed) * 0.016
          } else { // BACK view
            obj.z += (egoSpeed - obj.speed) * 0.016
          }
          
          // Respawn logic to keep scene active without collisions
          if (obj.z < 10 || obj.z > 150) {
            if (obj.isPrimary) {
              obj.z = 40 + Math.random()*20 // Keep primary vehicle at a safe following distance
              obj.speed = egoSpeed + (Math.random()-0.5)*2
            } else if (obj.type === 'HVY-DUMP') {
              obj.z = 150
              obj.speed = -8 // Fast oncoming
            } else if (obj.type === 'DEBRIS') {
              obj.z = 150
              obj.lane = (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random()*0.3)
            }
          }
        })

        objects.sort((a, b) => b.z - a.z)

        // Render Objects
        objects.forEach(obj => {
          if (obj.z > 150 || obj.z < 5) return // Cull
          
          const depthFrac = 1 - (obj.z / 150)
          const sc = 15 / obj.z // Perspective scale
          
          const objGY = horizon + (H - horizon) * Math.pow(depthFrac, 2)
          
          // Base width at horizon vs bottom
          const currentRoadW = roadWTop + (roadWBot - roadWTop) * depthFrac
          const laneOffset = obj.lane * currentRoadW
          
          const objX = cx + (vanX - cx)*depthFrac + laneOffset

          if (obj.type === 'HVY-DUMP') {
            const objW = 350 * sc
            const objH = 280 * sc
            const objTY = objGY - objH
            const lx = objX - objW/2

            // SWIR Silhouette 
            ctx.fillStyle = '#0a0b0d' // Dark metal body
            
            // Dump Bed
            ctx.beginPath()
            ctx.moveTo(lx - objW*0.05, objTY + objH*0.2)
            ctx.lineTo(lx + objW*1.05, objTY + objH*0.2)
            ctx.lineTo(lx + objW, objTY + objH*0.6)
            ctx.lineTo(lx, objTY + objH*0.6)
            ctx.closePath()
            ctx.fill()
            
            // Chassis
            ctx.fillRect(lx + objW*0.15, objTY + objH*0.5, objW*0.7, objH*0.35)
            
            // Cab
            ctx.fillStyle = '#121418'
            ctx.fillRect(lx + objW*0.2, objTY + objH*0.1, objW*0.25, objH*0.4)
            
            // Tires (Rubber absorbs SWIR, pitch black)
            ctx.fillStyle = '#000000'
            const tw = objW*0.22, th = objH*0.28
            ctx.fillRect(lx + objW*0.05, objGY - th, tw, th)
            ctx.fillRect(lx + objW*0.73, objGY - th, tw, th)

            // SWIR Heat Signatures (Radiator / Exhaust glow bright white)
            const exX = lx + objW*0.6
            const exY = objTY + objH*0.4
            const exG = ctx.createRadialGradient(exX, exY, 0, exX, exY, 50*sc)
            exG.addColorStop(0, `rgba(255,255,255,${0.9 + Math.sin(t*8)*0.1})`)
            exG.addColorStop(0.4, 'rgba(200,210,220,0.5)')
            exG.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = exG
            ctx.beginPath(); ctx.arc(exX, exY, 50*sc, 0, Math.PI*2); ctx.fill()

            // ──────────────────────────────────────────────────────────
            // 4D RADAR POINT CLOUD FUSION (Target mapped)
            // ──────────────────────────────────────────────────────────
            const nPts = Math.floor(100 * depthFrac * depthFrac)
            
            ctx.globalCompositeOperation = 'screen'
            for (let i = 0; i < nPts; i++) {
              const px = lx - objW*0.1 + Math.random() * objW*1.2
              const py = objTY + Math.random() * objH
              
              // Doppler Coloring
              // Cyan/Green for approaching, Orange/Red for receding
              const relativeSpeed = obj.speed - egoSpeed
              let color = relativeSpeed < 0 ? `rgba(0, 255, 200, 0.9)` : `rgba(255, 120, 50, 0.9)`
              
              // Highlight edges to simulate structural radar returns
              if (Math.random() < 0.2) color = `rgba(255, 255, 255, 1)`
              
              ctx.fillStyle = color
              const pSize = (1.5 + Math.random()*2) * Math.max(0.5, sc*10)
              ctx.fillRect(px, py, pSize, pSize)
              
              // Velocity Vectors
              if (i % 8 === 0) {
                ctx.strokeStyle = color.replace('0.9', '0.4')
                ctx.lineWidth = 0.8
                ctx.beginPath()
                ctx.moveTo(px, py)
                ctx.lineTo(px, py + relativeSpeed * 2 * sc*10)
                ctx.stroke()
              }
            }
            ctx.globalCompositeOperation = 'source-over'

            // Fusion HUD for primary target
            if (obj.isPrimary) {
              const pad = objW * 0.05
              const bx = lx - pad, by = objTY - pad
              const bw = objW + pad*2, bh = objH + pad*1.5
              
              drawTrackerBox(bx, by, bw, bh, 'rgba(0, 255, 170, 0.85)', bw * 0.15)
              
              const labelX = bx
              const labelY = by - 38
              ctx.fillStyle = 'rgba(5, 8, 12, 0.85)'
              ctx.fillRect(labelX, labelY, 155, 34)
              ctx.strokeStyle = 'rgba(0, 255, 170, 0.5)'
              ctx.lineWidth = 1
              ctx.strokeRect(labelX, labelY, 155, 34)
              
              ctx.font = `600 10px 'JetBrains Mono', monospace`
              ctx.fillStyle = '#00ffaa'
              ctx.fillText(`TGT: ${obj.id} [HVY-DUMP]`, labelX + 6, labelY + 11)
              ctx.fillStyle = '#ffffff'
              ctx.fillText(`R: ${obj.z.toFixed(1)}m | Δv: ${(obj.speed - egoSpeed).toFixed(1)}m/s`, labelX + 6, labelY + 21)
              ctx.fillStyle = '#ffaa00'
              ctx.fillText(`CONF: ${(95 + Math.random()*4).toFixed(1)}% TRACKED`, labelX + 6, labelY + 31)
            }
          } 
          else if (obj.type === 'DEBRIS') {
            // Draw static rock on road
            const rW = 40 * sc
            const rH = 25 * sc
            ctx.fillStyle = '#444' // SWIR bright rock
            ctx.beginPath()
            ctx.moveTo(objX - rW/2, objGY)
            ctx.lineTo(objX - rW*0.3, objGY - rH)
            ctx.lineTo(objX + rW*0.2, objGY - rH*0.8)
            ctx.lineTo(objX + rW/2, objGY)
            ctx.closePath()
            ctx.fill()

            // Radar points for debris
            ctx.globalCompositeOperation = 'screen'
            for (let i = 0; i < 15; i++) {
              ctx.fillStyle = `rgba(0, 255, 200, 0.9)` // approaching ego
              const pSize = 1.5 * Math.max(0.5, sc*10)
              ctx.fillRect(objX - rW/2 + Math.random()*rW, objGY - Math.random()*rH, pSize, pSize)
            }
            ctx.globalCompositeOperation = 'source-over'
          }
        })

      } else {
        // SIDE VIEW - Passing highwalls (SWIR monochrome blur)
        const scroll = (t * 200 * (view === 'LEFT' ? 1 : -1)) % W
        ctx.fillStyle = '#181a1d'
        ctx.fillRect(0, horizon, W, H-horizon)
        
        ctx.lineWidth = 3
        for(let i=0; i<20; i++) {
          const x = (scroll + i*(W/15)) % W
          const xpos = x < 0 ? x + W : x
          ctx.strokeStyle = `rgba(100,100,100,${0.05 + Math.random()*0.1})`
          ctx.beginPath()
          ctx.moveTo(xpos, horizon)
          ctx.lineTo(xpos - (H-horizon)*0.8*(view==='LEFT'?1:-1), H)
          ctx.stroke()
        }
      }

      // Ground Clutter (Sparse radar returns on terrain)
      ctx.globalCompositeOperation = 'screen'
      for(let i=0; i<30; i++) {
        const px = Math.random() * W
        const py = horizon + Math.random() * (H-horizon)
        if (py > horizon + 10) {
          ctx.fillStyle = `rgba(0, 255, 200, ${0.1 + Math.random()*0.3})`
          ctx.fillRect(px, py, 2, 2)
        }
      }
      ctx.globalCompositeOperation = 'source-over'

      // ──────────────────────────────────────────────────────────
      // POST-PROCESSING (SWIR Grain, Vignette, Scanlines)
      // ──────────────────────────────────────────────────────────
      if (noiseRef.current) {
        ctx.globalCompositeOperation = 'overlay'
        ctx.globalAlpha = 0.25 // Heavy SWIR grain
        const nX = (Math.random() * 256) | 0
        const nY = (Math.random() * 256) | 0
        ctx.drawImage(noiseRef.current, nX, nY, 256, 256, 0, 0, W, H)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1.0
      }

      const vig = ctx.createRadialGradient(cx, H/2, H*0.3, cx, H/2, W*0.75)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(0,0,0,0.7)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, W, H)

      const scanY = (t * 300) % H
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.fillRect(0, scanY, W, 4)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(0, scanY-20, W, 20)

      // Technical HUD overlays emphasizing Fusion
      ctx.font = `700 11px 'JetBrains Mono', monospace`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fillText('OPTICAL: SWIR (1550nm) [GRAYSCALE]', 16, 24)
      ctx.fillStyle = 'rgba(0, 255, 170, 0.9)'
      ctx.fillText('OVERLAY: 4D RADAR (77GHz) [DOPPLER CLOUD]', 16, 40)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.fillText(`FPS: ${(24 + Math.random()*2).toFixed(0)} | MODE: FUSED`, 16, 56)

      rafRef.current = requestAnimationFrame(draw)
    }

    const resize = () => {
      canvas.width  = canvas.offsetWidth  || 640
      canvas.height = canvas.offsetHeight || 360
    }
    resize()
    draw()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [view])

  return <canvas ref={canvasRef} className="swir-canvas" style={{ width: '100%', height: '100%', display: 'block' }} />
}


function CameraView({ view, size = 'full' }) {
  const meta = VIEW_META[view]

  return (
    <div className={`cam-view cam-view-${size}`} data-view={view}>
      <div className="cam-view-inner">
        <SensorFusionCanvas view={view} />

        {/* HUD overlays */}
        <div className="cam-hud-tl">
          {meta.veh && <span className="cam-veh-alert">⚠ {meta.veh} · {meta.dist}</span>}
        </div>

        <div className="cam-hud-tr">
          <span className="cam-heading">{meta.dir} {meta.heading}</span>
        </div>

        {meta.dist !== '—' && size === 'full' && (
          <div className="cam-dist-bar">
            <div className="cdb-inner">
              <span className="cdb-label">OBSTACLE DIST</span>
              <span className="cdb-val">{meta.dist}</span>
            </div>
          </div>
        )}

        {/* Corner brackets */}
        <div className="cam-bracket tl" />
        <div className="cam-bracket tr" />
        <div className="cam-bracket bl" />
        <div className="cam-bracket br" />
      </div>
    </div>
  )
}

function ViewContainer({ splitMode, activeView }) {
  switch (splitMode) {
    case 'single':
      return (
        <div className="vc-single">
          <CameraView view={activeView} size="full" />
        </div>
      )
    case 'hsplit':
      return (
        <div className="vc-hsplit">
          <CameraView view="FRONT" size="half" />
          <CameraView view="BACK"  size="half" />
        </div>
      )
    case 'vsplit':
      return (
        <div className="vc-vsplit">
          <CameraView view="FRONT" size="half" />
          <CameraView view="RIGHT" size="half" />
        </div>
      )
    case 'quad':
      return (
        <div className="vc-quad">
          <CameraView view="FRONT" size="quad" />
          <CameraView view="RIGHT" size="quad" />
          <CameraView view="LEFT"  size="quad" />
          <CameraView view="BACK"  size="quad" />
        </div>
      )
    case 'focus3':
      return (
        <div className="vc-focus3">
          <div className="vc-focus3-main">
            <CameraView view={activeView} size="focus" />
          </div>
          <div className="vc-focus3-thumbs">
            {VIEWS.filter(v => v !== activeView).map(v => (
              <CameraView key={v} view={v} size="thumb" />
            ))}
          </div>
        </div>
      )
    default:
      return null
  }
}

function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = n => String(n).padStart(2, '0')
  return <span>{pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}</span>
}



export default function VehicleDashboard({ onBack, onSwitchRole }) {
  const [activeView, setActiveView] = useState('FRONT')
  const [splitMode,  setSplitMode]  = useState('single')
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [speed,  setSpeed]  = useState(18)
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const id = setInterval(() => {
      setSpeed(s => Math.max(5, Math.min(32, s + (Math.random() - 0.5) * 2)))
    }, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const msgs = [
      { type: 'warn',   text: 'VEH-D04 approaching · 42m' },
      { type: 'info',   text: 'V2V: VEH-D08 trailing · 55m' },
      { type: 'warn',   text: 'Road edge L deviation detected' },
      { type: 'info',   text: 'GNSS fix updated · ±2cm' },
      { type: 'danger', text: 'Low visibility warning · 3m' },
    ]
    let idx = 0
    const id = setInterval(() => {
      setAlerts(prev => [
        { id: Date.now(), ...msgs[idx % msgs.length] },
        ...prev.slice(0, 2)
      ])
      idx++
    }, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="vd-root">
      {/* Top bar */}
      <header className="vd-header">
        <div className="vd-header-left">
          <button id="vd-btn-back" className="vd-btn-back" onClick={onBack} title="Back to Menu">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>BACK</span>
          </button>

          <div className="vd-unit-id">
            <span className="vd-unit-label">UNIT</span>
            <span className="vd-unit-val mono">D-07</span>
            <span className="status-dot active" />
          </div>

          <div className="vd-header-sep" />

          <div className="vd-logo-tag">TRINETRIS</div>
          <div className="vd-condition-badge">
            <span className="status-dot warn" />
            <span>LOW VISIBILITY</span>
          </div>
        </div>

        <div className="vd-header-right">
          <div className="vd-header-sep" />

          <button
            id="vd-btn-minimap"
            className={`vd-action-btn ${showMiniMap ? 'active' : ''}`}
            onClick={() => setShowMiniMap(s => !s)}
            title="Toggle minimap"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 5l2 2-1 3 4-2-1-3 2-2-6 2z" fill="currentColor" opacity="0.7"/>
            </svg>
            MAP
          </button>

          <button
            id="vd-btn-switch-role"
            className="vd-action-btn switch"
            onClick={onSwitchRole}
            title="Switch to Server Dashboard"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            SERVER
          </button>

          <div className="vd-clock mono"><LiveClock /></div>
        </div>
      </header>

      {/* Main viewport */}
      <div className="vd-viewport">
        <ViewContainer splitMode={splitMode} activeView={activeView} />

        {showMiniMap && (
          <div className="vd-minimap-overlay">
            <MiniMap />
          </div>
        )}

        <div className="vd-alert-stack">
          {alerts.map(a => (
            <div key={a.id} className={`vd-alert-toast vdat-${a.type}`}>
              <span className={`status-dot ${a.type === 'danger' ? 'danger' : a.type === 'warn' ? 'warn' : 'active'}`} />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Nav Bar */}
      <div className="vd-bottom-navbar">
        <div className="vd-view-tabs" role="group" aria-label="Camera view selection">
          {VIEWS.map(v => (
            <button
              key={v}
              id={`vd-tab-${v.toLowerCase()}`}
              className={`vd-view-tab ${activeView === v && splitMode === 'single' ? 'active' : ''}`}
              onClick={() => { setActiveView(v); setSplitMode('single') }}
              title={`${v} camera view`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="vd-split-btns" role="group" aria-label="Split screen modes">
          {SPLIT_MODES.map(m => (
            <button
              key={m.id}
              id={`vd-split-${m.id}`}
              className={`vd-split-btn ${splitMode === m.id ? 'active' : ''}`}
              onClick={() => setSplitMode(m.id)}
              title={m.label}
            >
              <span className="vsb-icon">{m.icon}</span>
              <span className="vsb-label">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      
    </div>
  )
}
