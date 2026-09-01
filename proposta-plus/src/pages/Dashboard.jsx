import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { listProposals, saveProposal, deleteProposal } from '../lib/db'
import { defaultFieldsObject, PACKAGE_LIST } from '../lib/fields'
import { DEFAULT_PALETTE } from '../lib/templates'

const STATUS = {
  rascunho: { label: 'Rascunho', color: '#9AA0A6', bg: '#F1F1EF' },
  enviada: { label: 'Enviada', color: '#2563EB', bg: '#EFF4FE' },
  aceita: { label: 'Aceita', color: '#16803C', bg: '#EAF7EE' },
  recusada: { label: 'Recusada', color: '#B42318', bg: '#FDEEEC' },
}

export default function Dashboard() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [renamingId, setRenamingId] = useState(null)
  const [valueModalId, setValueModalId] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { refresh() }, [])

  async function refresh() {
    setLoading(true)
    setProposals(await listProposals())
    setLoading(false)
  }

  async function createProposal() {
    const saved = await saveProposal({
      name: 'Nova proposta',
      status: 'rascunho',
      tipologia: 'residencial',
      template: 'minimalista',
      palette: DEFAULT_PALETTE,
      fields: defaultFieldsObject(),
      customSlides: [],
    })
    navigate(`/proposta/${saved.id}/editar`)
  }

  async function updateStatus(p, status, acceptedValue) {
    const saved = await saveProposal({ ...p, status, acceptedValue: status === 'aceita' ? acceptedValue : undefined })
    setProposals((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
    setValueModalId(null)
  }

  async function rename(p, name) {
    const saved = await saveProposal({ ...p, name })
    setProposals((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
    setRenamingId(null)
  }

  async function remove(id) {
    if (!confirm('Excluir esta proposta permanentemente?')) return
    await deleteProposal(id)
    refresh()
  }

  const totalReceived = useMemo(
    () => proposals.filter((p) => p.status === 'aceita').reduce((sum, p) => sum + (Number(p.acceptedValue) || 0), 0),
    [proposals]
  )

  const chartData = useMemo(() => {
    const aceita = proposals.filter((p) => p.status === 'aceita').length
    const recusada = proposals.filter((p) => p.status === 'recusada').length
    const emAndamento = proposals.length - aceita - recusada
    return [
      { name: 'Aceitas', value: aceita, color: '#16803C' },
      { name: 'Recusadas', value: recusada, color: '#B42318' },
      { name: 'Em andamento', value: emAndamento, color: '#C9C4B6' },
    ].filter((d) => d.value > 0)
  }, [proposals])

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">Propostas</h1>
          <p className="text-sm text-muted mt-1">Crie, acompanhe e apresente suas propostas de projeto.</p>
        </div>
        <button onClick={createProposal} className="bg-clay text-white text-sm font-medium px-5 py-2.5 rounded-full hover:opacity-90 transition">
          + Nova proposta
        </button>
      </div>

      {/* CRM highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <div className="md:col-span-2 bg-ink text-white rounded-2xl p-6 flex flex-col justify-center">
          <div className="text-xs uppercase tracking-wide text-white/60 mb-2">Total recebido em propostas aceitas</div>
          <div className="font-display text-4xl" style={{ color: '#E0977E' }}>
            {totalReceived.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </div>
          <div className="text-xs text-white/50 mt-2">{proposals.filter((p) => p.status === 'aceita').length} proposta(s) aceita(s)</div>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4 flex items-center justify-center">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={55} paddingAngle={3}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <span className="text-xs text-muted">Sem dados ainda</span>
          )}
        </div>
      </div>

      {/* Agenda — apresentações marcadas + prazos de propostas aceitas */}
      <AgendaSection proposals={proposals} onOpen={(id) => navigate(`/proposta/${id}/editar`)} />

      {loading ? (
        <div className="text-sm text-muted">Carregando…</div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="mb-4">Você ainda não criou nenhuma proposta.</p>
          <button onClick={createProposal} className="text-clay font-medium hover:underline">Criar a primeira proposta →</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {proposals.map((p) => (
            <div key={p.id} className="bg-white border border-line rounded-2xl p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                {renamingId === p.id ? (
                  <input
                    autoFocus defaultValue={p.name}
                    onBlur={(e) => rename(p, e.target.value || p.name)}
                    onKeyDown={(e) => e.key === 'Enter' && rename(p, e.target.value || p.name)}
                    className="text-sm font-semibold border-b border-clay outline-none w-full"
                  />
                ) : (
                  <h3 className="font-semibold text-ink text-sm leading-snug cursor-pointer" onClick={() => setRenamingId(p.id)} title="Clique para renomear">
                    {p.name || 'Sem nome'}
                  </h3>
                )}
                <span className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 rounded-full" style={{ color: STATUS[p.status]?.color, background: STATUS[p.status]?.bg }}>
                  {STATUS[p.status]?.label}
                </span>
              </div>

              <div className="text-xs text-muted mb-1">{p.fields?.nomeCliente || 'Cliente não definido'}</div>
              <div className="text-xs text-muted mb-4 capitalize">{p.tipologia}</div>

              {p.status === 'aceita' && p.acceptedValue != null && (
                <div className="text-sm font-semibold mb-3" style={{ color: '#16803C' }}>
                  {Number(p.acceptedValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no caixa
                </div>
              )}

              <div className="flex gap-2 mb-4 flex-wrap">
                <button onClick={() => navigate(`/proposta/${p.id}/editar`)} className="text-xs px-3 py-1.5 rounded-full border border-line hover:bg-sand">Editar</button>
                <button onClick={() => navigate(`/proposta/${p.id}/apresentar`)} className="text-xs px-3 py-1.5 rounded-full bg-ink text-white hover:opacity-90">Apresentar</button>
                <button onClick={() => remove(p.id)} className="text-xs px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 ml-auto">Excluir</button>
              </div>

              <div className="mt-auto pt-3 border-t border-line flex gap-2">
                <button
                  onClick={() => (valueModalId === p.id ? setValueModalId(null) : setValueModalId(p.id))}
                  className={`flex-1 text-xs py-1.5 rounded-full ${p.status === 'aceita' ? 'bg-[#EAF7EE] text-[#16803C]' : 'border border-line text-ink/70 hover:bg-sand'}`}
                >Aceita</button>
                <button
                  onClick={() => updateStatus(p, 'recusada')}
                  className={`flex-1 text-xs py-1.5 rounded-full ${p.status === 'recusada' ? 'bg-[#FDEEEC] text-[#B42318]' : 'border border-line text-ink/70 hover:bg-sand'}`}
                >Recusada</button>
              </div>

              {valueModalId === p.id && (
                <AcceptValueForm
                  defaultValue={p.acceptedValue}
                  onConfirm={(val) => updateStatus(p, 'aceita', val)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AgendaSection({ proposals, onOpen }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedKey, setSelectedKey] = useState(null)

  // extrai todos os eventos relevantes de todas as propostas: apresentações marcadas
  // e, para propostas aceitas, o início/fim do primeiro pacote com data preenchida
  const events = useMemo(() => {
    const list = []
    proposals.forEach((p) => {
      if (p.scheduledAt) {
        const d = new Date(p.scheduledAt)
        if (!isNaN(d)) {
          list.push({ date: d, label: `Apresentação — ${p.name || 'Sem nome'}`, proposalId: p.id, kind: 'apresentacao' })
        }
      }
      if (p.status === 'aceita') {
        const pkg = PACKAGE_LIST.find((pk) => parseBrDate(p.fields?.[`${pk.id}Inicio`]))
        if (pkg) {
          const inicio = parseBrDate(p.fields?.[`${pkg.id}Inicio`])
          const fim = parseBrDate(p.fields?.[`${pkg.id}Fim`])
          if (inicio) list.push({ date: inicio, label: `Início do projeto — ${p.name || 'Sem nome'}`, proposalId: p.id, kind: 'inicio' })
          if (fim) list.push({ date: fim, label: `Entrega do projeto — ${p.name || 'Sem nome'}`, proposalId: p.id, kind: 'fim' })
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

  if (events.length === 0) {
    return null // sem nenhum evento ainda — não vale poluir a tela com uma agenda vazia
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-5 mb-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-ink capitalize">📅 Agenda — {monthLabel}</h3>
        <div className="flex gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="w-7 h-7 rounded-full border border-line hover:bg-sand text-sm">‹</button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="w-7 h-7 rounded-full border border-line hover:bg-sand text-sm">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted uppercase mb-1">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const key = `${year}-${month}-${d}`
          const dayEvents = eventsByDay.get(key) || []
          const isToday = key === todayKey
          return (
            <button
              key={i}
              onClick={() => dayEvents.length && setSelectedKey(key === selectedKey ? null : key)}
              className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition ${selectedKey === key ? 'bg-ink text-white' : isToday ? 'bg-sand font-semibold' : dayEvents.length ? 'hover:bg-sand' : ''}`}
            >
              <span>{d}</span>
              {dayEvents.length > 0 && <span className={`w-1.5 h-1.5 rounded-full ${selectedKey === key ? 'bg-white' : 'bg-clay'}`} />}
            </button>
          )
        })}
      </div>

      {selectedEvents.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line space-y-2">
          {selectedEvents.map((e, i) => (
            <button key={i} onClick={() => onOpen(e.proposalId)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-line hover:bg-sand flex items-center gap-2">
              <span>{e.kind === 'apresentacao' ? '🗣️' : e.kind === 'inicio' ? '🚀' : '🏁'}</span>
              <span className="flex-1">{e.label}</span>
              <span className="text-xs text-muted">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Converte "08/09/2026" (ou com hora) para Date; retorna null se não reconhecer o formato */
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

function AcceptValueForm({ defaultValue, onConfirm }) {
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <div className="mt-3 flex gap-2">
      <input
        autoFocus type="number" placeholder="Valor que entrou no caixa"
        value={value} onChange={(e) => setValue(e.target.value)}
        className="flex-1 text-sm p-2 rounded-lg border border-line outline-none focus:border-clay"
      />
      <button
        onClick={() => value !== '' && onConfirm(Number(value))}
        className="text-xs px-3 rounded-lg bg-clay text-white"
      >OK</button>
    </div>
  )
}
