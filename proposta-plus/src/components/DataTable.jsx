import React, { useState } from 'react'
import { FIELD_GROUPS, ALL_FIELD_CODES, LABEL_TO_CODE, LIST_FIELD_CODES } from '../lib/fields'

// tenta casar o texto que a pessoa colou na 1a coluna com um campo conhecido,
// aceitando o nome interno OU qualquer um dos rotulos em portugues daquele campo
function matchCode(rawLabel) {
  const clean = rawLabel.trim().replace(/^\{|\}$/g, '')
  if (ALL_FIELD_CODES.includes(clean)) return clean
  return LABEL_TO_CODE[clean.toLowerCase()] || null
}

export default function DataTable({ fields, onChange }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [openGroups, setOpenGroups] = useState(() => new Set(FIELD_GROUPS.map((g) => g.group)))

  function setField(code, value) {
    onChange({ ...fields, [code]: value })
  }

  function applyPaste() {
    const next = { ...fields }
    const listBuffers = {} // acumula linhas repetidas dos campos-lista nesta colagem
    let matched = 0
    pasteText.split('\n').forEach((line) => {
      if (!line.trim()) return
      const parts = line.split('\t')
      if (parts.length < 2) return
      const code = matchCode(parts[0])
      const value = parts.slice(1).join('\t').trim()
      if (!code) return
      matched++
      if (LIST_FIELD_CODES.has(code)) {
        if (!listBuffers[code]) listBuffers[code] = []
        if (value) listBuffers[code].push(value)
      } else {
        next[code] = value
      }
    })
    Object.entries(listBuffers).forEach(([code, items]) => {
      next[code] = items.join('\n')
    })
    onChange(next)
    setPasteText('')
    setPasteOpen(false)
    alert(matched > 0 ? `${matched} linha(s) reconhecida(s) e preenchida(s).` : 'Não consegui reconhecer nenhuma linha. Você pode preencher os campos manualmente abaixo, sem problema.')
  }

  function toggleGroup(name) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-sm text-muted max-w-lg">Cole as informações da sua planilha aqui (as duas colunas inteiras), ou preencha os campos abaixo manualmente. O que você colar aparece direto na apresentação.</p>
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="shrink-0 text-sm font-medium px-4 py-2 rounded-full bg-ink text-white hover:opacity-90 transition"
        >
          {pasteOpen ? 'Fechar' : 'Colar informações'}
        </button>
      </div>

      {pasteOpen && (
        <div className="mb-6 p-4 border border-line rounded-xl bg-sand">
          <textarea
            autoFocus
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Selecione as duas colunas da sua planilha inteira, copie (Ctrl+C) e cole aqui (Ctrl+V)…'}
            className="w-full h-40 text-sm p-3 rounded-lg border border-line font-mono outline-none focus:border-clay"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setPasteOpen(false)} className="text-sm px-4 py-2 text-muted">Cancelar</button>
            <button onClick={applyPaste} disabled={!pasteText.trim()} className="text-sm px-4 py-2 rounded-full bg-clay text-white disabled:opacity-40">Preencher</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {FIELD_GROUPS.map((group) => (
          <div key={group.group} className="border border-line rounded-xl overflow-hidden bg-white">
            <button
              onClick={() => toggleGroup(group.group)}
              className="w-full flex items-center justify-between px-4 py-3 bg-sand/60 hover:bg-sand text-left"
            >
              <span className="font-medium text-sm text-ink">{group.group}</span>
              <span className="text-muted text-xs">{openGroups.has(group.group) ? '▾ ocultar' : '▸ mostrar'}</span>
            </button>
            {openGroups.has(group.group) && (
              <div className="divide-y divide-line">
                {group.fields.map(([code, label, , isList]) => (
                  <div key={code} className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-1 sm:gap-3 px-4 py-2.5 items-start">
                    <label className="text-sm text-ink/70 pt-2">
                      {label}
                      {isList && <span className="block text-[11px] text-muted">uma linha por item</span>}
                    </label>
                    {isList ? (
                      <textarea
                        value={fields[code] || ''}
                        onChange={(e) => setField(code, e.target.value)}
                        rows={4}
                        placeholder={'Um item por linha…'}
                        className="text-sm p-2 rounded-lg border border-line outline-none focus:border-clay w-full font-mono"
                      />
                    ) : (
                      <input
                        value={fields[code] || ''}
                        onChange={(e) => setField(code, e.target.value)}
                        className="text-sm p-2 rounded-lg border border-line outline-none focus:border-clay w-full"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
