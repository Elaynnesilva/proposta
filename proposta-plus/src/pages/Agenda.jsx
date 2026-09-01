import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProposals } from '../lib/db'
import { PACKAGE_LIST } from '../lib/fields'

const KIND_META = {
  apresentacao: { icon: '🗣️', label: 'Apresentação', color: '#B85C3E' },
  inicio: { icon: '🚀', label: 'Início do projeto', color: '#2563EB' },
  fim: { icon: '🏁', label: 'Entrega do projeto', color: '#16803C' },
}

export default function Agenda() {
  const navigate = useNavigate()
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedKey, setSelectedKey] = useState(null)

  useEffect(() => {
    listProposals().then((list) => { setProposals(list); setLoading(false) })
  }, [])

  const events = useMemo(() => {
    const list = []
    proposals.forEach((p) => {
      if (p.scheduledAt) {
        const d = new Date(p.scheduledAt)
        if (!isNaN(d)) list.push({ date: d, kind: 'apresentacao', client: p.name || 'Sem nome', proposalId: p.id })
      }
      if (p.status === 'aceita') {
        const pkg = PACKAGE_LIST.find((pk) => parseBrDate(p.fields?.[`${pk.id}Inicio`]))
        if (pkg) {
          const inicio = parseBrDate(p.fields?.[`${pkg.id}Inicio`])
          const fim = parseBrDate(p.fields?.[`${pkg.id}Fim`])
          if (inicio) list.push({ date: inicio, kind: 'inicio', client: p.name || 'Sem nome', proposalId: p.id })
          if (fim) list.push({ date: fim, kind: 'fim', client: p.name || 'Sem nome', proposalId: p.id })
        }
      }
    })
    return list
  }, [proposals])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    events.forEach((e) => {
      const key = dayKey(e.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(e)
    })
    return map
  }, [events])

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
    if (dayEvents.length === 1) { navigate(`/proposta/${dayEvents[0].proposalId}/editar`); return }
    if (dayEvents.length > 1) setSelectedKey(key === selectedKey ? null : key)
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <h1 className="font-display text-2xl md:text-3xl text-ink mb-1">Agenda</h1>
      <p className="text-sm text-muted mb-6">Apresentações marcadas e prazos de propostas aceitas, de todos os seus clientes.</p>

      {loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : events.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center text-muted text-sm">
          Nenhum compromisso ainda. Marque a data e horário de uma apresentação dentro de cada proposta, ou aceite uma proposta com prazo preenchido.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-2xl p-5 md:p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg text-ink capitalize">{monthLabel}</h2>
            <div className="flex gap-1">
              <button onClick={() => { setCursor(new Date(year, month - 1, 1)); setSelectedKey(null) }} className="w-8 h-8 rounded-full border border-line hover:bg-sand text-sm">‹</button>
              <button onClick={() => { setCursor(new Date(year, month, 1)); setSelectedKey(null) }} className="text-xs px-3 h-8 rounded-full border border-line hover:bg-sand">hoje</button>
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
                      {dayEvents.length > 1 && <span className="block opacity-70">+{dayEvents.length - 1} mais</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {selectedEvents.length > 0 && (
            <div className="mt-5 pt-5 border-t border-line space-y-2">
              {selectedEvents.map((e, i) => (
                <button key={i} onClick={() => navigate(`/proposta/${e.proposalId}/editar`)} className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-line hover:bg-sand flex items-center gap-2.5">
                  <span>{KIND_META[e.kind].icon}</span>
                  <span className="flex-1"><span className="text-muted">{KIND_META[e.kind].label} — </span><strong>{e.client}</strong></span>
                  <span className="text-xs text-muted">→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
