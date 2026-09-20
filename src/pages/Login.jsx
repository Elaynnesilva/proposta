import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, signUp, signInWithGoogle } from '../lib/db'

export default function Login({ onAuth }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = mode === 'signin' ? await signIn(email, password) : await signUp(email, password, name)
      onAuth(user)
      navigate('/')
    } catch (err) {
      setError(traduzErro(err))
    } finally {
      setLoading(false)
    }
  }

  async function google() {
    setError('')
    setLoading(true)
    try {
      const user = await signInWithGoogle()
      onAuth(user)
      navigate('/')
    } catch (err) {
      setError(traduzErro(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sand px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-11 h-11 rounded-full bg-ink text-white items-center justify-center font-display text-lg mb-4">P+</div>
          <h1 className="font-display text-2xl text-ink">Proposta+</h1>
          <p className="text-sm text-muted mt-1">Suas propostas de projeto, sempre à mão.</p>
        </div>

        <div className="bg-white border border-line rounded-2xl p-6">
          <button
            onClick={google}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 border border-line text-sm font-medium py-3 rounded-lg hover:bg-sand transition mb-4 disabled:opacity-50"
          >
            <GoogleIcon /> Entrar com o Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="h-px bg-line flex-1" />
            <span className="text-xs text-muted">ou</span>
            <div className="h-px bg-line flex-1" />
          </div>

          <div className="flex gap-1 mb-5 bg-sand rounded-full p-1">
            <button
              onClick={() => setMode('signin')}
              className={`flex-1 text-sm py-1.5 rounded-full transition ${mode === 'signin' ? 'bg-ink text-white' : 'text-muted'}`}
            >Entrar</button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 text-sm py-1.5 rounded-full transition ${mode === 'signup' ? 'bg-ink text-white' : 'text-muted'}`}
            >Criar conta</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <input
                placeholder="Seu nome"
                value={name} onChange={(e) => setName(e.target.value)}
                className="w-full text-sm p-3 rounded-lg border border-line outline-none focus:border-clay"
              />
            )}
            <input
              type="email" required placeholder="Email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm p-3 rounded-lg border border-line outline-none focus:border-clay"
            />
            <input
              type="password" required placeholder="Senha" minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm p-3 rounded-lg border border-line outline-none focus:border-clay"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              disabled={loading}
              className="w-full bg-clay text-white text-sm font-medium py-3 rounded-lg hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>

        <p className="text-xs text-muted text-center mt-5 leading-relaxed">
          Seus dados ficam salvos na nuvem e sincronizam automaticamente
          em qualquer computador ou celular onde você entrar com a mesma conta.
        </p>
      </div>
    </div>
  )
}

function traduzErro(err) {
  const code = err?.code || ''
  const map = {
    'auth/email-already-in-use': 'Já existe uma conta com esse email.',
    'auth/invalid-email': 'Email inválido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/user-not-found': 'Email ou senha incorretos.',
    'auth/wrong-password': 'Email ou senha incorretos.',
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/popup-closed-by-user': 'Login cancelado.',
  }
  return map[code] || err.message || 'Ocorreu um erro. Tente novamente.'
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.1 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 7.1 29.6 5 24 5c-7.7 0-14.4 4.4-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 43c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4C29.6 34.4 26.9 35 24 35c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.6 38.6 16.3 43 24 43z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.6l6.6 5.4C39.8 37 44 31.4 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  )
}
