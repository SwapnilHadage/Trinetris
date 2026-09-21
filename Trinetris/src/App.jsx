import { useState } from 'react'
import LandingPage from './components/LandingPage/LandingPage'
import VehicleDashboard from './components/VehicleDashboard/VehicleDashboard'
import ServerDashboard from './components/ServerDashboard/ServerDashboard'
import './App.css'

function App() {
  const [screen, setScreen] = useState('landing') // 'landing' | 'vehicle' | 'server'
  const [transitioning, setTransitioning] = useState(false)

  const navigate = (dest) => {
    setTransitioning(true)
    setTimeout(() => {
      setScreen(dest)
      setTransitioning(false)
    }, 350)
  }

  return (
    <div className={`app-root ${transitioning ? 'app-fade-out' : 'app-fade-in'}`}>
      {screen === 'landing' && (
        <LandingPage onSelect={navigate} />
      )}
      {screen === 'vehicle' && (
        <VehicleDashboard onBack={() => navigate('landing')} onSwitchRole={() => navigate('server')} />
      )}
      {screen === 'server' && (
        <ServerDashboard onBack={() => navigate('landing')} onSwitchRole={() => navigate('vehicle')} />
      )}
    </div>
  )
}

export default App
