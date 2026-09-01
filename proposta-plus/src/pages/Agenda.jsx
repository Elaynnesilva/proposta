import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProposals, listEvents, saveEvent, deleteEvent, saveProposal } from '../lib/db'
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

// campo da proposta que cada tipo de evento representa — usado pra "reagendar" escrever de volta
const FIELD_BY_KIND = {
  proposta: { target: 'proposal', field: 'scheduledAt' },
  contrato: { target: 'proposal', field: 'contractedAt' },
  inicio: { target: 'fields', suffix: 'Inicio' },
  ap1: { target: 'fields', suffix: 'Apresentacao1' },
  ap2: { target: 'fields', suffix: 'Apresentacao2' },
  ap3: { target: 'fields', suffix: 'Apresentacao3' },
  fim: { target: 'fields', suffix: 'Fim' },
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
  const [editingEvent, setEditingEvent] = useState(null)

  useEffect(() => {
    listProposals().then(setProposals).catch((err) => console.error('Erro ao carregar propostas', err))
    listEvents().then(setCustomEvents).catch((err) => console.error('Erro ao carregar compromissos — talvez as regras do Firestore ainda não tenham sido atualizadas', err))
      .finally(() => setLoading(false))
  }, [])

  async function refreshEvents() {
    try {
      setCustomEvents(await listEvents())
    } catch (err) {
      console.error(err)
    }
  }
  async function refreshProposals() {
    try {
      setProposals(await listProposals())
    } catch (err) {
      console.error(err)
    }
  }

  const events = useMemo(() => {
    const list = []
    proposals.forEach((p) => {
      const client = p.name || 'Sem nome'
      if (p.scheduledAt) {
        const d = new Date(p.scheduledAt)
        if (!isNaN(d)) list.push({ date: d, kind: 'proposta', client, proposalId: p.id, tipologia: p.tipologia, completed: !!p.completedMilestones?.proposta })
      }
      if (p.contractedAt) {
        const d = new Date(p.contractedAt)
        if (!isNaN(d)) list.push({ date: d, kind: 'contrato', client, proposalId: p.id, tipologia: p.tipologia, completed: !!p.completedMilestones?.contrato })
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
            if (d) list.push({ date: d, kind, client, proposalId: p.id, tipologia: p.tipologia, packageId: pkg.id, completed: !!p.completedMilestones?.[kind] })
          })
        }
      }
    })
    customEvents.forEach((e) => {
      const d = new Date(e.date)
      const linked = e.proposalId ? proposals.find((p) => p.id === e.proposalId) : null
      if (!isNaN(d)) list.push({ date: d, kind: 'custom', client: e.client, title: e.title, eventId: e.id, proposalId: e.proposalId || null, tipologia: linked?.tipologia, completed: !!e.completed })
    })
    return list.sort((a, b) => a.date - b.date)
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
    return events.filter((e) => {
      if (byDate) return e.date.getDate() === Number(byDate[1]) && e.date.getMonth() + 1 === Number(byDate[2])
      return (e.client || '').toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q)
    })
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
    setSelectedKey(key === selectedKey ? null : key)
  }

  function openEvent(e) {
    if (e.kind === 'custom') { setEditingEvent(e); setShowForm(true); return }
    if (e.proposalId) navigate(`/proposta/${e.proposalId}/editar`)
  }

  async function removeCustomEvent(id) {
    if (!confirm('Remover este compromisso?')) return
    await deleteEvent(id)
    refreshEvents()
  }

  async function toggleCompleted(e) {
    if (e.kind === 'custom') {
      await saveEvent({ id: e.eventId, title: e.title, client: e.client, date: e.date.toISOString().slice(0, 16), proposalId: e.proposalId, completed: !e.completed })
      refreshEvents()
      return
    }
    const proposal = proposals.find((p) => p.id === e.proposalId)
    if (!proposal) return
    await saveProposal({ ...proposal, completedMilestones: { ...(proposal.completedMilestones || {}), [e.kind]: !e.completed } })
    refreshProposals()
  }

  /** "Reagendar": muda a data/hora de um compromisso. Para compromissos avulsos, atualiza o
   *  próprio compromisso. Para datas automáticas (proposta, contrato, pacote), atualiza o
   *  campo correspondente dentro da proposta — assim a proposta e a agenda nunca ficam
   *  desencontradas. */
  async function reschedule(e, newDateStr) {
    if (e.kind === 'custom') {
      await saveEvent({ id: e.eventId, title: e.title, client: e.client, date: newDateStr, proposalId: e.proposalId, completed: e.completed })
      refreshEvents()
      return
    }
    const proposal = proposals.find((p) => p.id === e.proposalId)
    if (!proposal) return
    const map = FIELD_BY_KIND[e.kind]
    if (!map) return
    const newDate = new Date(newDateStr)
    if (map.target === 'proposal') {
      await saveProposal({ ...proposal, [map.field]: newDateStr })
    } else {
      const fieldCode = `${e.packageId}${map.suffix}`
      const ddmmyyyy = `${String(newDate.getDate()).padStart(2, '0')}/${String(newDate.getMonth() + 1).padStart(2, '0')}/${newDate.getFullYear()}`
      await saveProposal({ ...proposal, fields: { ...(proposal.fields || {}), [fieldCode]: ddmmyyyy } })
    }
    refreshProposals()
  }

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-ink mb-1">Agenda</h1>
          <p className="text-sm text-muted">Apresentações, contratos, entregas de propostas aceitas — e o que mais você marcar.</p>
        </div>
        <button onClick={() => { setEditingEvent(null); setShowForm(true) }} className="bg-clay text-white text-sm font-medium px-4 py-2 rounded-full hover:opacity-90 shrink-0">+ Novo compromisso</button>
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
          editingEvent={editingEvent}
          onClose={() => { setShowForm(false); setEditingEvent(null) }}
          onSaved={async (ev) => { await saveEvent(ev); await refreshEvents(); setShowForm(false); setEditingEvent(null) }}
          onDelete={editingEvent ? async () => { await removeCustomEvent(editingEvent.eventId); setShowForm(false); setEditingEvent(null) } : null}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : search.trim() ? (
        <EventsTable events={searchResults} onOpen={openEvent} onToggle={toggleCompleted} onReschedule={reschedule} />
      ) : events.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center text-muted text-sm">
          Nenhum compromisso ainda. Marque a data de uma apresentação dentro de cada proposta, aceite uma proposta com prazo preenchido, ou adicione um compromisso avulso.
        </div>
      ) : (
        <>
          <div className="bg-white border border-line rounded-2xl p-5 md:p-7 mb-6">
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
              <div className="mt-5 pt-5 border-t border-line">
                <EventsTable events={selectedEvents} onOpen={openEvent} onToggle={toggleCompleted} onReschedule={reschedule} compact />
              </div>
            )}
          </div>

          {/* lista completa, estilo tabela */}
          <div className="bg-white border border-line rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-line">
              <h3 className="font-medium text-ink text-sm">Todos os compromissos</h3>
            </div>
            <EventsTable events={events} onOpen={openEvent} onToggle={toggleCompleted} onReschedule={reschedule} />
          </div>
        </>
      )}
    </div>
  )
}

