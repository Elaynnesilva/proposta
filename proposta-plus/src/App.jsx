import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { subscribeAuth } from './lib/db'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import Settings from './pages/Settings'
import Presenter from './pages/Presenter'

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const unsubscribe = subscribeAuth((u) => {
      setUser(u)
      setChecking(false)
    })
    return unsubscribe
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sand text-muted text-sm">
        Carregando…
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login onAuth={setUser} />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/proposta/:id/apresentar" element={<Presenter />} />
      <Route
        path="*"
        element={
          <Layout user={user}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proposta/:id/editar" element={<Editor />} />
              <Route path="/configuracoes" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  )
}
