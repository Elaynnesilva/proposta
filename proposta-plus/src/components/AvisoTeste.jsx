import React from 'react'

/**
 * Boas-vindas de quem está na versão de teste, mostrada no topo do painel. Os textos,
 * contatos, o tempo de teste e o botão de vendas vêm de "Usuários do sistema > Suporte" —
 * dá para mudar tudo sem tocar no código.
 */
export default function AvisoTeste({ acesso, nome }) {
  const s = acesso?.config?.suporte || {}
  const dias = Number(s.diasTeste) || 30
  const restantes = acesso?.diasRestantes ?? dias
  const vencido = acesso?.vencido
  const acabando = !vencido && restantes <= 7

  const titulo = String(s.titulo || '').replace('{nome}', nome || 'arquiteto(a)')
  const mensagem = String(s.mensagem || '').replace('{dias}', dias)

  return (
    <div
      className="rounded-2xl p-5 mb-6 border"
      style={vencido
        ? { background: '#FDEEEC', borderColor: '#F3C7C2' }
        : acabando ? { background: '#FEF6E7', borderColor: '#F3DFB8' } : { background: 'white', borderColor: '#E4DFD6' }}
    >
      <h2 className="font-display text-xl text-ink mb-1">{titulo}</h2>

      {vencido ? (
        <p className="text-sm mb-3" style={{ color: '#B42318' }}>
          Seu período de teste terminou. Você continua podendo consultar o que já criou, mas não é
          mais possível criar ou editar propostas.
        </p>
      ) : (
        <p className="text-sm text-ink/80 mb-1">
          {acabando
            ? `Seu teste termina em ${restantes} dia(s).`
            : `Você tem ${restantes} dia(s) de teste restantes.`}
        </p>
      )}

      <p className="text-sm text-ink/80 mb-3 whitespace-pre-line">{mensagem}</p>

      <div className="text-sm text-ink/80 mb-4">
        {s.whatsapp && <div>WhatsApp: {s.whatsapp}</div>}
        {s.email && <div>E-mail: {s.email}</div>}
      </div>

      {s.botaoLink && (
        <a
          href={s.botaoLink} target="_blank" rel="noreferrer"
          className="inline-block text-sm font-medium px-5 py-2.5 rounded-full bg-clay text-white"
        >{s.botaoNome || 'Saiba mais'}</a>
      )}
    </div>
  )
}
