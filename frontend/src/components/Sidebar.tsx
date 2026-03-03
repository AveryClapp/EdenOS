import { NavLink } from 'react-router-dom'

const NAV = [
  { path: '/', label: 'Today', end: true },
  { path: '/week', label: 'Week', end: false },
  { path: '/goals', label: 'Goals', end: false },
  { path: '/projects', label: 'Projects', end: false },
  { path: '/chat', label: 'Chat', end: false },
  { path: '/plan', label: 'Plan', end: true },
  { path: '/plan/week', label: 'Week Plan', end: false },
  { path: '/settings', label: 'Settings', end: false },
]

export default function Sidebar() {
  return (
    <aside className="w-52 shrink-0 flex flex-col" style={{ background: '#0a0804', borderRight: '1px solid #2a2118' }}>
      {/* Brand */}
      <div className="px-5 py-6" style={{ borderBottom: '1px solid #2a2118' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
            style={{ background: '#78350f', color: '#fbbf24', fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            E
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 400, color: '#f0e6d3', letterSpacing: '-0.02em' }}>
            Eden
          </span>
        </div>
        <p className="mt-1.5 text-xs" style={{ color: '#6b5a47', paddingLeft: '36px' }}>your reasoning layer</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ path, label, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              'flex items-center px-3 py-2 rounded-lg text-sm transition-all duration-150 ' +
              (isActive
                ? 'font-medium'
                : 'hover:bg-white/5')
            }
            style={({ isActive }) => isActive
              ? { background: '#2a1d0f', color: '#fbbf24' }
              : { color: '#7a6855' }
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
