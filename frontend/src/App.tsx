import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Today from './views/Today'
import Week from './views/Week'
import Goals from './views/Goals'
import Projects from './views/Projects'
import Chat from './views/Chat'
import Settings from './views/Settings'
import PlanningSession from './views/PlanningSession'

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden font-mono bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/week" element={<Week />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/plan" element={<PlanningSession />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
