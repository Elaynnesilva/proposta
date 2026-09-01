import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposal, saveProposal, getSettings, addSavedSwatch, addSavedPalette, removeSavedPalette } from '../lib/db'
import DataTable from '../components/DataTable'
import ColorWheelPicker from '../components/ColorWheelPicker'
import { DEFAULT_PALETTE } from '../lib/templates'
import { TIPOLOGIAS } from '../lib/content'
import { PACKAGE_LIST } from '../lib/fields'

const TABS = [
  { id: 'dados', label: 'Dados do projeto' },
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
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div>
          <button onClick={() => navigate('/')} className="text-xs text-muted hover:text-ink mb-1">← Voltar às propostas</button>
          <input
            value={proposal.name || ''}
            onChange={(e) => persist({ name: e.target.value })}
            className="font-display text-2xl md:text-3xl text-ink outline-none bg-transparent border-b border-transparent focus:border-line w-full max-w-md"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{saving ? 'Salvando…' : savedTick ? 'Salvo ✓' : ''}</span>
          <button
            onClick={() => navigate(`/proposta/${id}/apresentar`)}
            className="bg-ink text-white text-sm font-medium px-5 py-2.5 rounded-full hover:opacity-90"
          >Apresentar →</button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 text-sm">
        <label className="text-muted">📅 Data e horário da apresentação:</label>
        <input
          type="datetime-local"
          value={proposal.scheduledAt || ''}
          onChange={(e) => persist({ scheduledAt: e.target.value })}
          className="text-sm p-1.5 rounded-lg border border-line outline-none focus:border-clay"
        />
        {proposal.scheduledAt && (
          <button onClick={() => persist({ scheduledAt: '' })} className="text-xs text-muted hover:text-red-600">remover</button>
        )}
      </div>

      <div className="flex gap-1 mb-8 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2.5 whitespace-nowrap border-b-2 -mb-px transition ${tab === t.id ? 'border-clay text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'dados' && <DataTable fields={proposal.fields || {}} onChange={(fields) => persist({ fields })} />}
      {tab === 'design' && <DesignTab proposal={proposal} onChange={persist} />}
      {tab === 'precos' && <PricingVisibilityTab proposal={proposal} onChange={persist} />}
      {tab === 'slides' && <CustomSlidesTab proposal={proposal} onChange={persist} />}
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
  function togglePayment(id) {
    onChange({ visibility: { ...visibility, payments: { ...visibility.payments, [id]: !visibility.payments[id] } } })
  }

  return (
    <div className="max-w-xl space-y-8">
      <p className="text-sm text-muted">
        Escolha quais pacotes e formas de pagamento aparecem nesta proposta. Um slide é criado para
        cada pacote marcado (sempre na ordem Completo → Básico → Essencial), com as formas de
        pagamento marcadas abaixo. Se um pacote não tiver valor preenchido nos dados, ele não aparece de qualquer forma.
      </p>

      <section>
        <h3 className="font-medium text-ink mb-3">Pacotes a mostrar</h3>
        <div className="space-y-2">
          {PACKAGE_LIST.map((p) => (
            <ToggleRow key={p.id} label={`Pacote ${p.label}`} checked={visibility.packages[p.id]} onToggle={() => togglePackage(p.id)} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-medium text-ink mb-3">Formas de pagamento a mostrar (em cada pacote)</h3>
        <div className="space-y-2">
          <ToggleRow label="Cartão de crédito (12x)" checked={visibility.payments.cartao} onToggle={() => togglePayment('cartao')} />
          <ToggleRow label="Parcelado por prazo de projeto" checked={visibility.payments.prazo} onToggle={() => togglePayment('prazo')} />
          <ToggleRow label="À vista (com desconto)" checked={visibility.payments.avista} onToggle={() => togglePayment('avista')} />
          <ToggleRow label="Metade / Metade" checked={visibility.payments.metade} onToggle={() => togglePayment('metade')} />
        </div>
      </section>
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