/** Tabela de compromissos: check | data | hora | tarefa | cliente | tipo | reagendar */
function EventsTable({ events, onOpen, onToggle, onReschedule, compact }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {!compact && (
          <thead>
            <tr className="text-left text-xs text-muted uppercase border-b border-line">
              <th className="px-4 py-2 font-medium w-8"></th>
              <th className="px-2 py-2 font-medium">Data</th>
              <th className="px-2 py-2 font-medium">Hora</th>
              <th className="px-2 py-2 font-medium">Tarefa</th>
              <th className="px-2 py-2 font-medium">Cliente</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 font-medium">Reagendar</th>
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-line">
          {events.map((e, i) => {
            const meta = KIND_META[e.kind]
            return (
              <tr key={i} className={e.completed ? 'opacity-50' : ''}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={!!e.completed} onChange={() => onToggle(e)} />
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">{e.date.toLocaleDateString('pt-BR')}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">{e.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-2 py-2.5">
                  <button onClick={() => onOpen(e)} className={`text-left hover:underline ${e.completed ? 'line-through' : ''}`}>{e.title || meta.label}</button>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">{e.client}</td>
                <td className="px-2 py-2.5 whitespace-nowrap capitalize text-muted">{e.tipologia || '—'}</td>
                <td className="px-2 py-2.5">
                  <input
                    type="datetime-local"
                    defaultValue={toLocalInputValue(e.date)}
                    onBlur={(ev) => { if (ev.target.value && ev.target.value !== toLocalInputValue(e.date)) onReschedule(e, ev.target.value) }}
                    className="text-xs p-1 rounded border border-line outline-none focus:border-clay"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


function NewEventForm({ proposals, editingEvent, onClose, onSaved, onDelete }) {
  const [title, setTitle] = useState(editingEvent?.title || '')
  const [client, setClient] = useState(editingEvent?.client || '')
  const [date, setDate] = useState(editingEvent ? toLocalInputValue(editingEvent.date) : '')
  const [proposalId, setProposalId] = useState(editingEvent?.proposalId || '')

  function handleProposalPick(id) {
    setProposalId(id)
    const p = proposals.find((x) => x.id === id)
    if (p) setClient(p.name || '')
  }

  function submit() {
    if (!title || !date) { alert('Preencha ao menos o título e a data.'); return }
    onSaved({
      id: editingEvent?.eventId,
      title, client: client || 'Sem cliente vinculado', date, proposalId: proposalId || null,
      completed: editingEvent?.completed || false,
    })
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-5 mb-6">
      <h3 className="font-medium text-ink mb-3">{editingEvent ? 'Editar compromisso' : 'Novo compromisso'}</h3>
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
          <input value={client} onChange={(e) => setClient(e.target.value)} list="clientes-conhecidos" className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay" />
          <datalist id="clientes-conhecidos">
            {[...new Set(proposals.map((p) => p.fields?.nomeCliente).filter(Boolean))].map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Data e horário</label>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm p-2 rounded-lg border border-line outline-none focus:border-clay" />
        </div>
      </div>
      <div className="flex gap-2 mt-4 items-center">
        <button onClick={onClose} className="text-sm px-4 py-2 rounded-full border border-line text-ink/70 hover:bg-sand">Cancelar</button>
        <button onClick={submit} className="text-sm px-4 py-2 rounded-full bg-ink text-white hover:opacity-90">Salvar compromisso</button>
        {onDelete && <button onClick={onDelete} className="text-sm px-4 py-2 rounded-full text-red-600 hover:bg-red-50 ml-auto">Excluir</button>}
      </div>
    </div>
  )
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
