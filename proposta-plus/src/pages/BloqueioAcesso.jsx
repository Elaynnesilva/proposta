import React from 'react'
import { signOutUser } from '../lib/db'

/** Tela de quem foi bloqueado. Não mostra nada do sistema, só o caminho do suporte. */
export default function BloqueioAcesso({ acesso }) {
  const s = acesso?.config?.suporte || {}
  return (
    <div className="min-h-screen bg-sand flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full border border-line">
        <h1 className="font-display text-2xl text-ink mb-2">Acesso indisponível</h1>
        <p className="text-sm text-ink/80 mb-4">
          O e-mail <strong>{acesso?.email}</strong> não tem acesso ao Proposta+ no momento.
          Se você acha que isso é um engano, fale com o suporte.
        </p>
        <div className="text-sm text-ink/80 mb-6">
          {s.whatsapp && <div>WhatsApp: {s.whatsapp}</div>}
          {s.email && <div>E-mail: {s.email}</div>}
        </div>
        <button onClick={() => signOutUser()} className="text-sm px-5 py-2.5 rounded-full border border-line text-muted">
          Sair da conta
        </button>
      </div>
    </div>
  )
}
