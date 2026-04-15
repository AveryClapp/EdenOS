import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AmbientBar from './components/AmbientBar'
import NavSidebar from './components/NavSidebar'
import EdenPanel from './components/EdenPanel'
import AlertToasts from './components/AlertToasts'
import CommandCenter from './views/CommandCenter'
import Today from './views/Today'
import Week from './views/Week'
import Goals from './views/Goals'
import Projects from './views/Projects'
import Settings from './views/Settings'
import LifeMap from './views/LifeMap'
import Jarvis from './views/Jarvis'
import People from './views/People'

export default function App() {
  const [edenCollapsed, setEdenCollapsed] = useState(false)
  const location = useLocation()
  const isJarvisRoute = location.pathname === '/jarvis'

  return (
    <div className="eden-shell flex flex-col h-screen overflow-hidden">
      <AmbientBar />
      <div className="flex flex-1 overflow-hidden">
        <NavSidebar />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          style={{ background: 'var(--color-base)' }}
        >
          {/* Jarvis gets a fixed-height flex container so it manages its own internal scroll.
              All other views scroll via overflow-y-auto on this wrapper. */}
          <div className={isJarvisRoute
            ? 'flex-1 overflow-hidden flex flex-col'
            : 'flex-1 overflow-y-auto'
          }>
            <Routes>
              <Route path="/" element={<CommandCenter />} />
              <Route path="/today" element={<Today />} />
              <Route path="/week" element={<Week />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/lifemap" element={<LifeMap />} />
              <Route path="/people" element={<People />} />
              <Route path="/jarvis" element={<Jarvis />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
        {!isJarvisRoute && (
          <EdenPanel
            collapsed={edenCollapsed}
            onToggleCollapse={() => setEdenCollapsed(c => !c)}
          />
        )}
      </div>
      <AlertToasts />
    </div>
  )
}
