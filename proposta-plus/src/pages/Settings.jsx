import React, { useEffect, useState } from 'react'
import { getSettings, saveSettings, getTemplateContent, saveTemplateContent } from '../lib/db'
import { DEFAULT_SHARED_TEXT, DEFAULT_IMAGES, TIPOLOGIAS } from '../lib/content'

const TABS = [
  { id: 'empresa', label: 'Empresa' },
]

export default function Settings() {
  const [tab, setTab] = useState('empresa')
  const [settings, setSettings] = useState(null)
  const [content, setContent] = useState(null)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings)
    getTemplateContent().then((c) => setContent({
      shared: { ...DEFAULT_SHARED_TEXT, ...(c?.shared || {}) },
      images: {
        residencial: { ...DEFAULT_IMAGES.residencial, ...(c?.images?.residencial || {}) },
        comercial: { ...DEFAULT_IMAGES.comercial, ...(c?.images?.comercial || {}) },
        corporativo: { ...DEFAULT_IMAGES.corporativo, ...(c?.images?.corporativo || {}) },
      },
    }))
  }, [])

  function flashSaved() {
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1200)
  }

  async function persistSettings(patch) {
    const next = { ...settings, ...patch }
    setSettings(next)
    await saveSettings(next)
    flashSaved()
  }

  async function persistContent(patch) {
    const next = { ...content, ...patch }
    setContent(next)
    await saveTemplateContent(next)
    flashSaved()
  }

  function handleLogo(file) {
    const reader = new FileReader()
    reader.onload = () => {
      persistSettings({ logoDataUrl: reader.result })
      const fav = document.getElementById('favicon')
      if (fav) fav.href = reader.result
    }
    reader.readAsDataURL(file)
  }

  if (!settings || !content) return <div className="p-10 text-muted">Carregando…</div>

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Configurações</h1>
          <p className="text-sm text-muted mt-1">Sua marca e o conteúdo padrão usados em todas as propostas.</p>
        </div>
        <span className="text-xs text-muted">{savedTick ? 'Salvo ✓' : ''}</span>
      </div>

      <div className="flex gap-1 mb-8 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2.5 whitespace-nowrap border-b-2 -mb-px transition ${tab === t.id ? 'border-clay text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'empresa' && (
        <div className="max-w-xl space-y-6">
          <div>
            <label className="text-sm font-medium text-ink block mb-2">Logo / ícone do sistema</label>
            <div className="flex items-center gap-4">
              {settings.logoDataUrl
                ? <img src={settings.logoDataUrl} alt="logo" className="h-16 object-contain bg-sand rounded-lg p-2" />
                : <div className="h-16 w-16 rounded-lg bg-sand flex items-center justify-center text-xs text-muted">sem logo</div>}
              <label className="text-sm cursor-pointer text-clay font-medium">
                Enviar imagem
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && handleLogo(e.target.files[0])} />
              </label>
            </div>
          </div>

          <Field label="Nome do escritório / marca" value={settings.companyName} onChange={(v) => persistSettings({ companyName: v })} />
          <Field label="Nome do(a) profissional" value={settings.professionalName} onChange={(v) => persistSettings({ professionalName: v })} />
          <Field label="Registro (CAU, CREA…)" value={settings.registration} onChange={(v) => persistSettings({ registration: v })} />
          <Field label="Cidade(s) de atuação" value={settings.city} onChange={(v) => persistSettings({ city: v })} />
          <Field label="Instagram" value={settings.instagram} onChange={(v) => persistSettings({ instagram: v })} />
          <Field label="WhatsApp" value={settings.whatsapp} onChange={(v) => persistSettings({ whatsapp: v })} />
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-1">{label}</label>
      <input
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
      />
    </div>
  )
}

function TextBlock({ label, value, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-1">{label}</label>
      <input
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
      />
    </div>
  )
}

function ListBlock({ label, items, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-2">{label}</label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <input
            key={i}
            value={it}
            onChange={(e) => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay"
          />
        ))}
      </div>
      <button onClick={() => onChange([...items, ''])} className="text-xs text-clay mt-2">+ adicionar item</button>
    </div>
  )
}

function PhotoSlot({ label, url, onFile }) {
  return (
    <label className="cursor-pointer group block">
      <div className="aspect-video rounded-lg overflow-hidden bg-sand border border-line relative">
        <img src={url} alt={label} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 text-white text-xs">Trocar foto</span>
        </div>
      </div>
      <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
  )
}
