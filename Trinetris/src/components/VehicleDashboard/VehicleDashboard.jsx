import { useState, useEffect, useRef, useMemo } from 'react'
import MiniMap from './MiniMap'
import TwinCanvas, { pothole } from './SwirVideo'
import './VehicleDashboard.css'

const ROAD = { left: -21, center: -7, right: 7, crestA: 9, crestB: 9.9, bermOut: 12.4, bermH: 1.8, bend: 0.0006 }
const roadX = z => ROAD.bend * z * z
const RANGE = 100
const SWIR_RANGE = 55
const SPEED_LIMIT = 20
const VISIBILITY_M = 12
const SENSORS = { ok: 8, total: 8 }

const VIEWS = [
  { id: 'FRONT', label: 'Front', deg: 0 },
  { id: 'LEFT', label: 'Left', deg: -90 },
  { id: 'RIGHT', label: 'Right', deg: 90 },
  { id: 'REAR', label: 'Rear', deg: 180 },
]
const LAYOUTS = [
  { id: 'single', label: 'Single' },
  { id: 'focus', label: '1 + 3' },
  { id: 'quad', label: 'All four' },
]
const DIR_WORD = { FRONT: 'ahead', REAR: 'behind', LEFT: 'on left', RIGHT: 'on right' }
const RANK = { ok: 0, caution: 1, danger: 2 }
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const ONCOMING = new Set(['D-04', 'D-11', 'D-15'])

function derive(t) {
  t.x = t.u + roadX(t.z)
  t.dist = Math.hypot(t.x, t.z)
  t.bearing = (Math.atan2(t.x, t.z) * 180) / Math.PI
  const b = Math.abs(t.bearing)
  t.sector = b <= 45 ? 'FRONT' : b >= 135 ? 'REAR' : t.bearing > 0 ? 'RIGHT' : 'LEFT'
  t.closing = -(t.z * t.vz) / Math.max(t.dist, 1)
  t.ttc = t.closing > 0.5 ? t.dist / t.closing : Infinity
  t.inPath = Math.abs(t.u) <= 5.5
  if (t.inPath) t.sev = t.dist < 20 || t.ttc < 6 ? 'danger' : t.dist < 50 || t.ttc < 12 ? 'caution' : 'ok'
  else t.sev = t.dist < 12 ? 'danger' : t.dist < 40 ? 'caution' : 'ok'
  t.swirLim = t.kind === 'debris' ? 30 : SWIR_RANGE
  t.inSwir = t.dist <= t.swirLim
}

/* Suspension: heave / pitch / roll / yaw as damped springs driven by road
   corrugation (a function of distance travelled, so faster = buzzier) plus
   a jolt each time a wheel crosses one of the potholes the camera sees. */
function stepChassis(s, dt, prevOdo) {
  const c = s.chassis
  const sp = clamp(s.speed / 3.6 / 4.5, 0.25, 2.2)
  const o = s.odo
  const r1 = Math.sin(o * 3.7) * 0.5 + Math.sin(o * 7.9 + 1.3) * 0.3 + Math.sin(o * 13.1 + 2.2) * 0.2
  const r2 = Math.sin(o * 3.1 + 0.7) * 0.5 + Math.sin(o * 6.3 + 2.9) * 0.3 + Math.sin(o * 11.7 + 0.4) * 0.2
  const r3 = Math.sin(o * 2.3 + 1.9) * 0.6 + Math.sin(o * 9.1 + 0.5) * 0.4
  const i0 = Math.floor((prevOdo - 30) / 34)
  for (let i = i0 - 1; i <= i0 + 2; i++) {
    const p = pothole(i), side = p.u > 0 ? 1 : -1
    if (prevOdo < p.z - 3.8 && o >= p.z - 3.8) { c.hv += 0.42 * sp; c.pv += 0.075 * sp; c.rv -= side * 0.1 * sp }   // front wheel
    if (prevOdo < p.z + 3.4 && o >= p.z + 3.4) { c.hv += 0.3 * sp; c.pv -= 0.05 * sp; c.rv -= side * 0.07 * sp }    // rear wheel
  }
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n
  for (let i = 0; i < n; i++) {
    c.hv += (-100 * c.heave - 5.6 * c.hv + 9 * r1 * sp) * h; c.heave += c.hv * h
    c.pv += (-67 * c.pitch - 4.9 * c.pv + 2.1 * r2 * sp) * h; c.pitch += c.pv * h
    c.rv += (-144 * c.roll - 7.2 * c.rv + 3.2 * r3 * sp) * h; c.roll += c.rv * h
  }
  c.yaw = 0.0035 * sp * (Math.sin(o * 0.5) + 0.5 * Math.sin(o * 1.7 + 1))
}

