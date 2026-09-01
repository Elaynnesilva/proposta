import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProposals, listEvents, saveEvent, deleteEvent } from '../lib/db'
import { PACKAGE_LIST } from '../lib/fields'

const KIND_META = {
  proposta: { icon: '🗣️', label: 'Apresentação da proposta', color: '#B85C3E' },
  contrato: { icon: '✍️', label: 'Contratação', color: '#8B5CF6' },
  inicio: { icon: '🚀', label: 'Início do projeto', color: '#2563EB' },
  ap1: { icon: '📐', label: '1ª apresentação — Estudo preliminar', color: '#0D9488' },
  ap2: { icon: '📐', label: '2ª apresentação — Projeto gráfico', color: '#0D9488' },
  ap3: { icon: '📐', label: '3ª apresentação — Entrega final', color: '#0D9488' },
  fim: { icon: '🏁', label: 'Entrega do projeto', color: '#16803C' },
  custom: { icon: '📌', label: 'Compromisso', color: '#B45309' },
}

export default function Agenda() {
  const navigate = useNavigate()
  const [proposals, setProposals] = useState([])
  const [customEvents, setCustomEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedKey, setSelectedKey] = useState(null)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    Promise.all([listProposals(), listEvents()]).then(([p, e]) => {
      setProposals(p)
      setCustomEvents(e)
      setLoading(false)
    })
  }, [])

  async function refreshEvents() {
    setCustomEvents(await listEvents())
  }

  const events = useMemo(() => {
    const list = []
    proposals.forEach((p) => {
      const client = p.name || 'Sem nome'
      if (p.scheduledAt) {
        const d = new Date(p.scheduledAt)
        if (!isNaN(d)) list.push({ date: d, kind: 'proposta', client, proposalId: p.id })
      }
      if (p.contractedAt) {
        const d = new Date(p.contractedAt)
        if (!isNaN(d)) list.push({ date: d, kind: 'contrato', client, proposalId: p.id })
      }
      if (p.status === 'aceita') {
        // usa o pacote que o cliente escolheu; se não tiver sido marcado (propostas antigas),
        // cai no primeiro pacote que tiver alguma data preenchida
        const pkg = PACKAGE_LIST.find((pk) => pk.id === p.acceptedPackageId)
          || PACKAGE_LIST.find((pk) => parseBrDate(p.fields?.[`${pk.id}Inicio`]))
        if (pkg) {
          const pairs = [
            ['inicio', `${pkg.id}Inicio`],
            ['ap1', `${pkg.id}Apresentacao1`],
            ['ap2', `${pkg.id}Apresentacao2`],
            ['ap3', `${pkg.id}Apresentacao3`],
            ['fim', `${pkg.id}Fim`],
          ]
          pairs.forEach(([kind, fieldCode]) => {
            const d = parseBrDate(p.fields?.[fieldCode])
            if (d) list.push({ date: d, kind, client, proposalId: p.id })
          })
        }
      }
    })
    customEvents.forEach((e) => {
      const d = new Date(e.date)
      if (!isNaN(d)) list.push({ date: d, kind: 'custom', client: e.client, title: e.title, eventId: e.id })
    })
    return list
  }, [proposals, customEvents])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    events.forEach((e) => {
      const key = dayKey(e.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(e)
    })
    return map
  }, [events])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const byDate = q.match(/^(\d{1,2})\/(\d{1,2})/)
    return events
      .filter((e) => {
        if (byDate) return e.date.getDate() === Number(byDate[1]) && e.date.getMonth() + 1 === Number(byDate[2])
        return (e.client || '').toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q)
      })
      .sort((a, b) => a.date - b.date)
  }, [search, events])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const todayKey = dayKey(new Date())

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const selectedEvents = selectedKey ? (eventsByDay.get(selectedKey) || []) : []

  function handleDayClick(key, dayEvents) {
    if (dayEvents.length === 1) { openEvent(dayEvents[0]); return }
    if (dayEvents.length > 1) setSelectedKey(key === selectedKey ? null : key)
  }

  function openEvent(e) {
    if (e.proposalId) navigate(`/proposta/${e.proposalId}/editar`)
  }

  async function removeCustomEvent(id) {
    if (!confirm('Remover este compromisso?')) return
    await deleteEvent(id)
    refreshEvents()
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-ink mb-1">Agenda</h1>
          <p className="text-sm text-muted">Apresentações, contratos, entregas de propostas aceitas — e o que mais você marcar.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="bg-clay text-white text-sm font-medium px-4 py-2 rounded-full hover:opacity-90 shrink-0">+ Novo compromisso</button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome do cliente ou por data (ex: 25/09)…"
        className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay bg-white mt-4 mb-6"
      />

      {showForm && (
        <NewEventForm
          proposals={proposals}
          onClose={() => setShowForm(false)}
          onSaved={async (ev) => { await saveEvent(ev); await refreshEvents(); setShowForm(false) }}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : search.trim() ? (
        <div className="bg-white border border-line rounded-2xl divide-y divide-line">
          {searchResults.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">Nada encontrado.</div>
          ) : searchResults.map((e, i) => (
            <EventRow key={i} e={e} onOpen={() => openEvent(e)} onRemove={e.eventId ? () => removeCustomEvent(e.eventId) : null} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center text-muted text-sm">
          Nenhum compromisso ainda. Marque a data de uma apresentação dentro de cada proposta, aceite uma proposta com prazo preenchido, ou adicione um compromisso avulso.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-2xl p-5 md:p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg text-ink capitalize">{monthLabel}</h2>
            <div className="flex gap-1">
              <button onClick={() => { setCursor(new Date(year, month - 1, 1)); setSelectedKey(null) }} className="w-8 h-8 rounded-full border border-line hover:bg-sand text-sm">‹</button>
              <button onClick={() => { setCursor(new Date()); setSelectedKey(null) }} className="text-xs px-3 h-8 rounded-full border border-line hover:bg-sand">hoje</button>
              <button onClick={() => { setCursor(new Date(year, month + 1, 1)); setSelectedKey(null) }} className="w-8 h-8 rounded-full border border-line hover:bg-sand text-sm">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted uppercase mb-2">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />
              const key = `${year}-${month}-${d}`
              const dayEvents = eventsByDay.get(key) || []
              const first = dayEvents[0]
              const meta = first ? KIND_META[first.kind] : null
              const isToday = key === todayKey
              const isSelected = key === selectedKey
              return (
                <button
                  key={i}
                  onClick={() => handleDayClick(key, dayEvents)}
                  className={`aspect-square sm:aspect-auto sm:h-20 rounded-xl p-1.5 flex flex-col items-start text-left transition overflow-hidden ${
                    dayEvents.length ? 'border-2' : isToday ? 'border border-clay/40 bg-sand' : 'border border-transparent hover:bg-sand'
                  }`}
                  style={dayEvents.length ? { borderColor: isSelected ? meta.color : meta.color + '55', background: isSelected ? meta.color : meta.color + '14' } : undefined}
                >
                  <span className={`text-xs font-medium ${dayEvents.length ? (isSelected ? 'text-white' : 'text-ink') : isToday ? 'text-clay font-semibold' : 'text-ink/70'}`}>{d}</span>
                  {dayEvents.length > 0 && (
                    <span className={`hidden sm:block text-[10px] leading-tight mt-1 ${isSelected ? 'text-white' : 'text-ink/80'}`}>
                      {meta.icon} {first.client}
                      <span className="block opacity-70">{KIND_META[first.kind].label}</span>
                      {dayEvents.length > 1 && <span className="block opacity-70">+{dayEvents.length - 1} mais</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {selectedEvents.length > 0 && (
            <div className="mt-5 pt-5 border-t border-line divide-y divide-line">
              {selectedEvents.map((e, i) => (
                <EventRow key={i} e={e} onOpen={() => openEvent(e)} onRemove={e.eventId ? () => removeCustomEvent(e.eventId) : null} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventRow({ e, onOpen, onRemove }) {
  const meta = KIND_META[e.kind]
  return (
    <div className="w-full text-left text-sm px-3 py-2.5 flex items-center gap-2.5">
      <span>{meta.icon}</span>
      <button onClick={onOpen} disabled={!e.proposalId} className="flex-1 text-left disabled:cursor-default">
        <span className="text-muted">{e.title || meta.label} — </span><strong>{e.client}</strong>
        <span className="block text-xs text-muted">{e.date.toLocaleDateString('pt-BR')}</span>
      </button>
      {e.proposalId && <span className="text-xs text-muted">→</span>}
      {onRemove && <button onClick={onRemove} className="text-xs text-red-600 shrink-0">remover</button>}
    </div>
  )
}

function NewEventForm({ proposals, onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [client, setClient] = useState('')
  const [date, setDate] = useState('')
  const [proposalId, setProposalId] = useState('')

  function handleProposalPick(id) {
    setProposalId(id)
    const p = proposals.find((x) => x.id === id)
    if (p) setClient(p.name || '')
  }

  function submit() {
    if (!title || !date) { alert('Preencha ao menos o título e a data.'); return }
    onSaved({ title, client: client || 'Sem cliente vinculado', date, proposalId: proposalId || null })
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-5 mb-6">
      <h3 className="font-medium text-ink mb-3">Novo compromisso</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted block mb-1">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Visita técnica, reunião de alinhamento…" className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay" />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Ligar a uma proposta (opcional)</label>
          <select value={proposalId} onChange={(e) => handleProposalPick(e.target.value)} className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay bg-white">
            <option value="">Nenhuma — só um compromisso avulso</option>
            {proposals.map((p) => <option key={p.id} value={p.id}>{p.name || 'Sem nome'}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Nome do cliente</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay" />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Data e horário</label>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm p-2 rounded-lg border border-line outline-none focus:border-clay" />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="text-sm px-4 py-2 rounded-full border border-line text-ink/70 hover:bg-sand">Cancelar</button>
        <button onClick={submit} className="text-sm px-4 py-2 rounded-full bg-ink text-white hover:opacity-90">Salvar compromisso</button>
      </div>
    </div>
  )
}

function parseBrDate(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const year = yyyy.length === 2 ? `20${yyyy}` : yyyy
  const d = new Date(Number(year), Number(mm) - 1, Number(dd))
  return isNaN(d) ? null : d
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}
