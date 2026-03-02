import { NavLink } from 'react-router-dom'

const NAV = [
  { label: 'T', title: 'TODAY', path: '/' },
  { label: 'W', title: 'WEEK', path: '/week' },
  { label: 'G', title: 'GOALS', path: '/goals' },
  { label: 'P', title: 'PROJECTS', path: '/projects' },
  { label: '›', title: 'CHAT', path: '/chat' },
]

export default function Sidebar() {
  return (
    <nav className="w-10 flex flex-col items-center border-r border-zinc-800 bg-zinc-950 py-4 shrink-0">
      <span className="text-emerald-400 text-xs font-bold mb-6 tracking-widest">E</span>
      <div className="flex flex-col gap-1 w-full">
        {NAV.map(({ label, title, path }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={title}
            className={({ isActive }) =>
              'flex items-center justify-center h-8 text-xs transition-colors ' +
              (isActive
                ? 'text-zinc-100 bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900')
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