function stepSim(s, dt) {
  s.speed += (s.goal - s.speed) * Math.min(1, dt * 0.5)
  const ego = s.speed / 3.6
  const prevOdo = s.odo
  s.odo += ego * dt
  if (dt > 0) stepChassis(s, dt, prevOdo)
  s.wander = clamp(s.wander + (Math.random() - 0.5) * dt * 1.5, -1.2, 1.2)
  for (const t of s.targets) {
    t.vz = ONCOMING.has(t.id) ? -(ego + 4.4) : t.id === 'D-08' ? s.wander : -ego
    t.z += t.vz * dt
    if (ONCOMING.has(t.id) && t.z < -25) t.z = 140
    if (t.id === 'ROCK' && t.z < 12) t.z = 96
    if (t.id === 'E-02' && t.z < -30) t.z = 110
    if (t.id === 'D-08') t.z = clamp(t.z, -72, -30)
    derive(t)
  }
}

// Two dumpers share the oncoming lane, offset so one is (almost) always
// close enough to matter — a haul road this narrow is rarely empty.
function createSim() {
  const s = {
    speed: 16, goal: 16, odo: 0, wander: 0,
    chassis: { heave: 0, hv: 0, pitch: 0, pv: 0, roll: 0, rv: 0, yaw: 0 },
    targets: [
      // Evenly spaced (55 m) so the oncoming lane reads as a convoy —
      // several trucks ahead at once, not one truck in an empty road.
      { id: 'D-04', label: 'D-04', name: 'Dumper D-04', kind: 'dumper', z: 113, u: -14, dir: -1 },
      { id: 'D-11', label: 'D-11', name: 'Dumper D-11', kind: 'dumper', z: 58, u: -13.3, dir: -1 },
      { id: 'D-15', label: 'D-15', name: 'Dumper D-15', kind: 'dumper', z: 3, u: -14.6, dir: -1 },
      { id: 'D-08', label: 'D-08', name: 'Dumper D-08', kind: 'dumper', z: -38, u: 0, dir: 1 },
      { id: 'E-02', label: 'E-02', name: 'Excavator E-02', kind: 'excavator', z: 22, u: 32, dir: 1 },
      { id: 'ROCK', label: 'Rock', name: 'Rock on road', kind: 'debris', z: 72, u: 4, dir: 1 },
    ],
  }
  stepSim(s, 0)
  return s
}

const snapshot = (s, t0) => ({
  speed: s.speed,
  targets: s.targets.map(t => ({ ...t })),
  mapAge: 4 + Math.floor((Date.now() - t0) / 60000),
})


