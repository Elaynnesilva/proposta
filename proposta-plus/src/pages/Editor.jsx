import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposal, saveProposal, getSettings, addSavedSwatch, addSavedPalette, removeSavedPalette, listEvents, saveEvent, deleteEvent } from '../lib/db'
import { toEmbedUrl, parseMoneyBR } from '../lib/fields'
import DataTable from '../components/DataTable'
import ColorWheelPicker from '../components/ColorWheelPicker'
import { DEFAULT_PALETTE } from '../lib/templates'
import { TIPOLOGIAS } from '../lib/content'
import { PACKAGE_LIST } from '../lib/fields'

const TABS = [
  { id: 'dados', label: 'Dados do projeto' },
  { id: 'agendamentos', label: 'Agendamentos' },
  { id: 'design', label: 'Design e cores' },
  { id: 'precos', label: 'Preços a mostrar' },
  { id: 'slides', label: 'Slides personalizados' },
]

const DEFAULT_VISIBILITY = {
  packages: { completo: true, basico: true, essencial: true },
  payments: { cartao: true, prazo: true, avista: true, metade: true },
}

export default function Editor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [proposal, setProposal] = useState(null)
  const [tab, setTab] = useState('dados')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => { getProposal(id).then(setProposal) }, [id])

  const persist = useCallback(async (patch) => {
    setProposal((prev) => {
      const next = { ...prev, ...patch }
      setSaving(true)
      saveProposal(next).then((saved) => {
        setSaving(false)
        setSavedTick(true)
        setTimeout(() => setSavedTick(false), 1200)
        setProposal(saved)
      })
      return next
    })
  }, [])

  if (!proposal) return <div className="p-10 text-muted">Carregando…</div>

  return (
    <>
      <div className="w-full px-4 sm:px-6 md:px-10 pt-4 sm:pt-6 md:pt-8 pb-4 mb-6 md:sticky md:top-0 md:z-10" style={{ background: '#EFE6D5', borderBottom: '1px solid #E4D9C3' }}>
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div>
              <button onClick={() => navigate('/')} className="text-xs text-muted hover:text-ink mb-1">← Voltar às propostas</button>
              <input
                value={proposal.name || ''}
                onChange={(e) => persist({ name: e.target.value })}
                className="font-display text-2xl md:text-3xl text-ink outline-none bg-transparent border-b border-transparent focus:border-line w-full max-w-md"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <StatusPills proposal={proposal} onChange={persist} />
              <span className="text-xs text-muted">{saving ? 'Salvando…' : savedTick ? 'Salvo ✓' : ''}</span>
              <button
                onClick={() => navigate(`/proposta/${id}/apresentar`)}
                className="bg-ink text-white text-sm font-medium px-5 py-2.5 rounded-full hover:opacity-90"
              >Apresentar →</button>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-x-6 gap-y-2 text-sm">
            <PackageRow proposal={proposal} onChange={persist} />

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-muted">Proposta:</label>
                <input
                  type="datetime-local"
                  value={proposal.scheduledAt || ''}
                  onChange={(e) => persist({ scheduledAt: e.target.value })}
                  className="text-sm p-1.5 rounded-lg border border-line outline-none focus:border-clay bg-white"
                />
                {proposal.scheduledAt && (
                  <button onClick={() => persist({ scheduledAt: '' })} className="text-xs text-muted hover:text-red-600">✕</button>
                )}
              </div>
              {proposal.status === 'aceita' && (
                <div className="flex items-center gap-2">
                  <label className="text-muted">Contrato:</label>
                  <input
                    type="datetime-local"
                    value={proposal.contractedAt || ''}
                    onChange={(e) => persist({ contractedAt: e.target.value })}
                    className="text-sm p-1.5 rounded-lg border border-line outline-none focus:border-clay bg-white"
                  />
                  {proposal.contractedAt && (
                    <button onClick={() => persist({ contractedAt: '' })} className="text-xs text-muted hover:text-red-600">✕</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 md:px-10 pb-10">

      <div className="flex gap-1 mb-8 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2.5 whitespace-nowrap border-b-2 -mb-px transition ${tab === t.id ? 'border-clay text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'dados' && <DataTable fields={proposal.fields || {}} onChange={(fields) => persist({ fields })} />}
      {tab === 'agendamentos' && <AgendamentosTab proposal={proposal} />}
      {tab === 'design' && <DesignTab proposal={proposal} onChange={persist} />}
      {tab === 'precos' && <PricingVisibilityTab proposal={proposal} onChange={persist} />}
      {tab === 'slides' && <CustomSlidesTab proposal={proposal} onChange={persist} />}
      </div>
    </>
  )
}

function StatusPills({ proposal, onChange }) {
  const status = proposal.status || 'rascunho'
  const STATUS_OPTS = [
    { id: 'rascunho', label: 'Rascunho', color: '#7C8288', bg: '#F1F1EF' },
    { id: 'enviada', label: 'Enviada', color: '#2563EB', bg: '#EFF4FE' },
    { id: 'aceita', label: 'Aceita', color: '#16803C', bg: '#EAF7EE' },
    { id: 'recusada', label: 'Recusada', color: '#B42318', bg: '#FDEEEC' },
  ]

  function setStatus(next) {
    if (next === 'aceita') {
      onChange({ status: next, acceptedValue: proposal.acceptedValue ?? null })
    } else {
      onChange({ status: next, acceptedPackageId: null })
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted mr-0.5">Status:</span>
      {STATUS_OPTS.map((s) => (
        <button
          key={s.id}
          onClick={() => setStatus(s.id)}
          className="text-xs px-3 py-1.5 rounded-full transition"
          style={status === s.id ? { color: s.color, background: s.bg, fontWeight: 600 } : { color: '#7C8288', background: 'transparent', border: '1px solid #E4DFD6' }}
        >{s.label}</button>
      ))}
    </div>
  )
}

function PackageRow({ proposal, onChange }) {
  if (proposal.status !== 'aceita') return <div />

  function choosePackage(pkg) {
    const raw = proposal.fields?.[`pacote${pkg.id.charAt(0).toUpperCase()}${pkg.id.slice(1)}Valor`]
    const value = parseMoneyBR(raw)
    onChange({ acceptedPackageId: pkg.id, acceptedValue: value })
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label className="text-muted shrink-0">Pacote escolhido:</label>
        <select
          value={proposal.acceptedPackageId || ''}
          onChange={(e) => e.target.value && choosePackage(PACKAGE_LIST.find((p) => p.id === e.target.value))}
          className="text-sm p-1.5 rounded-lg border border-line outline-none focus:border-clay bg-white"
        >
          <option value="" disabled>Selecione…</option>
          {PACKAGE_LIST.map((pkg) => (
            <option key={pkg.id} value={pkg.id}>{pkg.label}</option>
          ))}
        </select>
      </div>
      {proposal.acceptedPackageId && (
        <div className="flex items-center gap-2">
          <label className="text-muted">Valor fechado:</label>
          <div className="flex items-center gap-1">
            <span className="text-muted">R$</span>
            <input
              type="number" step="0.01"
              value={proposal.acceptedValue ?? ''}
              onChange={(e) => onChange({ acceptedValue: e.target.value === '' ? null : Number(e.target.value) })}
              className="text-sm p-1.5 rounded-lg border border-line outline-none focus:border-clay w-32"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function AgendamentosTab({ proposal }) {
  const [events, setEvents] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => { refresh() }, [proposal.id])

  async function refresh() {
    const all = await listEvents()
    setEvents(all.filter((e) => e.proposalId === proposal.id))
  }

  async function remove(id) {
    if (!confirm('Remover este compromisso?')) return
    await deleteEvent(id)
    refresh()
  }

  // datas automáticas já informadas na proposta (proposta, contrato, e as datas do pacote escolhido)
  const autoDates = useMemo(() => {
    const list = []
    if (proposal.scheduledAt) { const d = new Date(proposal.scheduledAt); if (!isNaN(d)) list.push({ label: 'Apresentação da proposta', date: d }) }
    if (proposal.contractedAt) { const d = new Date(proposal.contractedAt); if (!isNaN(d)) list.push({ label: 'Contratação', date: d }) }
    const pkg = PACKAGE_LIST.find((pk) => pk.id === proposal.acceptedPackageId)
    if (pkg) {
      ;[
        ['Início do projeto', `${pkg.id}Inicio`],
        ['1ª apresentação — Estudo preliminar', `${pkg.id}Apresentacao1`],
        ['2ª apresentação — Projeto gráfico', `${pkg.id}Apresentacao2`],
        ['3ª apresentação — Entrega final', `${pkg.id}Apresentacao3`],
        ['Entrega do projeto', `${pkg.id}Fim`],
      ].forEach(([label, code]) => {
        const raw = proposal.fields?.[code]
        const d = parseBrDate(raw)
        if (d) list.push({ label, date: d })
      })
    }
    return list
  }, [proposal])

  if (events === null) return <p className="text-sm text-muted">Carregando…</p>

  return (
    <div className="max-w-xl">
      {autoDates.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink mb-2">Datas já informadas nesta proposta</h3>
          <div className="space-y-1.5">
            {autoDates.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm border border-line rounded-lg px-3 py-2">
                <span className="text-ink/80">{a.label}</span>
                <span className="text-muted">{a.date.toLocaleDateString('pt-BR')}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-1">Editáveis em "Dados do projeto" (pacote) ou no topo da página (Proposta/Contrato).</p>
        </div>
      )}

      <h3 className="text-sm font-medium text-ink mb-2">Compromissos avulsos com este cliente</h3>
      <p className="text-sm text-muted mb-4">Marcados na Agenda e vinculados a esta proposta.</p>
      <div className="space-y-2 mb-4">
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nenhum compromisso avulso ainda.</p>
        ) : events.sort((a, b) => new Date(a.date) - new Date(b.date)).map((e) => (
          <div key={e.id} className="border border-line rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className={`text-sm font-medium ${e.completed ? 'line-through text-muted' : 'text-ink'}`}>{e.title}</div>
              <div className="text-xs text-muted">{new Date(e.date).toLocaleDateString('pt-BR')} · {new Date(e.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <button onClick={() => { setEditing(e); setShowForm(true) }} className="text-xs text-clay">editar</button>
            <button onClick={() => remove(e.id)} className="text-xs text-red-600">excluir</button>
          </div>
        ))}
      </div>

      {showForm ? (
        <AgendamentoForm
          proposal={proposal}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={async (ev) => { await saveEvent(ev); await refresh(); setShowForm(false); setEditing(null) }}
        />
      ) : (
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="text-sm text-white bg-ink px-4 py-2 rounded-full hover:opacity-90">+ Novo compromisso com este cliente</button>
      )}
    </div>
  )
}

function AgendamentoForm({ proposal, editing, onClose, onSaved }) {
  const [title, setTitle] = useState(editing?.title || '')
  const [date, setDate] = useState(editing?.date || '')

  function submit() {
    if (!title || !date) { alert('Preencha título e data.'); return }
    onSaved({ id: editing?.id, title, date, proposalId: proposal.id, client: proposal.name || proposal.fields?.nomeCliente || '', completed: editing?.completed || false })
  }

  return (
    <div className="border border-line rounded-lg p-4 mt-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do compromisso" className="w-full text-sm p-2 mb-2 rounded-lg border border-line outline-none focus:border-clay" />
      <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm p-2 mb-3 rounded-lg border border-line outline-none focus:border-clay" />
      <div className="flex gap-2">
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-full border border-line text-ink/70">Cancelar</button>
        <button onClick={submit} className="text-xs px-3 py-1.5 rounded-full bg-ink text-white">Salvar</button>
      </div>
    </div>
  )
}

function DesignTab({ proposal, onChange }) {
  return (
    <div className="space-y-10 max-w-2xl">
      <section>
        <h3 className="font-medium text-ink mb-1">Tipologia do projeto</h3>
        <p className="text-sm text-muted mb-3">Define quais fotos e vídeos padrão aparecem na apresentação. Os textos continuam os mesmos nos 3 tipos.</p>
        <div className="flex gap-2 flex-wrap">
          {TIPOLOGIAS.map((t) => (
            <button
              key={t.id}
              onClick={() => onChange({ tipologia: t.id })}
              className={`px-4 py-2 rounded-full text-sm border transition ${proposal.tipologia === t.id ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand'}`}
            >{t.label}</button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-medium text-ink mb-1">Paleta de cores</h3>
        <p className="text-sm text-muted mb-4">Escolha até 3 cores: destaque, base e fundo.</p>
        <ColorPickerConnected proposal={proposal} onChange={onChange} />
      </section>
    </div>
  )
}

function ColorPickerConnected({ proposal, onChange }) {
  const [settings, setSettings] = useState(null)

  useEffect(() => { getSettings().then(setSettings) }, [])

  async function handleAddSwatch(hex) {
    const next = await addSavedSwatch(hex)
    setSettings(next)
  }

  async function handleSavePalette(name, palette) {
    const next = await addSavedPalette(name, palette)
    setSettings(next)
  }

  async function handleDeletePalette(paletteId) {
    const next = await removeSavedPalette(paletteId)
    setSettings(next)
  }

  return (
    <ColorWheelPicker
      palette={proposal.palette || DEFAULT_PALETTE}
      onChange={(palette) => onChange({ palette })}
      savedSwatches={settings?.savedSwatches || []}
      onAddSwatch={handleAddSwatch}
      savedPalettes={settings?.savedPalettes || []}
      onSavePalette={handleSavePalette}
      onApplyPalette={(palette) => onChange({ palette })}
      onDeletePalette={handleDeletePalette}
    />
  )
}

function PricingVisibilityTab({ proposal, onChange }) {
  const visibility = { ...DEFAULT_VISIBILITY, ...(proposal.visibility || {}), packages: { ...DEFAULT_VISIBILITY.packages, ...(proposal.visibility?.packages || {}) }, payments: { ...DEFAULT_VISIBILITY.payments, ...(proposal.visibility?.payments || {}) } }

  function togglePackage(id) {
    onChange({ visibility: { ...visibility, packages: { ...visibility.packages, [id]: !visibility.packages[id] } } })
  }
  function paymentsFor(pkgId) {
    return { ...DEFAULT_VISIBILITY.payments, ...(visibility.paymentsByPackage?.[pkgId] ?? visibility.payments) }
  }
  function togglePayment(pkgId, id) {
    const current = paymentsFor(pkgId)
    onChange({
      visibility: {
        ...visibility,
        paymentsByPackage: { ...(visibility.paymentsByPackage || {}), [pkgId]: { ...current, [id]: !current[id] } },
      },
    })
  }

  return (
    <div className="max-w-xl space-y-8">
      <p className="text-sm text-muted">
        Escolha quais pacotes aparecem nesta proposta, e quais formas de pagamento aparecem em cada um —
        ocultar uma forma de pagamento em um pacote não afeta os outros. Se um pacote não tiver valor
        preenchido nos dados, ele não aparece de qualquer forma.
      </p>

      <section>
        <h3 className="font-medium text-ink mb-3">Pacotes a mostrar</h3>
        <div className="space-y-2">
          {PACKAGE_LIST.map((p) => (
            <ToggleRow key={p.id} label={`Pacote ${p.label}`} checked={visibility.packages[p.id]} onToggle={() => togglePackage(p.id)} />
          ))}
        </div>
      </section>

      {PACKAGE_LIST.filter((p) => visibility.packages[p.id]).map((p) => (
        <section key={p.id}>
          <h3 className="font-medium text-ink mb-3">Formas de pagamento — Pacote {p.label}</h3>
          <div className="space-y-2">
            <ToggleRow label="Cartão de crédito (12x)" checked={paymentsFor(p.id).cartao} onToggle={() => togglePayment(p.id, 'cartao')} />
            <ToggleRow label="Parcelado por prazo de projeto" checked={paymentsFor(p.id).prazo} onToggle={() => togglePayment(p.id, 'prazo')} />
            <ToggleRow label="À vista (com desconto)" checked={paymentsFor(p.id).avista} onToggle={() => togglePayment(p.id, 'avista')} />
            <ToggleRow label="Metade / Metade" checked={paymentsFor(p.id).metade} onToggle={() => togglePayment(p.id, 'metade')} />
          </div>
        </section>
      ))}
    </div>
  )
}

function ToggleRow({ label, checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-line bg-white hover:bg-sand transition text-left"
    >
      <span className="text-sm text-ink">{label}</span>
      <span
        className="w-10 h-5 rounded-full relative transition shrink-0"
        style={{ background: checked ? '#B85C3E' : '#E4DFD6' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: checked ? 22 : 2 }}
        />
      </span>
    </button>
  )
}

function CustomSlidesTab({ proposal, onChange }) {
  const slides = proposal.customSlides || []

  function addSlide() {
    onChange({ customSlides: [...slides, { title: 'Novo slide', items: [''], image: '', embedUrl: '' }] })
  }
  function updateSlide(i, patch) {
    const next = slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    onChange({ customSlides: next })
  }
  function removeSlide(i) {
    onChange({ customSlides: slides.filter((_, idx) => idx !== i) })
  }
  function handleImage(i, file) {
    const reader = new FileReader()
    reader.onload = () => updateSlide(i, { image: reader.result, embedUrl: '' })
    reader.readAsDataURL(file)
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-5">
        Crie telas extras com o que quiser: título, textos (aparecem um a um ao clicar) e uma imagem ou vídeo (via
        link de incorporação do YouTube/Vimeo — suba o vídeo como "não listado" e cole o link no formato .../embed/...).
        Elas entram na apresentação logo antes do encerramento. Você também pode editar slides direto na
        tela de apresentação, clicando em "Editar slide" — inclusive o vídeo principal do projeto, que agora se edita por lá.
      </p>
      <div className="space-y-4">
        {slides.map((s, i) => (
          <div key={i} className="border border-line rounded-xl p-4 bg-white">
            <div className="flex justify-between items-start mb-3">
              <input
                value={s.title}
                onChange={(e) => updateSlide(i, { title: e.target.value })}
                className="font-medium text-ink text-sm outline-none border-b border-transparent focus:border-line flex-1"
                placeholder="Título do slide"
              />
              <button onClick={() => removeSlide(i)} className="text-xs text-red-600 ml-3">Remover</button>
            </div>
            {(s.items || ['']).map((it, k) => (
              <textarea
                key={k}
                value={it}
                onChange={(e) => {
                  const items = [...(s.items || [''])]
                  items[k] = e.target.value
                  updateSlide(i, { items })
                }}
                placeholder={`Texto ${k + 1} (aparece ao clicar)`}
                rows={2}
                className="w-full text-sm p-2 mb-2 rounded-lg border border-line outline-none focus:border-clay"
              />
            ))}
            <button onClick={() => updateSlide(i, { items: [...(s.items || ['']), ''] })} className="text-xs text-clay mb-3">+ Adicionar outro texto</button>

            <div className="flex gap-3 items-center text-xs mb-2">
              <label className="cursor-pointer text-ink/70 hover:text-ink shrink-0">
                📷 Imagem
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && handleImage(i, e.target.files[0])} />
              </label>
              {s.image && <span className="text-green-700">imagem anexada ✓</span>}
            </div>
            <input
              value={s.embedUrl || ''}
              onChange={(e) => updateSlide(i, { embedUrl: e.target.value, image: e.target.value ? '' : s.image })}
              onBlur={(e) => updateSlide(i, { embedUrl: toEmbedUrl(e.target.value) })}
              placeholder="ou link de incorporação de vídeo (https://www.youtube.com/embed/…)"
              className="w-full text-xs p-2 rounded-lg border border-line outline-none focus:border-clay"
            />
          </div>
        ))}
      </div>
      <button onClick={addSlide} className="mt-4 text-sm font-medium text-white bg-ink px-4 py-2 rounded-full hover:opacity-90">+ Novo slide</button>
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
