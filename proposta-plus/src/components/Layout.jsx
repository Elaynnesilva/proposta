import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOutUser } from '../lib/db'

const NAV = [
  { to: '/', label: 'Propostas', icon: '▤' },
  { to: '/configuracoes', label: 'Configurações', icon: '⚙' },
  { to: '/agenda', label: 'Agenda', icon: '📅' },
]

export default function Layout({ user, children }) {
  const navigate = useNavigate()

  async function logout() {
    await signOutUser()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-sand md:flex">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-white flex-col justify-between">
        <div>
          <div className="px-6 py-6 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center font-display text-sm">P+</div>
            <span className="font-display text-lg text-ink">Proposta+</span>
          </div>
          <nav className="px-3 space-y-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to} to={n.to} end={n.to === '/'}
                className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${isActive ? 'bg-ink text-white' : 'text-ink/70 hover:bg-sand'}`}
              >
                <span>{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-line">
          <div className="text-xs text-muted truncate mb-2">{user?.email}</div>
          <button onClick={logout} className="text-xs text-clay hover:underline">Sair da conta</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-line sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-ink text-white flex items-center justify-center font-display text-xs">P+</div>
          <span className="font-display text-base text-ink">Proposta+</span>
        </div>
        <button onClick={logout} className="text-xs text-clay">Sair</button>
      </div>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-line flex z-20">
        {NAV.map((n) => (
          <NavLink
            key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs ${isActive ? 'text-clay' : 'text-muted'}`}
          >
            <span className="text-lg leading-none">{n.icon}</span>{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
