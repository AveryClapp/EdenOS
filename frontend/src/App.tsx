import { Routes, Route, Navigate } from 'react-router-dom'
import AmbientBar from './components/AmbientBar'
import NavSidebar from './components/NavSidebar'
import EdenPanel from './components/EdenPanel'
import CommandCenter from './views/CommandCenter'
import Today from './views/Today'
import Week from './views/Week'
import Goals from './views/Goals'
import Projects from './views/Projects'
import Settings from './views/Settings'

export default function App() {
  return (
    <div className="eden-shell flex flex-col h-screen overflow-hidden">
      <AmbientBar />
      <div className="flex flex-1 overflow-hidden">
        <NavSidebar />
        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--color-base)' }}>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/today" element={<Today />} />
            <Route path="/week" element={<Week />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <EdenPanel />
      </div>
    </div>
  )
}
