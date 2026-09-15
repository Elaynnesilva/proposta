import React, { useState } from 'react'
import Presenter from '../pages/Presenter'
import { closeProposal, saveProposal } from '../lib/db'

/**
 * Motivos de recusa. Ter uma lista fechada (mais um campo livre no fim) serve pra você
 * conseguir olhar depois e enxergar padrão — "quantas caíram por preço?" — em vez de ficar
 * com um monte de frase solta que não dá pra comparar.
 */
export const MOTIVOS_RECUSA = [
  'Cliente não marcou a reunião',
  'Cliente não deu mais retorno',
  'Cliente desistiu do projeto',
  'Cliente achou caro',
  'Contratou outro profissional',
  'Motivo não identificado',
]

/**
 * Janela de encerramento, usada tanto no painel quanto dentro da proposta.
 *
 * Encerrar apaga a apresentação e as fotos para sempre — é o que devolve espaço, já que o
 * plano gratuito do Firebase dá 1 GiB para a conta inteira. Por isso o botão de confirmar só
 * destrava depois que um PDF foi gerado: ele é a única cópia da apresentação que vai sobrar.
 *
 * O PDF é gerado aqui dentro, sem sair da janela: a apresentação é montada invisível (o
 * Presenter em modo exportação) só pra ser fotografada página a página.
 */
export default function EncerrarProposta({ proposal, recusa, onCancelar, onPronto }) {
  const [temPdf, setTemPdf] = useState(!!proposal.pdfExportedAt)
  const [gerando, setGerando] = useState(false)
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 })
  const [salvando, setSalvando] = useState(false)
  const [motivo, setMotivo] = useState(proposal.recusaMotivo || '')
  const [outroMotivo, setOutroMotivo] = useState('')

  const motivoFinal = motivo === 'Outro motivo' ? outroMotivo.trim() : motivo
  const motivoOk = !recusa || !!motivoFinal

  async function confirmar() {
    setSalvando(true)
    try {
      const base = recusa
        ? { ...proposal, status: 'recusada', acceptedValue: undefined, recusaMotivo: motivoFinal, recusaEm: new Date().toISOString() }
        : proposal
      if (recusa) await saveProposal(base)
      const apagadas = await closeProposal(base)
      onPronto?.(apagadas)
    } catch (err) {
      console.error(err)
      alert('Não consegui encerrar a proposta agora. Tente de novo em alguns instantes.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6 overflow-auto" onClick={onCancelar}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md my-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink mb-2">{recusa ? 'Marcar como recusada' : 'Encerrar proposta'}</h3>

        <p className="text-sm text-ink/80 mb-3">
          {recusa
            ? 'Após registrar esta proposta como recusada, a apresentação e novas edições ficarão indisponíveis.'
            : 'Ao encerrar, a apresentação e novas edições ficarão indisponíveis.'}
          {' '}As fotos serão apagadas e os dados do projeto continuam disponíveis para consulta.
        </p>
        <p className="text-sm text-ink/80 mb-4">
          Baixe o PDF da proposta para salvá-la — é a única cópia da apresentação que vai restar.
          {!recusa && ' Encerrar libera espaço na memória para novas propostas.'}
        </p>

        {recusa && (
          <div className="mb-4">
            <label className="text-xs font-medium text-ink/70 block mb-1.5">Qual foi o motivo?</label>
            <select
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
              className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay bg-white"
            >
              <option value="">Selecione…</option>
              {MOTIVOS_RECUSA.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="Outro motivo">Outro motivo</option>
            </select>
            {motivo === 'Outro motivo' && (
              <textarea
                value={outroMotivo} onChange={(e) => setOutroMotivo(e.target.value)} rows={2}
                placeholder="Escreva o motivo"
                className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mt-2"
              />
            )}
          </div>
        )}

        {temPdf ? (
          <p className="text-xs mb-4 p-2 rounded-lg bg-[#EAF7EE] text-[#16803C]">
            PDF gerado. Você já pode encerrar.
          </p>
        ) : gerando ? (
          <div className="mb-4 p-3 rounded-lg bg-sand">
            <div className="text-xs text-ink mb-2">
              Gerando o PDF… {progresso.total ? `página ${progresso.feito} de ${progresso.total}` : 'preparando'}
            </div>
            <div className="h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-clay transition-all"
                style={{ width: progresso.total ? `${(progresso.feito / progresso.total) * 100}%` : '8%' }}
              />
            </div>
            <p className="text-[11px] text-muted mt-2">Não feche esta janela.</p>
          </div>
        ) : (
          <button onClick={() => setGerando(true)} className="w-full text-sm py-2.5 rounded-lg bg-ink text-white font-medium mb-4">
            ⇩ Baixar o PDF
          </button>
        )}

        <div className="flex gap-2">
          <button onClick={onCancelar} disabled={gerando || salvando} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted disabled:opacity-40">Cancelar</button>
          <button
            disabled={!temPdf || !motivoOk || salvando || gerando}
            onClick={confirmar}
            className="flex-1 text-sm py-2.5 rounded-lg text-white font-medium disabled:opacity-40"
            style={{ background: recusa ? '#B42318' : '#B45309' }}
          >
            {salvando ? 'Encerrando…' : (recusa ? 'Marcar como recusada' : 'Encerrar proposta')}
          </button>
        </div>
        {!temPdf && <p className="text-[11px] text-muted mt-2">O botão libera assim que o PDF for gerado.</p>}
        {temPdf && recusa && !motivoOk && <p className="text-[11px] text-muted mt-2">Selecione o motivo para concluir.</p>}

        {/* a apresentação montada invisível, só pra ser fotografada página a página */}
        {gerando && (
          <Presenter
            proposalId={proposal.id}
            exportOnly
            onExportProgress={(feito, total) => setProgresso({ feito, total })}
            onExportEnd={(ok) => {
              setGerando(false)
              if (ok) setTemPdf(true)
              else alert('Não consegui gerar o PDF agora. Tente de novo em alguns segundos.')
            }}
          />
        )}
      </div>
    </div>
  )
}
