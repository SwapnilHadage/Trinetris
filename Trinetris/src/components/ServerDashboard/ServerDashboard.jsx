import { useState, useEffect, useRef } from 'react'
import FleetMap from './FleetMap'
import './ServerDashboard.css'

const NAV_ITEMS = [
  { id: 'fleet',    icon: '⊞', label: 'Fleet Overview',    badge: null },
  { id: 'vehicles', icon: '🚛', label: 'Vehicle Management',badge: null },
  { id: 'alerts',   icon: '⚠', label: 'Alert Center',      badge: 3 },
  { id: 'analytics',icon: '📊', label: 'Analytics',         badge: null },
  { id: 'weather',  icon: '🌦', label: 'Weather Monitor',   badge: null },
  { id: 'sensors',  icon: '📡', label: 'Sensor Health',     badge: null },
  { id: 'routes',   icon: '🛣', label: 'Route Planning',    badge: null },
  { id: 'settings', icon: '⚙', label: 'Settings',          badge: null },
]

const INITIAL_ALERTS = [
  { id: 1, time: '15:08:22', severity: 'critical', unit: 'D-15', msg: 'COLLISION WARNING — VEH-D14 detected at 8m', ack: false },
  { id: 2, time: '15:07:44', severity: 'warn',     unit: 'D-03', msg: 'Vehicle stopped unexpectedly — Road KM 4.2', ack: false },
  { id: 3, time: '15:06:11', severity: 'warn',     unit: 'E-07', msg: 'Low visibility alert — visibility < 3m', ack: false },
  { id: 4, time: '15:04:58', severity: 'info',     unit: 'D-09', msg: 'GNSS fix degraded — switching to dead reckoning', ack: false },
  { id: 5, time: '15:03:22', severity: 'info',     unit: 'D-22', msg: 'Speed reduced below threshold — 4 km/h', ack: false },
  { id: 6, time: '15:01:07', severity: 'critical', unit: 'D-01', msg: 'SWIR sensor fault — restarting module', ack: true },
]

const VEHICLES = [
  { id: 'D-01', status: 'warning', speed: 0,  load: 85, location: 'KM 2.1', lat: '18°43\'24"N', lon: '81°25\'12"E', fuel: 72 },
  { id: 'D-02', status: 'active',  speed: 22, load: 95, location: 'KM 1.4', lat: '18°43\'18"N', lon: '81°25\'09"E', fuel: 88 },
  { id: 'D-03', status: 'stopped', speed: 0,  load: 0,  location: 'KM 4.2', lat: '18°43\'31"N', lon: '81°25\'27"E', fuel: 41 },
  { id: 'D-04', status: 'active',  speed: 18, load: 78, location: 'KM 3.7', lat: '18°43\'29"N', lon: '81°25\'22"E', fuel: 63 },
  { id: 'D-07', status: 'active',  speed: 18, load: 90, location: 'KM 2.8', lat: '18°43\'26"N', lon: '81°25\'17"E', fuel: 79 },
  { id: 'D-08', status: 'active',  speed: 20, load: 82, location: 'KM 2.5', lat: '18°43\'25"N', lon: '81°25\'15"E', fuel: 55 },
  { id: 'D-11', status: 'active',  speed: 15, load: 67, location: 'KM 1.1', lat: '18°43\'17"N', lon: '81°25\'07"E', fuel: 91 },
  { id: 'D-15', status: 'alert',   speed: 8,  load: 100,location: 'KM 5.0', lat: '18°43\'33"N', lon: '81°25\'30"E', fuel: 34 },
  { id: 'E-02', status: 'active',  speed: 12, load: 55, location: 'KM 3.2', lat: '18°43\'28"N', lon: '81°25\'20"E', fuel: 68 },
  { id: 'E-07', status: 'warning', speed: 6,  load: 44, location: 'KM 4.8', lat: '18°43\'32"N', lon: '81°25\'29"E', fuel: 47 },
]