const Icon = ({ children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const ArrowIcon = ({ deg }) => (
  <Icon><g transform={`rotate(${deg} 12 12)`}><path d="M12 19V5M6 11l6-6 6 6" /></g></Icon>
)
const LayoutIcon = ({ id }) => (
  <Icon>
    {id === 'single' && <rect x="3" y="5" width="18" height="14" rx="2" />}
    {id === 'focus' && <><rect x="3" y="5" width="12" height="14" rx="2" /><rect x="17.5" y="5" width="3.5" height="3.6" rx="1" /><rect x="17.5" y="10.2" width="3.5" height="3.6" rx="1" /><rect x="17.5" y="15.4" width="3.5" height="3.6" rx="1" /></>}
    {id === 'quad' && <><rect x="3" y="5" width="8" height="6" rx="1.5" /><rect x="13" y="5" width="8" height="6" rx="1.5" /><rect x="3" y="13" width="8" height="6" rx="1.5" /><rect x="13" y="13" width="8" height="6" rx="1.5" /></>}
  </Icon>
)

function CameraTile({ view, mode, sim, theme, info, onSelect }) {
  const label = VIEWS.find(v => v.id === view).label
  const clickable = mode !== 'main'
  const n = info.nearest
  const src = n && !n.inSwir ? 'RADAR' : 'FUSED'
  return (
    <div
      className={`vd-tile is-${mode}`}
      data-sev={info.sev}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Show ${label.toLowerCase()} camera` : `${label} camera`}
      onClick={clickable ? () => onSelect(view) : undefined}
      onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(view) } } : undefined}
    >
      <TwinCanvas view={view} sim={sim} road={ROAD} theme={theme} range={RANGE} />
      <div className="vd-tile-head">
        <span className="vd-pill">{label} · {src}</span>
        <span className="vd-pill" data-sev={n ? n.sev : 'ok'}>{n ? `${n.label} · ${Math.round(n.dist)} m` : 'Clear'}</span>
      </div>
    </div>
  )
}

function StageGrid({ layout, activeView, sim, theme, bySector, onSelect }) {
  if (layout === 'single')
    return <div className="vd-grid" data-layout="single"><CameraTile view={activeView} mode="main" sim={sim} theme={theme} info={bySector[activeView]} onSelect={onSelect} /></div>
  if (layout === 'focus')
    return (
      <div className="vd-grid" data-layout="focus">
        <CameraTile view={activeView} mode="main" sim={sim} theme={theme} info={bySector[activeView]} onSelect={onSelect} />
        {VIEWS.filter(v => v.id !== activeView).map(v => (
          <CameraTile key={v.id} view={v.id} mode="thumb" sim={sim} theme={theme} info={bySector[v.id]} onSelect={onSelect} />
        ))}
      </div>
    )
  return (
    <div className="vd-grid" data-layout="quad">
      {['FRONT', 'REAR', 'LEFT', 'RIGHT'].map(v => (
        <CameraTile key={v} view={v} mode="quad" sim={sim} theme={theme} info={bySector[v]} onSelect={onSelect} />
      ))}
    </div>
  )
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
  const [layout, setLayout] = useState('single')
  const [theme, setTheme] = useState('day')

  const simRef = useRef(null)
  const startRef = useRef(Date.now())
  if (!simRef.current) simRef.current = createSim()
  const [ui, setUi] = useState(() => snapshot(simRef.current, startRef.current))

  useEffect(() => {
    const s = simRef.current
    let raf, last = performance.now()
    const loop = now => {
      stepSim(s, Math.min(0.1, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const push = setInterval(() => setUi(snapshot(s, startRef.current)), 250)
    const pace = setInterval(() => { s.goal = clamp(s.goal + (Math.random() - 0.5) * 5, 10, 24) }, 3000)
    return () => { cancelAnimationFrame(raf); clearInterval(push); clearInterval(pace) }
  }, [])

  const selectView = v => {
    setActiveView(v)
    setLayout(l => (l === 'quad' ? 'focus' : l))
  }

  const visible = useMemo(() => ui.targets.filter(t => t.dist <= RANGE), [ui])

  const bySector = useMemo(() => {
    const out = {}
    VIEWS.forEach(v => { out[v.id] = { nearest: null, sev: 'ok' } })
    for (const t of visible) {
      const o = out[t.sector]
      if (!o.nearest || t.dist < o.nearest.dist) o.nearest = t
      o.sev = worse(o.sev, t.sev)
    }
    return out
  }, [visible])

  const speed = Math.round(ui.speed)
  const over = speed > SPEED_LIMIT

  const alerts = useMemo(() => {
    const list = []
    if (over) list.push({ key: 'speed', sev: 'caution', title: 'Over speed limit', detail: `${speed} km/h · limit ${SPEED_LIMIT}` })
    for (const t of visible) {
      if (t.sev === 'ok') continue
      const reach = t.inPath && isFinite(t.ttc) && t.ttc < 20 ? ` · reaches you in ${Math.ceil(t.ttc)} s` : ''
      const src = t.inSwir ? '' : ' · radar only'
      list.push({ key: t.id, sev: t.sev, view: t.sector, title: `${t.name} ${DIR_WORD[t.sector]}`, detail: `${Math.round(t.dist)} m${reach}${src}` })
    }
    return list.sort((a, b) => RANK[b.sev] - RANK[a.sev] || a.key.localeCompare(b.key))
  }, [visible, over, speed])

  const linked = visible.filter(t => t.kind !== 'debris').length

  return (
    <div className="vd-root" data-theme={theme}>
      <header className="vd-header">
        <button id="vd-btn-back" className="vd-btn" onClick={onBack} title="Back">
          <Icon size={16}><path d="M15 5l-7 7 7 7" /></Icon>
          <span className="vd-btn-label">Back</span>
        </button>
        <div className="vd-unit">
          <span className="vd-unit-label">Unit</span>
          <span className="vd-unit-val">D-07</span>
          <span className="vd-dot" data-sev="ok" />
        </div>

        <div className="vd-status">
          <span className="vd-chip" data-sev="caution">Low vis · {VISIBILITY_M} m</span>
          <span className="vd-chip vd-hide-sm" data-sev="ok">SWIR + 4D radar · {SENSORS.ok}/{SENSORS.total}</span>
          <span className="vd-chip vd-hide-sm" data-sev="ok">V2I · V2V {linked}</span>
        </div>

        <button id="vd-btn-theme" className="vd-btn" onClick={() => setTheme(t => (t === 'day' ? 'night' : 'day'))} title="Switch screen brightness mode">
          <Icon size={16}>
            {theme === 'day'
              ? <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
              : <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>}
          </Icon>
          <span className="vd-btn-label">{theme === 'day' ? 'Night' : 'Day'}</span>
        </button>
        <button id="vd-btn-switch-role" className="vd-btn" onClick={onSwitchRole} title="Server view">
          <span className="vd-btn-label">Server</span>
          <Icon size={16}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
        </button>
        <div className="vd-clock"><LiveClock /></div>
      </header>

      <div className="vd-disclaimer">
        <Icon size={13}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.2v.1" /></Icon>
        Simulated interface — not actual output from our system. It shows how we imagine the finished dashboard could look and work.
      </div>

      <div className="vd-body">
        <main className="vd-stage">
          <StageGrid layout={layout} activeView={activeView} sim={simRef} theme={theme} bySector={bySector} onSelect={selectView} />
        </main>

        <aside className="vd-panel">
          <section className="vd-card vd-speed" data-sev={over ? 'caution' : 'ok'}>
            <div className="vd-card-head"><strong>Speed</strong><span>Limit {SPEED_LIMIT} km/h</span></div>
            <div className="vd-speed-row">
              <span className="vd-speed-val">{speed}</span>
              <span className="vd-speed-unit">km/h</span>
            </div>
            <div className="vd-speed-bar" aria-hidden="true">
              <i style={{ width: `${clamp((ui.speed / 30) * 100, 0, 100)}%` }} />
              <b style={{ left: `${(SPEED_LIMIT / 30) * 100}%` }} />
            </div>
          </section>

          <MiniMap sim={simRef} road={ROAD} range={RANGE} swirRange={SWIR_RANGE} theme={theme} mapAge={ui.mapAge} />

          <section className="vd-card vd-alerts" aria-live="polite">
            <div className="vd-card-head"><strong>Alerts</strong><span>{alerts.length ? `${alerts.length} active` : 'None'}</span></div>
            {alerts.length === 0 ? (
              <p className="vd-clear">All clear within {RANGE} m</p>
            ) : (
              <ul className="vd-alert-list">
                {alerts.map(a => (
                  <li key={a.key}>
                    <button className="vd-alert" data-sev={a.sev} disabled={!a.view} onClick={() => a.view && selectView(a.view)}>
                      <span className="vd-alert-title">{a.title}</span>
                      <span className="vd-alert-detail">{a.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <nav className="vd-navbar" aria-label="Camera controls">
        <div className="vd-nav-group" role="group" aria-label="Camera">
          <span className="vd-nav-label">Camera</span>
          {VIEWS.map(v => (
            <button
              key={v.id}
              id={`vd-tab-${v.id.toLowerCase()}`}
              className={`vd-tab ${activeView === v.id && layout !== 'quad' ? 'active' : ''}`}
              onClick={() => selectView(v.id)}
              aria-pressed={activeView === v.id && layout !== 'quad'}
            >
              <ArrowIcon deg={v.deg} />
              {v.label}
              {bySector[v.id].sev !== 'ok' && <span className="vd-tab-dot" data-sev={bySector[v.id].sev} title={bySector[v.id].sev === 'danger' ? 'Danger' : 'Caution'} />}
            </button>
          ))}
        </div>
        <div className="vd-nav-group" role="group" aria-label="Layout">
          <span className="vd-nav-label">Layout</span>
          {LAYOUTS.map(l => (
            <button
              key={l.id}
              id={`vd-layout-${l.id}`}
              className={`vd-tab ${layout === l.id ? 'active' : ''}`}
              onClick={() => setLayout(l.id)}
              aria-pressed={layout === l.id}
            >
              <LayoutIcon id={l.id} />
              {l.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