function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = n => String(n).padStart(2, '0')
  return (
    <span className="mono">
      {pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())} IST
    </span>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card" data-color={color}>
      <div className="sc-label">{label}</div>
      <div className={`sc-val mono text-${color}`}>{value}</div>
      {sub && <div className="sc-sub">{sub}</div>}
    </div>
  )
}

function VehicleRow({ veh, isSelected, onClick }) {
  const statusLabel = { active: 'MOVING', stopped: 'STOPPED', warning: 'CAUTION', alert: 'ALERT' }
  const statusColor = { active: 'active', stopped: 'offline', warning: 'warn', alert: 'danger' }

  return (
    <button
      className={`veh-row ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      id={`vr-${veh.id}`}
    >
      <div className="vr-left">
        <span className={`status-dot ${statusColor[veh.status]}`} />
        <span className="vr-id mono">{veh.id}</span>
        <span className={`vr-status-tag vrs-${veh.status}`}>{statusLabel[veh.status]}</span>
      </div>
      <div className="vr-right">
        <span className="vr-speed mono">{veh.speed} km/h</span>
        <span className="vr-loc">{veh.location}</span>
      </div>
    </button>
  )
}

function VehicleDetail({ veh, onClose }) {
  if (!veh) return null
  const statusColor = { active: 'green', stopped: 'muted', warning: 'amber', alert: 'red' }
  const col = statusColor[veh.status]

  return (
    <div className="veh-detail">
      <div className="vd-dtl-header">
        <div className="vdd-id mono">{veh.id}</div>
        <button className="vdd-close" onClick={onClose}>✕</button>
      </div>
      <div className="vdd-grid">
        <div className="vddg-item">
          <span className="vddg-label">STATUS</span>
          <span className={`vddg-val text-${col}`}>{veh.status.toUpperCase()}</span>
        </div>
        <div className="vddg-item">
          <span className="vddg-label">SPEED</span>
          <span className="vddg-val mono text-amber">{veh.speed} km/h</span>
        </div>
        <div className="vddg-item">
          <span className="vddg-label">LOAD</span>
          <span className="vddg-val mono">{veh.load}%</span>
        </div>
        <div className="vddg-item">
          <span className="vddg-label">FUEL</span>
          <span className={`vddg-val mono ${veh.fuel < 40 ? 'text-red' : 'text-green'}`}>{veh.fuel}%</span>
        </div>
        <div className="vddg-item full">
          <span className="vddg-label">LOCATION</span>
          <span className="vddg-val mono">{veh.lat}, {veh.lon}</span>
        </div>
      </div>
      <div className="vdd-sensors">
        <div className="vdds-row">
          <span>NIGHT VISION</span><span className="status-dot active" /><span className="text-green">ACTIVE</span>
        </div>
        <div className="vdds-row">
          <span>RADAR</span><span className="status-dot active" /><span className="text-green">ACTIVE</span>
        </div>
        <div className="vdds-row">
          <span>GPS</span><span className="status-dot active" /><span className="text-green">FIXED</span>
        </div>
        <div className="vdds-row">
          <span>NETWORK</span><span className="status-dot active" /><span className="text-green">CONNECTED</span>
        </div>
        <div className="vdds-row">
          <span>AI ASSIST</span><span className="status-dot active" /><span className="text-green">RUNNING</span>
        </div>
      </div>
    </div>
  )
}

export default function ServerDashboard({ onBack, onSwitchRole }) {
  const [activeNav, setActiveNav] = useState('fleet')
  const [collapsed, setCollapsed] = useState(false)
  const [selectedVeh, setSelectedVeh] = useState(null)
  const [alerts, setAlerts] = useState(INITIAL_ALERTS)
  const [vehicles, setVehicles] = useState(VEHICLES)

  // Simulate live speed updates and trigger alerts
  useEffect(() => {
    const id = setInterval(() => {
      setVehicles(prevVehicles => {
        let overSpeedAlerts = []
        const now = new Date()
        const pad = n => String(n).padStart(2, '0')
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

        const updated = prevVehicles.map(v => {
          if (v.status !== 'active') return v
          const newSpeed = Math.max(5, Math.min(32, Math.round(v.speed + (Math.random() - 0.5) * 5)))
          
          if (newSpeed > 25 && v.speed <= 25) {
            overSpeedAlerts.push({
              id: Date.now() + Math.random(),
              time: timeStr,
              severity: 'critical',
              unit: v.id,
              msg: `SPEED LIMIT EXCEEDED — ${newSpeed} km/h (Limit: 25)`,
              ack: false
            })
          }
          return { ...v, speed: newSpeed }
        })

        if (overSpeedAlerts.length > 0) {
          setAlerts(prev => [...overSpeedAlerts, ...prev].slice(0, 15))
        }

        return updated
      })
    }, 2500)
    return () => clearInterval(id)
  }, [])

  // Simulate incoming alerts
  useEffect(() => {
    const newAlerts = [
      { severity: 'info',  unit: 'D-02', msg: 'Route KM 1.4 — clear passage confirmed' },
      { severity: 'warn',  unit: 'D-04', msg: 'Speed variance detected — checking road condition' },
      { severity: 'info',  unit: 'D-11', msg: 'Completed haul cycle #47 — heading to loading zone' },
    ]
    let idx = 0
    const id = setInterval(() => {
      const a = newAlerts[idx % newAlerts.length]
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      setAlerts(prev => [
        { id: Date.now(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, ack: false, ...a },
        ...prev.slice(0, 8)
      ])
      idx++
    }, 7000)
    return () => clearInterval(id)
  }, [])

  const ackAlert = (id) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, ack: true } : a))

  const activeCount = vehicles.filter(v => v.status === 'active').length
  const alertCount = alerts.filter(a => !a.ack && a.severity === 'critical').length
  const avgSpeed = Math.round(vehicles.filter(v => v.status === 'active').reduce((s, v) => s + v.speed, 0) / activeCount)

  return (
    <div className="sd-root">
      {/* Top header */}
      <header className="sd-header">
        <div className="sdh-left">
          <button id="sd-btn-back" className="sd-btn-back" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>BACK</span>
          </button>
          <div className="sd-logo">
            <div className="sdl-mark">◈</div>
            <div>
              <div className="sdl-title">TRINETRIS</div>
              <div className="sdl-sub">FLEET COMMAND</div>
            </div>
          </div>
        </div>

        <div className="sdh-stats">
          <StatCard label="ACTIVE FLEET" value={`${activeCount}`} sub={`/ ${vehicles.length} total`} color="green" />
          <StatCard label="CRITICAL ALERTS" value={`${alertCount}`} sub="unacknowledged" color={alertCount > 0 ? 'red' : 'green'} />
          <StatCard label="AVG SPEED" value={`${avgSpeed} km/h`} sub="moving units" color="amber" />
          <StatCard label="WEATHER" value="CLEAR" sub="visibility normal" color="green" />
          <StatCard label="NETWORK" value="ALL ONLINE" sub="23 nodes connected" color="green" />
        </div>

        <div className="sdh-right">
          <div className="sd-shift-info">
            <span className="ssi-label">SHIFT</span>
            <span className="ssi-val">MORNING</span>
          </div>
          <div className="sd-clock"><LiveClock /></div>
          <button id="sd-btn-switch" className="sd-switch-btn" onClick={onSwitchRole} title="Switch to Vehicle Dashboard">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="4" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 4V3a2 2 0 014 0v1" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="7" cy="7.5" r="1.2" fill="currentColor"/>
            </svg>
            VEHICLE VIEW
          </button>
        </div>
      </header>

      <div className="sd-body">
        {/* Sidebar */}
        <aside className={`sd-sidebar ${collapsed ? 'collapsed' : ''}`}>
          <button
            className="sd-collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            id="sd-btn-collapse"
          >
            <span className={`scb-arrow ${collapsed ? 'right' : 'left'}`}>‹</span>
          </button>

          <nav className="sd-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                id={`sd-nav-${item.id}`}
                className={`sd-nav-item ${activeNav === item.id ? 'active' : ''}`}
                onClick={() => setActiveNav(item.id)}
                title={item.label}
              >
                <span className="sni-icon">{item.icon}</span>
                {!collapsed && <span className="sni-label">{item.label}</span>}
                {item.badge && !collapsed && (
                  <span className="sni-badge">{item.badge}</span>
                )}
                {item.badge && collapsed && (
                  <span className="sni-badge-dot" />
                )}
              </button>
            ))}
          </nav>

          {!collapsed && (
            <div className="sd-sidebar-footer">
              <div className="ssf-status">
                <span className="status-dot active" />
                <span>ALL SYSTEMS NOMINAL</span>
              </div>
            </div>
          )}
        </aside>

        {/* Main content area */}
        <main className="sd-main">
          {/* Fleet map */}
          <div className="sd-map-panel">
            <div className="smp-header">
              <div className="smp-title">
                <span className="smpt-dot" />
                BAILADILA MINE — HAUL ROAD NETWORK
              </div>
              <div className="smp-meta">
                <span className="smpm-item"><span className="cf-dot amber"/>MOVING</span>
                <span className="smpm-item"><span className="cf-dot" style={{background:'#f97316'}}/>CAUTION</span>
                <span className="smpm-item"><span className="cf-dot" style={{background:'var(--red)'}}/>ALERT</span>
                <span className="smpm-item"><span className="cf-dot" style={{background:'var(--text-dim)'}}/>STOPPED</span>
              </div>
            </div>
            <div className="smp-map-area">
              <FleetMap vehicles={vehicles} onSelectVehicle={(id) => setSelectedVeh(vehicles.find(v => v.id === id))} selectedId={selectedVeh?.id} />
            </div>
          </div>

          {/* Right column: vehicle list + details */}
          <div className="sd-right-panel">
            {/* Vehicle list */}
            <div className="sd-veh-list-panel">
              <div className="svlp-header">
                <span>FLEET STATUS</span>
                <span className="mono text-muted" style={{fontSize:'11px'}}>{vehicles.length} units</span>
              </div>
              <div className="svlp-list">
                {vehicles.map(v => (
                  <VehicleRow
                    key={v.id}
                    veh={v}
                    isSelected={selectedVeh?.id === v.id}
                    onClick={() => setSelectedVeh(v)}
                  />
                ))}
              </div>
            </div>

            {/* Vehicle detail / Alert panel */}
            {selectedVeh ? (
              <VehicleDetail veh={selectedVeh} onClose={() => setSelectedVeh(null)} />
            ) : (
              <div className="sd-alert-panel">
                <div className="sap-header">
                  <span>ALERT CENTER</span>
                  <span className={`sap-badge ${alertCount > 0 ? 'sap-badge-red' : ''}`}>{alerts.filter(a => !a.ack).length} ACTIVE</span>
                </div>
                <div className="sap-list">
                  {alerts.map(a => (
                    <div key={a.id} className={`sap-item sapi-${a.severity} ${a.ack ? 'acked' : ''}`}>
                      <div className="sapi-top">
                        <div className="sapi-left">
                          <span className={`status-dot ${a.severity === 'critical' ? 'danger' : a.severity === 'warn' ? 'warn' : 'active'}`} />
                          <span className="sapi-unit mono">{a.unit}</span>
                          <span className={`sapi-sev sev-${a.severity}`}>{a.severity.toUpperCase()}</span>
                        </div>
                        <span className="sapi-time mono">{a.time}</span>
                      </div>
                      <div className="sapi-msg">{a.msg}</div>
                      {!a.ack && (
                        <button className="sapi-ack" onClick={() => ackAlert(a.id)}>ACKNOWLEDGE</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
